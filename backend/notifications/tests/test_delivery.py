"""Offline WebSocket card construction."""

from django.utils import timezone
from notifications.delivery import build_backlog_cards
from notifications.models import Notification
import pytest

from catalog.tests.factories import TEST_PASSWORD
from users.models import User

pytestmark = pytest.mark.django_db


def create_manager() -> User:
    return User.objects.create_user(
        email="manager-notifications@example.com",
        password=TEST_PASSWORD,
        name="Алексей Петров",
        role=User.Role.MANAGER,
    )


def add_notification(user: User, event_type: str, title: str) -> Notification:
    return Notification.objects.create(
        recipient=user,
        event_type=event_type,
        level=(
            Notification.Level.WARNING
            if event_type == Notification.Event.BOOKING_EXPIRED
            else Notification.Level.INFO
        ),
        title=title,
        message="Текст уведомления",
        target_url="/manager/applications",
        target_label="К объекту",
    )


def test_manager_backlog_aggregates_only_applications_and_expired_bookings() -> None:
    manager = create_manager()
    application_ids = [
        add_notification(manager, Notification.Event.NEW_APPLICATION, "Новая заявка").pk
        for _ in range(4)
    ]
    expired_ids = [
        add_notification(
            manager, Notification.Event.BOOKING_EXPIRED, "Бронь истекла"
        ).pk
        for _ in range(2)
    ]
    moderation = add_notification(
        manager,
        Notification.Event.MODERATION_RESULT,
        "Нужны исправления в карточке",
    )

    cards = build_backlog_cards(manager)

    assert cards[0]["title"] == "У вас 4 новых заявок"
    assert cards[0]["notification_ids"] == application_ids[::-1]
    assert cards[1]["title"] == "Истекло 2 броней"
    assert cards[1]["notification_ids"] == expired_ids[::-1]
    assert cards[2]["id"] == moderation.pk
    assert cards[2]["event_type"] == Notification.Event.MODERATION_RESULT


def test_backlog_excludes_read_and_already_delivered_notifications() -> None:
    manager = create_manager()
    unread = add_notification(
        manager,
        Notification.Event.MODERATION_RESULT,
        "Непрочитанный результат",
    )
    read = add_notification(
        manager,
        Notification.Event.MODERATION_RESULT,
        "Прочитанный результат",
    )
    delivered = add_notification(
        manager,
        Notification.Event.MODERATION_RESULT,
        "Уже показанный результат",
    )
    Notification.objects.filter(pk=read.pk).update(read_at=timezone.now())
    Notification.objects.filter(pk=delivered.pk).update(delivered_at=timezone.now())

    cards = build_backlog_cards(manager)

    assert [card["id"] for card in cards] == [unread.pk]
