"""Creation helpers shared by business transitions."""

from collections.abc import Callable
import logging
from typing import Any

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db import transaction
from notifications.models import Notification, NotificationSettings

from users.models import User

logger = logging.getLogger(__name__)


RENTER_EVENTS = (
    Notification.Event.APPLICATION_EXPIRED,
    Notification.Event.BOOKING_CREATED,
    Notification.Event.APPLICATION_CANCELLED,
    Notification.Event.BOOKING_CANCELLED,
    Notification.Event.BOOKING_EXPIRED,
    Notification.Event.HANDOVER_STARTED,
    Notification.Event.RENTAL_STARTED,
    Notification.Event.RENTAL_OVERDUE,
    Notification.Event.RETURN_STARTED,
    Notification.Event.RENTAL_COMPLETED,
)

MANAGER_EVENTS = (
    Notification.Event.NEW_APPLICATION,
    Notification.Event.BOOKING_CREATED,
    Notification.Event.APPLICATION_CANCELLED,
    Notification.Event.BOOKING_CANCELLED,
    Notification.Event.BOOKING_EXPIRED,
    Notification.Event.HANDOVER_STARTED,
    Notification.Event.RENTAL_STARTED,
    Notification.Event.RENTAL_OVERDUE,
    Notification.Event.RENTAL_COMPLETED,
    Notification.Event.MODERATION_RESULT,
)

ADMIN_EVENTS = (Notification.Event.PRODUCT_SUBMITTED,)


def available_events_for_user(user: User) -> list[str]:
    if user.is_superuser:
        return list(ADMIN_EVENTS)
    if user.role == User.Role.MANAGER:
        return list(MANAGER_EVENTS)
    return list(RENTER_EVENTS)


def create_notification(
    *,
    recipient: User,
    event_type: str,
    level: str,
    title: str,
    message: str,
    target_url: str,
    target_label: str,
) -> Notification | None:
    settings = NotificationSettings.objects.filter(user=recipient).first()
    if settings and event_type in settings.disabled_events:
        return None
    notification = Notification.objects.create(
        recipient=recipient,
        event_type=event_type,
        level=level,
        title=title,
        message=message,
        target_url=target_url,
        target_label=target_label,
    )
    transaction.on_commit(_delivery_callback(notification.pk))
    return notification


def notify_participants(
    *,
    renter: User,
    manager: User,
    event_type: str,
    level: str,
    title: str,
    message: str,
    renter_target_url: str,
    manager_target_url: str,
    target_label: str,
) -> None:
    create_notification(
        recipient=renter,
        event_type=event_type,
        level=level,
        title=title,
        message=message,
        target_url=renter_target_url,
        target_label=target_label,
    )
    create_notification(
        recipient=manager,
        event_type=event_type,
        level=level,
        title=title,
        message=message,
        target_url=manager_target_url,
        target_label=target_label,
    )


def _delivery_callback(notification_id: int) -> Callable[[], None]:
    return lambda: deliver_notification(notification_id)


def deliver_notification(notification_id: int) -> None:
    notification = Notification.objects.filter(pk=notification_id).first()
    if notification is None:
        return
    channel_layer = get_channel_layer()
    if channel_layer is None:
        return
    try:
        async_to_sync(channel_layer.group_send)(
            notification_group(notification.recipient_id),
            {
                "type": "notification.created",
                "notification": notification_payload(notification),
            },
        )
    except Exception:
        logger.exception(
            "WebSocket delivery failed for notification %s; record remains queued.",
            notification_id,
        )


def notification_group(user_id: int) -> str:
    return f"notifications.user.{user_id}"


def notification_payload(notification: Notification) -> dict[str, Any]:
    return {
        "id": notification.pk,
        "notification_ids": [notification.pk],
        "event_type": notification.event_type,
        "level": notification.level,
        "title": notification.title,
        "message": notification.message,
        "target_url": notification.target_url,
        "target_label": notification.target_label,
        "created_at": notification.created_at.isoformat(),
        "is_aggregate": False,
    }
