"""Notification REST behavior and preferences."""

from django.utils import timezone
from notifications.models import Notification, NotificationSettings
from notifications.services import create_notification
import pytest
from rest_framework.test import APIClient

from catalog.tests.factories import TEST_PASSWORD
from users.models import User

pytestmark = pytest.mark.django_db


def create_renter() -> User:
    return User.objects.create_user(
        email="renter-notifications@example.com",
        password=TEST_PASSWORD,
        name="Марина Волкова",
        role=User.Role.RENTER,
    )


def authenticated_client(user: User) -> APIClient:
    client = APIClient()
    client.force_login(user)
    return client


def add_notification(user: User, title: str = "Бронь подтверждена") -> Notification:
    return Notification.objects.create(
        recipient=user,
        event_type=Notification.Event.BOOKING_CREATED,
        level=Notification.Level.INFO,
        title=title,
        message="Для заявки назначен экземпляр товара Дрель.",
        target_url="/account/bookings/1",
        target_label="К брони",
    )


def test_user_lists_only_own_notifications_and_unread_count() -> None:
    renter = create_renter()
    other = User.objects.create_user(
        email="other-notifications@example.com",
        password=TEST_PASSWORD,
        name="Другой пользователь",
        role=User.Role.RENTER,
    )
    add_notification(renter)
    add_notification(other, "Чужая бронь")

    response = authenticated_client(renter).get("/api/v1/notifications/")

    assert response.status_code == 200
    assert response.json()["unread_count"] == 1
    assert [item["title"] for item in response.json()["results"]] == [
        "Бронь подтверждена"
    ]


def test_mark_all_read_and_delete_are_scoped_to_current_user() -> None:
    renter = create_renter()
    notification = add_notification(renter)
    client = authenticated_client(renter)

    marked = client.post("/api/v1/notifications/read-all/")
    deleted = client.delete(f"/api/v1/notifications/{notification.pk}/")

    assert marked.status_code == 200
    assert marked.json() == {"updated": 1, "unread_count": 0}
    assert deleted.status_code == 204
    assert not Notification.objects.filter(pk=notification.pk).exists()


def test_disabled_event_prevents_future_notification_creation() -> None:
    renter = create_renter()
    settings = NotificationSettings.objects.create(
        user=renter,
        disabled_events=[Notification.Event.BOOKING_CREATED],
    )

    notification = create_notification(
        recipient=renter,
        event_type=Notification.Event.BOOKING_CREATED,
        level=Notification.Level.INFO,
        title="Бронь подтверждена",
        message="Текст",
        target_url="/account/bookings/1",
        target_label="К брони",
    )

    assert settings.sound_enabled is True
    assert notification is None
    assert Notification.objects.count() == 0


def test_notification_settings_accept_only_events_available_to_role() -> None:
    renter = create_renter()
    client = authenticated_client(renter)

    response = client.patch(
        "/api/v1/notifications/settings/",
        {
            "sound_enabled": False,
            "enabled_events": [Notification.Event.BOOKING_CREATED],
        },
        format="json",
    )

    assert response.status_code == 200
    assert response.json()["sound_enabled"] is False
    assert response.json()["enabled_events"] == [Notification.Event.BOOKING_CREATED]


def test_mark_selected_read_supports_aggregate_popup() -> None:
    renter = create_renter()
    first = add_notification(renter, "Первая")
    second = add_notification(renter, "Вторая")
    already_read = add_notification(renter, "Прочитана")
    already_read.read_at = timezone.now()
    already_read.save(update_fields=("read_at",))

    response = authenticated_client(renter).post(
        "/api/v1/notifications/read/",
        {"ids": [first.pk, second.pk, already_read.pk]},
        format="json",
    )

    assert response.status_code == 200
    assert response.json() == {"updated": 2, "unread_count": 0}
