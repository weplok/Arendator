"""Build durable offline delivery cards for WebSocket connections."""

from collections.abc import Iterable
from typing import Any

from notifications.models import Notification
from notifications.services import notification_payload

from users.models import User


def build_backlog_cards(user: User) -> list[dict[str, Any]]:
    notifications = list(
        Notification.objects.filter(
            recipient=user,
            delivered_at__isnull=True,
            read_at__isnull=True,
        ).order_by("-created_at", "-id")
    )
    if user.role != User.Role.MANAGER or user.is_superuser:
        return [notification_payload(item) for item in notifications]

    new_applications = _matching(
        notifications,
        Notification.Event.NEW_APPLICATION,
    )
    expired_bookings = _matching(
        notifications,
        Notification.Event.BOOKING_EXPIRED,
    )
    aggregated_ids = {item.pk for item in (*new_applications, *expired_bookings)}
    cards: list[dict[str, Any]] = []
    if new_applications:
        cards.append(
            _aggregate_card(
                new_applications,
                title=f"У вас {len(new_applications)} новых заявок",
                message="Посмотрите новые заявки от арендаторов.",
                target_url="/manager/applications?status=new",
                target_label="К новым заявкам",
                level=Notification.Level.INFO,
            )
        )
    if expired_bookings:
        cards.append(
            _aggregate_card(
                expired_bookings,
                title=f"Истекло {len(expired_bookings)} броней",
                message=(
                    "Срок получения истёк, назначенные экземпляры автоматически "
                    "освобождены."
                ),
                target_url="/manager/bookings?status=expired",
                target_label="К истёкшим броням",
                level=Notification.Level.WARNING,
            )
        )
    cards.extend(
        notification_payload(item)
        for item in notifications
        if item.pk not in aggregated_ids
    )
    return cards


def _matching(
    notifications: Iterable[Notification], event_type: str
) -> list[Notification]:
    return [item for item in notifications if item.event_type == event_type]


def _aggregate_card(
    notifications: list[Notification],
    *,
    title: str,
    message: str,
    target_url: str,
    target_label: str,
    level: str,
) -> dict[str, Any]:
    newest = notifications[0]
    return {
        "id": f"aggregate-{newest.event_type.lower()}",
        "notification_ids": [item.pk for item in notifications],
        "event_type": newest.event_type,
        "level": level,
        "title": title,
        "message": message,
        "target_url": target_url,
        "target_label": target_label,
        "created_at": newest.created_at.isoformat(),
        "is_aggregate": True,
    }
