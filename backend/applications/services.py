"""Transactional business operations for waiting applications."""

from datetime import datetime

from applications.models import ApplicationEvent, RentalApplication
from django.db import transaction
from django.db.models import Count
from django.utils import timezone
from rest_framework.exceptions import APIException, ValidationError

from catalog.models import Product
from users.models import User


class ApplicationLimitReached(APIException):
    status_code = 409
    default_code = "application_limit_reached"
    default_detail = "Достигнут лимит ожидающих заявок на товар."


def expire_waiting_applications() -> None:
    with transaction.atomic():
        expired_ids = list(
            RentalApplication.objects.select_for_update()
            .filter(
                status=RentalApplication.Status.WAITING,
                pickup_deadline_at__lte=timezone.now(),
            )
            .values_list("id", flat=True)
        )
        if not expired_ids:
            return
        RentalApplication.objects.filter(pk__in=expired_ids).update(
            status=RentalApplication.Status.EXPIRED,
            updated_at=timezone.now(),
        )
        ApplicationEvent.objects.bulk_create(
            [
                ApplicationEvent(
                    application_id=application_id,
                    event=ApplicationEvent.Event.EXPIRED,
                    actor=ApplicationEvent.Actor.SYSTEM,
                )
                for application_id in expired_ids
            ]
        )


@transaction.atomic
def create_application(
    *,
    renter: User,
    product_id: int,
    pickup_deadline_at: datetime,
    planned_return_at: datetime,
) -> RentalApplication:
    product = Product.objects.select_for_update().get(pk=product_id)
    if product.status != Product.Status.PUBLISHED:
        raise ValidationError({"product": "Этот товар не принимает новые заявки."})
    total_count = product.instances.filter(is_deleted=False).count()
    pending_count = RentalApplication.objects.filter(
        renter=renter,
        product=product,
        status=RentalApplication.Status.WAITING,
    ).count()
    if pending_count >= total_count:
        message = (
            f"У вас уже {pending_count} из {total_count} "
            "ожидающих заявок на этот товар."
        )
        raise ApplicationLimitReached(
            {
                "detail": "Достигнут лимит ожидающих заявок на товар.",
                "product": message,
            }
        )
    application = RentalApplication.objects.create(
        renter=renter,
        product=product,
        pickup_deadline_at=pickup_deadline_at,
        planned_return_at=planned_return_at,
    )
    ApplicationEvent.objects.create(
        application=application,
        event=ApplicationEvent.Event.CREATED,
        actor=ApplicationEvent.Actor.RENTER,
    )
    return application


@transaction.atomic
def cancel_application(
    *,
    application: RentalApplication,
    actor: str,
    reason: str = "",
) -> RentalApplication:
    locked = RentalApplication.objects.select_for_update().get(pk=application.pk)
    if locked.status != RentalApplication.Status.WAITING:
        raise ValidationError({"status": "Отменить можно только ожидающую заявку."})
    locked.status = RentalApplication.Status.CANCELLED
    locked.cancellation_reason = reason
    locked.save(update_fields=("status", "cancellation_reason", "updated_at"))
    ApplicationEvent.objects.create(
        application=locked,
        event=ApplicationEvent.Event.CANCELLED,
        actor=actor,
        note=reason.strip(),
    )
    return locked


def cancel_waiting_for_product(product: Product, reason: str) -> None:
    applications = RentalApplication.objects.filter(
        product=product,
        status=RentalApplication.Status.WAITING,
    ).order_by("created_at", "id")
    for application in applications:
        cancel_application(
            application=application,
            actor=ApplicationEvent.Actor.SYSTEM,
            reason=reason,
        )


def cancel_excess_applications(product: Product) -> None:
    total_count = product.instances.filter(is_deleted=False).count()
    renter_ids = (
        RentalApplication.objects.filter(
            product=product,
            status=RentalApplication.Status.WAITING,
        )
        .values("renter_id")
        .annotate(application_count=Count("id"))
        .filter(application_count__gt=total_count)
        .values_list("renter_id", flat=True)
    )
    for renter_id in renter_ids:
        retained_ids = list(
            RentalApplication.objects.filter(
                product=product,
                renter_id=renter_id,
                status=RentalApplication.Status.WAITING,
            )
            .order_by("created_at", "id")
            .values_list("id", flat=True)[:total_count]
        )
        excess = RentalApplication.objects.filter(
            product=product,
            renter_id=renter_id,
            status=RentalApplication.Status.WAITING,
        ).exclude(pk__in=retained_ids)
        for application in excess.order_by("-created_at", "-id"):
            cancel_application(
                application=application,
                actor=ApplicationEvent.Actor.SYSTEM,
                reason="Лимит заявок уменьшился после удаления экземпляра.",
            )
