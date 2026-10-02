"""Transactional business operations for waiting applications."""

from datetime import datetime
from decimal import Decimal, ROUND_CEILING
from typing import Any

from applications.models import (
    ApplicationEvent,
    BookingEvent,
    HandoverAct,
    HandoverPhoto,
    Rental,
    RentalApplication,
    RentalBooking,
    RentalEvent,
    ReturnAct,
    ReturnPhoto,
)
from django.db import IntegrityError, transaction
from django.db.models import Count
from django.utils import timezone
from rest_framework.exceptions import APIException, ValidationError

from catalog.models import Maintenance, Product, ProductInstance
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


class PlannedReturnPassed(APIException):
    status_code = 409
    default_code = "planned_return_passed"
    default_detail = (
        "Плановый срок возврата уже наступил. Создайте новую заявку "
        "с актуальным сроком."
    )


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
            HandoverAct.objects.get_or_create(booking=locked)
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


def handover_actor_role(user: User) -> str:
    if user.role == User.Role.RENTER:
        return HandoverPhoto.AuthorRole.RENTER
    return HandoverPhoto.AuthorRole.MANAGER


def _locked_handover(booking_id: int) -> HandoverAct:
    booking = (
        RentalBooking.objects.select_for_update()
        .select_related("application", "application__product", "instance")
        .get(pk=booking_id)
    )
    if booking.status != RentalBooking.Status.ARRIVED:
        raise ValidationError(
            {"status": "Фиксация доступна только после подтверждения прибытия."}
        )
    handover, _ = HandoverAct.objects.select_for_update().get_or_create(booking=booking)
    return handover


def _party_field(role: str, suffix: str) -> str:
    prefix = "renter" if role == HandoverPhoto.AuthorRole.RENTER else "manager"
    return f"{prefix}_{suffix}"


def _ensure_party_can_edit(handover: HandoverAct, role: str) -> None:
    if getattr(handover, _party_field(role, "completed_at")) is not None:
        raise ValidationError(
            {"status": "Сначала дождитесь запроса на изменение материалов."}
        )


def _invalidate_confirmations(handover: HandoverAct) -> None:
    handover.renter_confirmed_at = None
    handover.manager_confirmed_at = None


@transaction.atomic
def update_handover_comment(*, booking_id: int, role: str, comment: str) -> HandoverAct:
    handover = _locked_handover(booking_id)
    _ensure_party_can_edit(handover, role)
    setattr(handover, _party_field(role, "comment"), comment.strip())
    revision_field = _party_field(role, "revision")
    setattr(handover, revision_field, getattr(handover, revision_field) + 1)
    _invalidate_confirmations(handover)
    handover.save()
    return handover


@transaction.atomic
def add_handover_photo(
    *, booking_id: int, user: User, role: str, image: Any
) -> HandoverPhoto:
    handover = _locked_handover(booking_id)
    _ensure_party_can_edit(handover, role)
    photo = HandoverPhoto.objects.create(
        handover=handover,
        author=user,
        author_role=role,
        image=image,
    )
    revision_field = _party_field(role, "revision")
    setattr(handover, revision_field, getattr(handover, revision_field) + 1)
    _invalidate_confirmations(handover)
    handover.save()
    return photo


@transaction.atomic
def delete_handover_photo(*, photo: HandoverPhoto, role: str) -> None:
    handover = _locked_handover(photo.handover.booking_id)
    _ensure_party_can_edit(handover, role)
    if photo.author_role != role:
        raise ValidationError({"photo": "Можно удалить только собственную фотографию."})
    image = photo.image
    photo.delete()
    image.delete(save=False)
    revision_field = _party_field(role, "revision")
    setattr(handover, revision_field, getattr(handover, revision_field) + 1)
    _invalidate_confirmations(handover)
    handover.save()


@transaction.atomic
def complete_handover_materials(*, booking_id: int, role: str) -> HandoverAct:
    handover = _locked_handover(booking_id)
    completed_field = _party_field(role, "completed_at")
    if getattr(handover, completed_field) is not None:
        return handover
    photo_count = handover.photos.filter(author_role=role).count()
    if role == HandoverPhoto.AuthorRole.RENTER and photo_count < 2:
        raise ValidationError(
            {"photos": "Арендатор должен добавить минимум 2 фотографии."}
        )
    setattr(handover, completed_field, timezone.now())
    handover.save(update_fields=(completed_field, "updated_at"))
    BookingEvent.objects.create(
        booking=handover.booking,
        event=BookingEvent.Event.MATERIALS_COMPLETED,
        actor=role,
    )
    return handover


def _ensure_both_material_sets_completed(handover: HandoverAct) -> None:
    if not handover.renter_completed_at or not handover.manager_completed_at:
        raise ValidationError(
            {"status": "Сначала обе стороны должны завершить фиксацию."}
        )


@transaction.atomic
def request_handover_changes(*, booking_id: int, requester_role: str) -> HandoverAct:
    handover = _locked_handover(booking_id)
    _ensure_both_material_sets_completed(handover)
    target_role = (
        HandoverPhoto.AuthorRole.MANAGER
        if requester_role == HandoverPhoto.AuthorRole.RENTER
        else HandoverPhoto.AuthorRole.RENTER
    )
    completed_field = _party_field(target_role, "completed_at")
    revision_field = _party_field(target_role, "revision")
    setattr(handover, completed_field, None)
    setattr(handover, revision_field, getattr(handover, revision_field) + 1)
    _invalidate_confirmations(handover)
    handover.save()
    BookingEvent.objects.create(
        booking=handover.booking,
        event=BookingEvent.Event.CHANGES_REQUESTED,
        actor=requester_role,
        note=target_role,
    )
    return handover


@transaction.atomic
def confirm_handover(
    *, booking_id: int, role: str
) -> tuple[HandoverAct, Rental | None]:
    handover = _locked_handover(booking_id)
    _ensure_both_material_sets_completed(handover)
    confirmed_field = _party_field(role, "confirmed_at")
    if getattr(handover, confirmed_field) is not None:
        rental = Rental.objects.filter(booking=handover.booking).first()
        return handover, rental
    other_role = (
        HandoverPhoto.AuthorRole.MANAGER
        if role == HandoverPhoto.AuthorRole.RENTER
        else HandoverPhoto.AuthorRole.RENTER
    )
    other_confirmed = getattr(handover, _party_field(other_role, "confirmed_at"))
    now = timezone.now()
    if other_confirmed and handover.booking.application.planned_return_at <= now:
        raise PlannedReturnPassed()
    setattr(handover, confirmed_field, now)
    handover.save(update_fields=(confirmed_field, "updated_at"))
    BookingEvent.objects.create(
        booking=handover.booking,
        event=BookingEvent.Event.HANDOVER_CONFIRMED,
        actor=role,
    )
    if other_confirmed is None:
        return handover, None
    return handover, _start_rental(handover.booking, now)


def _start_rental(booking: RentalBooking, started_at: datetime) -> Rental:
    rental = Rental.objects.create(
        booking=booking,
        minute_rate_snapshot=booking.minute_rate_snapshot,
        starting_price_snapshot=booking.starting_price_snapshot,
        planned_return_at=booking.application.planned_return_at,
        rental_started_at=started_at,
    )
    booking.status = RentalBooking.Status.RENTED
    booking.save(update_fields=("status", "updated_at"))
    instance = booking.instance
    instance.status = ProductInstance.Status.RENTED
    instance.save(update_fields=("status",))
    BookingEvent.objects.create(
        booking=booking,
        event=BookingEvent.Event.RENTAL_STARTED,
        actor=BookingEvent.Actor.MANAGER,
    )
    return rental


def refresh_overdue_rentals() -> int:
    return Rental.objects.filter(
        status=Rental.Status.ACTIVE,
        planned_return_at__lt=timezone.now(),
    ).update(status=Rental.Status.OVERDUE, updated_at=timezone.now())


def rental_calculation(rental: Rental, calculated_at: datetime) -> dict[str, Any]:
    effective_end = rental.return_received_at or calculated_at
    timely_end = min(effective_end, rental.planned_return_at)
    timely_seconds = max(
        Decimal("0"),
        Decimal(str((timely_end - rental.rental_started_at).total_seconds())),
    )
    late_start = max(rental.rental_started_at, rental.planned_return_at)
    late_seconds = max(
        Decimal("0"), Decimal(str((effective_end - late_start).total_seconds()))
    )
    timely_minutes = _ceil_minutes(timely_seconds)
    late_minutes = _ceil_minutes(late_seconds)
    timely_cost = timely_minutes * rental.minute_rate_snapshot
    late_base_cost = late_minutes * rental.minute_rate_snapshot
    late_surcharge = late_base_cost
    damage_amount = Decimal("0")
    late_surcharge_waived = False
    try:
        return_act = rental.return_act
    except ReturnAct.DoesNotExist:
        return_act = None
    if return_act is not None:
        late_surcharge_waived = return_act.late_surcharge_waived
        if late_surcharge_waived:
            late_surcharge = Decimal("0")
        if return_act.damage_enabled:
            damage_amount = return_act.damage_amount
    late_cost = late_base_cost + late_surcharge
    total = rental.starting_price_snapshot + timely_cost + late_cost + damage_amount
    return {
        "calculated_at": effective_end,
        "duration_minutes": timely_minutes + late_minutes,
        "timely_minutes": timely_minutes,
        "late_minutes": late_minutes,
        "timely_cost": timely_cost.quantize(Decimal("0.01")),
        "late_base_cost": late_base_cost.quantize(Decimal("0.01")),
        "late_surcharge": late_surcharge.quantize(Decimal("0.01")),
        "late_surcharge_waived": late_surcharge_waived,
        "late_cost": late_cost.quantize(Decimal("0.01")),
        "damage_amount": damage_amount.quantize(Decimal("0.01")),
        "current_cost": total.quantize(Decimal("0.01")),
    }


def _ceil_minutes(seconds: Decimal) -> int:
    return int((seconds / Decimal("60")).quantize(Decimal("1"), rounding=ROUND_CEILING))


def return_actor_role(user: User) -> str:
    if user.role == User.Role.RENTER:
        return ReturnPhoto.AuthorRole.RENTER
    return ReturnPhoto.AuthorRole.MANAGER


@transaction.atomic
def receive_return(*, rental_id: int) -> Rental:
    rental = (
        Rental.objects.select_for_update()
        .select_related("booking__instance")
        .get(pk=rental_id)
    )
    if rental.status in (Rental.Status.RETURN_INSPECTION, Rental.Status.COMPLETED):
        return rental
    if rental.status not in (Rental.Status.ACTIVE, Rental.Status.OVERDUE):
        raise ValidationError({"status": "Эту аренду нельзя принять к возврату."})
    received_at = timezone.now()
    rental.status = Rental.Status.RETURN_INSPECTION
    rental.return_received_at = received_at
    rental.save(update_fields=("status", "return_received_at", "updated_at"))
    instance = rental.booking.instance
    instance.status = ProductInstance.Status.RETURN_INSPECTION
    instance.save(update_fields=("status",))
    ReturnAct.objects.get_or_create(rental=rental)
    RentalEvent.objects.create(
        rental=rental,
        event=RentalEvent.Event.RETURN_RECEIVED,
        actor=RentalEvent.Actor.MANAGER,
    )
    return rental


def _locked_return_act(rental_id: int) -> ReturnAct:
    rental = (
        Rental.objects.select_for_update()
        .select_related(
            "booking__instance",
            "booking__application",
            "booking__application__product",
        )
        .get(pk=rental_id)
    )
    if rental.status != Rental.Status.RETURN_INSPECTION:
        raise ValidationError(
            {"status": "Возврат можно оформлять только после остановки начисления."}
        )
    return ReturnAct.objects.select_for_update().get(rental=rental)


def _return_party_field(role: str, suffix: str) -> str:
    prefix = "renter" if role == ReturnPhoto.AuthorRole.RENTER else "manager"
    return f"{prefix}_{suffix}"


def _invalidate_return_confirmations(return_act: ReturnAct) -> None:
    return_act.renter_confirmed_at = None
    return_act.manager_confirmed_at = None
    return_act.next_instance_status = ""


def _ensure_return_party_can_edit(return_act: ReturnAct, role: str) -> None:
    if (
        role == ReturnPhoto.AuthorRole.MANAGER
        and return_act.damage_decision == ReturnAct.DamageDecision.REJECTED
    ):
        raise ValidationError(
            {"status": "После отказа можно изменить только сумму штрафа."}
        )
    if getattr(return_act, _return_party_field(role, "completed_at")) is not None:
        raise ValidationError(
            {"status": "Сначала дождитесь запроса на изменение материалов."}
        )


@transaction.atomic
def update_return_comment(*, rental_id: int, role: str, comment: str) -> ReturnAct:
    return_act = _locked_return_act(rental_id)
    _ensure_return_party_can_edit(return_act, role)
    setattr(return_act, _return_party_field(role, "comment"), comment.strip())
    revision_field = _return_party_field(role, "revision")
    setattr(return_act, revision_field, getattr(return_act, revision_field) + 1)
    _invalidate_return_confirmations(return_act)
    return_act.save()
    return return_act


@transaction.atomic
def add_return_photo(
    *, rental_id: int, user: User, role: str, image: Any
) -> ReturnPhoto:
    return_act = _locked_return_act(rental_id)
    _ensure_return_party_can_edit(return_act, role)
    photo = ReturnPhoto.objects.create(
        return_act=return_act,
        author=user,
        author_role=role,
        image=image,
    )
    revision_field = _return_party_field(role, "revision")
    setattr(return_act, revision_field, getattr(return_act, revision_field) + 1)
    _invalidate_return_confirmations(return_act)
    return_act.save()
    return photo


@transaction.atomic
def delete_return_photo(*, photo: ReturnPhoto, role: str) -> None:
    return_act = _locked_return_act(photo.return_act.rental_id)
    _ensure_return_party_can_edit(return_act, role)
    if photo.author_role != role:
        raise ValidationError({"photo": "Можно удалить только собственную фотографию."})
    image = photo.image
    photo.delete()
    image.delete(save=False)
    revision_field = _return_party_field(role, "revision")
    setattr(return_act, revision_field, getattr(return_act, revision_field) + 1)
    _invalidate_return_confirmations(return_act)
    return_act.save()


@transaction.atomic
def update_return_financials(*, rental_id: int, values: dict[str, Any]) -> ReturnAct:
    return_act = _locked_return_act(rental_id)
    restricted = return_act.damage_decision == ReturnAct.DamageDecision.REJECTED
    if restricted:
        if set(values) != {"damage_amount"}:
            raise ValidationError(
                {"status": "После отказа можно изменить только сумму штрафа."}
            )
        return_act.damage_amount = values["damage_amount"]
        return_act.damage_decision = ReturnAct.DamageDecision.PENDING
        return_act.manager_completed_at = timezone.now()
        return_act.manager_revision += 1
        _invalidate_return_confirmations(return_act)
        return_act.save()
        RentalEvent.objects.create(
            rental=return_act.rental,
            event=RentalEvent.Event.DAMAGE_UPDATED,
            actor=RentalEvent.Actor.MANAGER,
            note=f"Новая сумма: {return_act.damage_amount}",
        )
        return return_act
    _ensure_return_party_can_edit(return_act, ReturnPhoto.AuthorRole.MANAGER)
    was_waived = return_act.late_surcharge_waived
    for field in (
        "late_surcharge_waived",
        "late_surcharge_waiver_reason",
        "damage_enabled",
        "damage_description",
        "damage_amount",
    ):
        if field in values:
            setattr(return_act, field, values[field])
    return_act.late_surcharge_waiver_reason = (
        return_act.late_surcharge_waiver_reason.strip()
    )
    return_act.damage_description = return_act.damage_description.strip()
    if return_act.late_surcharge_waived:
        return_act.late_surcharge_waived_at = (
            return_act.late_surcharge_waived_at or timezone.now()
        )
    else:
        return_act.late_surcharge_waived_at = None
        return_act.late_surcharge_waiver_reason = ""
    if return_act.damage_enabled:
        return_act.damage_decision = ReturnAct.DamageDecision.PENDING
    else:
        return_act.damage_description = ""
        return_act.damage_amount = Decimal("0")
        return_act.damage_decision = ReturnAct.DamageDecision.NONE
    return_act.manager_revision += 1
    _invalidate_return_confirmations(return_act)
    return_act.save()
    if return_act.late_surcharge_waived and not was_waived:
        RentalEvent.objects.create(
            rental=return_act.rental,
            event=RentalEvent.Event.SURCHARGE_WAIVED,
            actor=RentalEvent.Actor.MANAGER,
            note=return_act.late_surcharge_waiver_reason,
        )
    RentalEvent.objects.create(
        rental=return_act.rental,
        event=RentalEvent.Event.DAMAGE_UPDATED,
        actor=RentalEvent.Actor.MANAGER,
    )
    return return_act


@transaction.atomic
def complete_return_materials(*, rental_id: int, role: str) -> ReturnAct:
    return_act = _locked_return_act(rental_id)
    _ensure_return_party_can_edit(return_act, role)
    if return_act.photos.filter(author_role=role).count() < 1:
        raise ValidationError({"photos": "Добавьте минимум одну фотографию возврата."})
    if (
        role == ReturnPhoto.AuthorRole.MANAGER
        and return_act.damage_enabled
        and not return_act.damage_description.strip()
    ):
        raise ValidationError(
            {"damage_description": "Опишите повреждение перед завершением фиксации."}
        )
    completed_field = _return_party_field(role, "completed_at")
    setattr(return_act, completed_field, timezone.now())
    return_act.save(update_fields=(completed_field, "updated_at"))
    RentalEvent.objects.create(
        rental=return_act.rental,
        event=RentalEvent.Event.MATERIALS_COMPLETED,
        actor=role,
    )
    return return_act


def _ensure_return_materials_completed(return_act: ReturnAct) -> None:
    if not return_act.renter_completed_at or not return_act.manager_completed_at:
        raise ValidationError(
            {"status": "Сначала обе стороны должны завершить фиксацию."}
        )


@transaction.atomic
def request_return_changes(*, rental_id: int, requester_role: str) -> ReturnAct:
    return_act = _locked_return_act(rental_id)
    _ensure_return_materials_completed(return_act)
    target_role = (
        ReturnPhoto.AuthorRole.MANAGER
        if requester_role == ReturnPhoto.AuthorRole.RENTER
        else ReturnPhoto.AuthorRole.RENTER
    )
    completed_field = _return_party_field(target_role, "completed_at")
    revision_field = _return_party_field(target_role, "revision")
    setattr(return_act, completed_field, None)
    setattr(return_act, revision_field, getattr(return_act, revision_field) + 1)
    _invalidate_return_confirmations(return_act)
    return_act.save()
    RentalEvent.objects.create(
        rental=return_act.rental,
        event=RentalEvent.Event.CHANGES_REQUESTED,
        actor=requester_role,
        note=target_role,
    )
    return return_act


@transaction.atomic
def decide_return_damage(*, rental_id: int, accepted: bool) -> ReturnAct:
    return_act = _locked_return_act(rental_id)
    _ensure_return_materials_completed(return_act)
    if not return_act.damage_enabled:
        raise ValidationError({"damage": "Штраф за повреждение не указан."})
    event = (
        RentalEvent.Event.DAMAGE_ACCEPTED
        if accepted
        else RentalEvent.Event.DAMAGE_REJECTED
    )
    return_act.damage_decision = (
        ReturnAct.DamageDecision.ACCEPTED
        if accepted
        else ReturnAct.DamageDecision.REJECTED
    )
    if not accepted:
        return_act.manager_completed_at = None
        _invalidate_return_confirmations(return_act)
    return_act.save()
    RentalEvent.objects.create(
        rental=return_act.rental,
        event=event,
        actor=RentalEvent.Actor.RENTER,
        note=f"Сумма: {return_act.damage_amount}",
    )
    if accepted:
        _try_complete_return(return_act)
    return return_act


@transaction.atomic
def confirm_return(*, rental_id: int, role: str) -> ReturnAct:
    return_act = _locked_return_act(rental_id)
    _ensure_return_materials_completed(return_act)
    confirmed_field = _return_party_field(role, "confirmed_at")
    if getattr(return_act, confirmed_field) is None:
        setattr(return_act, confirmed_field, timezone.now())
        return_act.save(update_fields=(confirmed_field, "updated_at"))
        RentalEvent.objects.create(
            rental=return_act.rental,
            event=RentalEvent.Event.RETURN_CONFIRMED,
            actor=role,
        )
    _try_complete_return(return_act)
    return return_act


@transaction.atomic
def finish_return(
    *,
    rental_id: int,
    next_instance_status: str,
    maintenance_reason: str = "",
) -> ReturnAct:
    return_act = _locked_return_act(rental_id)
    _ensure_return_materials_completed(return_act)
    if next_instance_status not in (
        ProductInstance.Status.AVAILABLE,
        ProductInstance.Status.MAINTENANCE,
    ):
        raise ValidationError(
            {"next_instance_status": "Выберите состояние экземпляра."}
        )
    normalized_reason = maintenance_reason.strip()
    if (
        next_instance_status == ProductInstance.Status.MAINTENANCE
        and not normalized_reason
    ):
        normalized_reason = return_act.damage_description.strip()
    if (
        next_instance_status == ProductInstance.Status.MAINTENANCE
        and not normalized_reason
    ):
        raise ValidationError({"maintenance_reason": "Укажите причину обслуживания."})
    return_act.next_instance_status = next_instance_status
    return_act.maintenance_reason = normalized_reason
    if return_act.manager_confirmed_at is None:
        return_act.manager_confirmed_at = timezone.now()
        RentalEvent.objects.create(
            rental=return_act.rental,
            event=RentalEvent.Event.RETURN_CONFIRMED,
            actor=RentalEvent.Actor.MANAGER,
        )
    return_act.save()
    _try_complete_return(return_act)
    return return_act


def _try_complete_return(return_act: ReturnAct) -> None:
    if not return_act.renter_confirmed_at or not return_act.manager_confirmed_at:
        return
    if return_act.damage_enabled and (
        return_act.damage_decision != ReturnAct.DamageDecision.ACCEPTED
    ):
        return
    if not return_act.next_instance_status:
        return
    rental = return_act.rental
    rental.status = Rental.Status.COMPLETED
    rental.ended_at = timezone.now()
    rental.save(update_fields=("status", "ended_at", "updated_at"))
    instance = rental.booking.instance
    instance.status = return_act.next_instance_status
    instance.save(update_fields=("status",))
    if return_act.next_instance_status == ProductInstance.Status.MAINTENANCE:
        Maintenance.objects.get_or_create(
            source_return_act=return_act,
            defaults={
                "instance": instance,
                "started_by": rental.booking.application.product.manager,
                "reason": return_act.maintenance_reason,
            },
        )
    RentalEvent.objects.create(
        rental=rental,
        event=RentalEvent.Event.RETURN_COMPLETED,
        actor=RentalEvent.Actor.MANAGER,
        note=return_act.next_instance_status,
    )
