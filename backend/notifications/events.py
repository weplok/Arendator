"""Notification content for domain events from SPEC.md section 17."""

from applications.models import Rental, RentalApplication, RentalBooking
from notifications.models import Notification
from notifications.services import create_notification, notify_participants

from catalog.models import Product
from users.models import User


def notify_new_application(application: RentalApplication) -> None:
    create_notification(
        recipient=application.product.manager,
        event_type=Notification.Event.NEW_APPLICATION,
        level=Notification.Level.INFO,
        title="Новая заявка на товар",
        message=(
            f"Арендатор: {application.renter.name}. "
            f"Получена заявка на {application.product.name}."
        ),
        target_url=f"/manager/applications/{application.pk}",
        target_label="К заявке",
    )


def notify_application_expired(application: RentalApplication) -> None:
    create_notification(
        recipient=application.renter,
        event_type=Notification.Event.APPLICATION_EXPIRED,
        level=Notification.Level.WARNING,
        title="Срок заявки истёк",
        message=f"Для заявки на {application.product.name} не была создана бронь.",
        target_url=f"/account/applications/{application.pk}",
        target_label="К заявке",
    )


def notify_application_cancelled(
    application: RentalApplication,
    *,
    actor: str,
) -> None:
    actor_label = _actor_label(actor)
    create_notification(
        recipient=application.renter,
        event_type=Notification.Event.APPLICATION_CANCELLED,
        level=Notification.Level.WARNING,
        title="Заявка отменена",
        message=(
            f"{actor_label} отменил заявку на {application.product.name}."
            if actor != "SYSTEM"
            else f"Заявка на {application.product.name} отменена системой."
        ),
        target_url=f"/account/applications/{application.pk}",
        target_label="К заявке",
    )
    if actor == "RENTER":
        create_notification(
            recipient=application.product.manager,
            event_type=Notification.Event.APPLICATION_CANCELLED,
            level=Notification.Level.INFO,
            title="Арендатор отменил заявку",
            message=(
                f"Арендатор: {application.renter.name}. "
                f"Отменена заявка на {application.product.name}."
            ),
            target_url=f"/manager/applications/{application.pk}",
            target_label="К заявке",
        )


def notify_booking_created(booking: RentalBooking) -> None:
    application = booking.application
    notify_participants(
        renter=application.renter,
        manager=application.product.manager,
        event_type=Notification.Event.BOOKING_CREATED,
        level=Notification.Level.INFO,
        title="Бронь подтверждена",
        message=f"Для заявки на {application.product.name} назначен экземпляр.",
        renter_target_url=f"/account/bookings/{booking.pk}",
        manager_target_url=f"/manager/bookings/{booking.pk}",
        target_label="К брони",
    )


def notify_booking_cancelled(booking: RentalBooking, *, actor: str) -> None:
    application = booking.application
    create_notification(
        recipient=application.renter,
        event_type=Notification.Event.BOOKING_CANCELLED,
        level=Notification.Level.WARNING,
        title="Бронь отменена",
        message=f"Бронь товара {application.product.name} отменена.",
        target_url=f"/account/bookings/{booking.pk}",
        target_label="К брони",
    )
    if actor == "RENTER":
        create_notification(
            recipient=application.product.manager,
            event_type=Notification.Event.BOOKING_CANCELLED,
            level=Notification.Level.WARNING,
            title="Арендатор отменил бронь",
            message=(
                f"Арендатор: {application.renter.name}. "
                f"Отменена бронь товара {application.product.name}."
            ),
            target_url=f"/manager/bookings/{booking.pk}",
            target_label="К брони",
        )


def notify_booking_expired(booking: RentalBooking) -> None:
    application = booking.application
    notify_participants(
        renter=application.renter,
        manager=application.product.manager,
        event_type=Notification.Event.BOOKING_EXPIRED,
        level=Notification.Level.WARNING,
        title="Срок получения истёк",
        message=(
            f"Бронь товара {application.product.name} истекла, экземпляр освобождён."
        ),
        renter_target_url=f"/account/bookings/{booking.pk}",
        manager_target_url=f"/manager/bookings/{booking.pk}",
        target_label="К брони",
    )


def notify_handover_started(booking: RentalBooking) -> None:
    application = booking.application
    notify_participants(
        renter=application.renter,
        manager=application.product.manager,
        event_type=Notification.Event.HANDOVER_STARTED,
        level=Notification.Level.INFO,
        title="Началась приёмка товара",
        message=f"Началось оформление выдачи товара {application.product.name}.",
        renter_target_url=f"/account/bookings/{booking.pk}/handover",
        manager_target_url=f"/manager/bookings/{booking.pk}/handover",
        target_label="К выдаче",
    )


def notify_rental_started(rental: Rental) -> None:
    application = rental.booking.application
    notify_participants(
        renter=application.renter,
        manager=application.product.manager,
        event_type=Notification.Event.RENTAL_STARTED,
        level=Notification.Level.INFO,
        title="Аренда началась",
        message=f"Выдача товара {application.product.name} завершена.",
        renter_target_url=f"/account/rentals/{rental.pk}",
        manager_target_url=f"/manager/rentals/{rental.pk}",
        target_label="К аренде",
    )


def notify_rental_overdue(rental: Rental) -> None:
    application = rental.booking.application
    notify_participants(
        renter=application.renter,
        manager=application.product.manager,
        event_type=Notification.Event.RENTAL_OVERDUE,
        level=Notification.Level.WARNING,
        title="Плановый срок возврата истёк",
        message=f"Аренда товара {application.product.name} перешла в просрочку.",
        renter_target_url=f"/account/rentals/{rental.pk}",
        manager_target_url=f"/manager/rentals/{rental.pk}",
        target_label="К аренде",
    )


def notify_return_started(rental: Rental) -> None:
    application = rental.booking.application
    create_notification(
        recipient=application.renter,
        event_type=Notification.Event.RETURN_STARTED,
        level=Notification.Level.INFO,
        title="Началась приёмка возврата",
        message=f"Началось оформление возврата товара {application.product.name}.",
        target_url=f"/account/rentals/{rental.pk}/return",
        target_label="К возврату",
    )


def notify_rental_completed(rental: Rental) -> None:
    application = rental.booking.application
    notify_participants(
        renter=application.renter,
        manager=application.product.manager,
        event_type=Notification.Event.RENTAL_COMPLETED,
        level=Notification.Level.INFO,
        title="Аренда завершена",
        message=f"Возврат товара {application.product.name} завершён.",
        renter_target_url=f"/account/rentals/{rental.pk}",
        manager_target_url=f"/manager/rentals/{rental.pk}",
        target_label="К аренде",
    )


def notify_moderation_result(product: Product, *, approved: bool) -> None:
    title = "Карточка опубликована" if approved else "Нужны исправления в карточке"
    message = (
        f"Карточка товара {product.name} опубликована."
        if approved
        else (
            f"Карточка товара {product.name} отклонена. "
            "Причина доступна в редакторе товара."
        )
    )
    target_url = (
        f"/manager/products/{product.pk}"
        if approved
        else f"/manager/products/{product.pk}/basic"
    )
    create_notification(
        recipient=product.manager,
        event_type=Notification.Event.MODERATION_RESULT,
        level=(Notification.Level.INFO if approved else Notification.Level.WARNING),
        title=title,
        message=message,
        target_url=target_url,
        target_label="К товару",
    )


def notify_product_hidden(product: Product) -> None:
    create_notification(
        recipient=product.manager,
        event_type=Notification.Event.MODERATION_RESULT,
        level=Notification.Level.WARNING,
        title="Карточка скрыта администратором",
        message=(f"Карточка товара {product.name} скрыта из каталога администратором."),
        target_url=f"/manager/products/{product.pk}",
        target_label="К товару",
    )


def notify_product_restored(product: Product) -> None:
    create_notification(
        recipient=product.manager,
        event_type=Notification.Event.MODERATION_RESULT,
        level=Notification.Level.INFO,
        title="Карточка снова опубликована",
        message=f"Карточка товара {product.name} возвращена в каталог.",
        target_url=f"/manager/products/{product.pk}",
        target_label="К товару",
    )


def notify_product_submitted(product: Product) -> None:
    administrators = User.objects.filter(is_staff=True, is_active=True)
    for administrator in administrators:
        create_notification(
            recipient=administrator,
            event_type=Notification.Event.PRODUCT_SUBMITTED,
            level=Notification.Level.INFO,
            title="Новая карточка на модерации",
            message=(
                f"Менеджер: {product.manager.name}. "
                f"Карточка товара {product.name} ожидает решения."
            ),
            target_url=f"/admin/catalog/product/{product.pk}/change/",
            target_label="К товару",
        )


def _actor_label(actor: str) -> str:
    labels = {"RENTER": "Арендатор", "MANAGER": "Менеджер"}
    return labels.get(actor, "Пользователь")
