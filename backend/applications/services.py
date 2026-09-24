"""Transactional business operations for waiting applications."""

from datetime import datetime
from decimal import Decimal

from applications.models import (
    ApplicationEvent,
    BookingEvent,
    RentalApplication,
    RentalBooking,
)
from django.db import IntegrityError, transaction
from django.db.models import Count
from django.utils import timezone
from rest_framework.exceptions import APIException, ValidationError

from catalog.models import Product, ProductInstance
from users.models import User


class ApplicationLimitReached(APIException):
    status_code = 409
    default_code = "application_limit_reached"
    default_detail = "Достигнут лимит ожидающих заявок на товар."


class InstanceUnavailable(APIException):
    status_code = 409
    default_code = "instance_unavailable"
    default_detail = "Выбранный экземпляр уже недоступен."


class BookingDeadlinePassed(APIException):
    status_code = 409
    default_code = "booking_deadline_passed"
    default_detail = "Крайний срок получения уже наступил."


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


@transaction.atomic
def create_booking(
    *,
    application_id: int,
    instance_id: str,
    manager: User,
) -> tuple[RentalBooking, bool]:
    application = (
        RentalApplication.objects.select_for_update()
        .select_related("product")
        .get(pk=application_id)
    )
    existing = RentalBooking.objects.filter(application=application).first()
    if existing is not None:
        if str(existing.instance_id) == str(instance_id):
            return existing, False
        raise ValidationError(
            {"application": "Для этой заявки бронь уже была создана."}
        )
    if application.product.manager_id != manager.id:
        raise ValidationError({"application": "Заявка относится к другому менеджеру."})
    if application.status != RentalApplication.Status.WAITING:
        raise ValidationError({"application": "Заявка больше не ожидает решения."})
    if application.pickup_deadline_at <= timezone.now():
        raise BookingDeadlinePassed()

    instance = ProductInstance.objects.select_for_update().get(pk=instance_id)
    if (
        instance.product_id != application.product_id
        or instance.is_deleted
        or instance.status != ProductInstance.Status.AVAILABLE
    ):
        raise InstanceUnavailable(
            {
                "detail": "Выбранный экземпляр уже недоступен.",
                "instance": "Обновите список и выберите свободный экземпляр.",
            }
        )

    try:
        booking = RentalBooking.objects.create(
            application=application,
            instance=instance,
            minute_rate_snapshot=application.product.minute_rate,
            starting_price_snapshot=application.product.minute_rate * Decimal("10"),
        )
    except IntegrityError as exc:
        raise InstanceUnavailable() from exc

    instance.status = ProductInstance.Status.RESERVED
    instance.save(update_fields=("status",))
    application.status = RentalApplication.Status.BOOKED
    application.save(update_fields=("status", "updated_at"))
    ApplicationEvent.objects.create(
        application=application,
        event=ApplicationEvent.Event.BOOKED,
        actor=ApplicationEvent.Actor.MANAGER,
    )
    BookingEvent.objects.create(
        booking=booking,
        event=BookingEvent.Event.CREATED,
        actor=BookingEvent.Actor.MANAGER,
    )
    return booking, True


@transaction.atomic
def cancel_booking(
    *, booking: RentalBooking, actor: str, reason: str = ""
) -> RentalBooking:
    locked = (
        RentalBooking.objects.select_for_update()
        .select_related("instance")
        .get(pk=booking.pk)
    )
    if locked.status not in (
        RentalBooking.Status.ACTIVE,
        RentalBooking.Status.ARRIVED,
    ):
        raise ValidationError({"status": "Эта бронь уже завершена."})
    now = timezone.now()
    locked.status = RentalBooking.Status.CANCELLED
    locked.cancellation_reason = reason
    locked.ended_at = now
    locked.save(
        update_fields=(
            "status",
            "cancellation_reason",
            "ended_at",
            "updated_at",
        )
    )
    instance = locked.instance
    instance.status = ProductInstance.Status.AVAILABLE
    instance.save(update_fields=("status",))
    BookingEvent.objects.create(
        booking=locked,
        event=BookingEvent.Event.CANCELLED,
        actor=actor,
        note=reason.strip(),
    )
    return locked


def confirm_booking_arrival(*, booking: RentalBooking) -> RentalBooking:
    deadline_passed = False
    with transaction.atomic():
        locked = (
            RentalBooking.objects.select_for_update()
            .select_related("application", "instance")
            .get(pk=booking.pk)
        )
        if locked.status == RentalBooking.Status.ARRIVED:
            return locked
        if locked.status != RentalBooking.Status.ACTIVE:
            raise ValidationError(
                {"status": "Прибытие нельзя подтвердить для этой брони."}
            )
        now = timezone.now()
        if locked.application.pickup_deadline_at <= now:
            _expire_locked_booking(locked, now)
            deadline_passed = True
        else:
            locked.status = RentalBooking.Status.ARRIVED
            locked.arrival_confirmed_at = now
            locked.save(update_fields=("status", "arrival_confirmed_at", "updated_at"))
            instance = locked.instance
            instance.status = ProductInstance.Status.PICKUP_IN_PROGRESS
            instance.save(update_fields=("status",))
            BookingEvent.objects.create(
                booking=locked,
                event=BookingEvent.Event.ARRIVAL_CONFIRMED,
                actor=BookingEvent.Actor.MANAGER,
            )
    if deadline_passed:
        raise BookingDeadlinePassed()
    return locked


@transaction.atomic
def expire_due_bookings() -> int:
    now = timezone.now()
    bookings = list(
        RentalBooking.objects.select_for_update()
        .select_related("application", "instance")
        .filter(
            status=RentalBooking.Status.ACTIVE,
            application__pickup_deadline_at__lte=now,
        )
    )
    for booking in bookings:
        _expire_locked_booking(booking, now)
    return len(bookings)


def _expire_locked_booking(booking: RentalBooking, expired_at: datetime) -> None:
    booking.status = RentalBooking.Status.EXPIRED
    booking.ended_at = expired_at
    booking.save(update_fields=("status", "ended_at", "updated_at"))
    instance = booking.instance
    instance.status = ProductInstance.Status.AVAILABLE
    instance.save(update_fields=("status",))
    BookingEvent.objects.create(
        booking=booking,
        event=BookingEvent.Event.EXPIRED,
        actor=BookingEvent.Actor.SYSTEM,
    )
