"""Return inspection, damage decision, and rental completion API tests."""

from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any

from applications.models import (
    Rental,
    RentalApplication,
    RentalBooking,
    ReturnPhoto,
)
from applications.services import rental_calculation
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from django.utils.dateparse import parse_datetime
import pytest
from rest_framework.test import APIClient

from catalog.models import ProductInstance
from catalog.tests.factories import create_product, make_png, TEST_PASSWORD
from users.models import User

pytestmark = pytest.mark.django_db


def create_renter(email: str = "return-renter@example.com") -> User:
    return User.objects.create_user(
        email=email,
        password=TEST_PASSWORD,
        name="Анна Смирнова",
        role=User.Role.RENTER,
    )


def authenticated_client(user: User) -> APIClient:
    client = APIClient()
    client.force_login(user)
    return client


def create_overdue_rental(now: datetime) -> tuple[Rental, User]:
    product = create_product(status="PUBLISHED")
    renter = create_renter()
    application = RentalApplication.objects.create(
        product=product,
        renter=renter,
        pickup_deadline_at=now - timedelta(hours=2),
        planned_return_at=now - timedelta(minutes=10),
    )
    instance = product.instances.get()
    instance.status = ProductInstance.Status.RENTED
    instance.save(update_fields=("status",))
    booking = RentalBooking.objects.create(
        application=application,
        instance=instance,
        status=RentalBooking.Status.RENTED,
        minute_rate_snapshot=product.minute_rate,
        starting_price_snapshot=product.minute_rate * Decimal("10"),
    )
    rental = Rental.objects.create(
        booking=booking,
        status=Rental.Status.OVERDUE,
        minute_rate_snapshot=booking.minute_rate_snapshot,
        starting_price_snapshot=booking.starting_price_snapshot,
        planned_return_at=application.planned_return_at,
        rental_started_at=now - timedelta(minutes=20),
    )
    return rental, renter


def upload_photo(client: APIClient, rental_id: int, name: str) -> Any:
    return client.post(
        f"/api/v1/rentals/{rental_id}/return/photos/",
        {
            "image": SimpleUploadedFile(
                name,
                make_png(),
                content_type="image/png",
            )
        },
        format="multipart",
    )


def receive_and_add_photos(
    rental: Rental,
    renter: User,
) -> tuple[APIClient, APIClient]:
    manager_client = authenticated_client(rental.booking.application.product.manager)
    renter_client = authenticated_client(renter)
    received = manager_client.post(
        f"/api/v1/manager/rentals/{rental.pk}/return/receive/"
    )
    assert received.status_code == 200, received.json()
    assert upload_photo(renter_client, rental.pk, "renter.png").status_code == 201
    assert upload_photo(manager_client, rental.pk, "manager.png").status_code == 201
    return manager_client, renter_client


def test_manager_receives_return_and_stops_accrual_at_server_time(
    monkeypatch: Any,
) -> None:
    received_at = timezone.now().replace(microsecond=0)
    rental, _ = create_overdue_rental(received_at)
    manager_client = authenticated_client(rental.booking.application.product.manager)
    monkeypatch.setattr("applications.services.timezone.now", lambda: received_at)

    response = manager_client.post(
        f"/api/v1/manager/rentals/{rental.pk}/return/receive/"
    )
    rental.refresh_from_db()
    rental.booking.instance.refresh_from_db()
    later = rental_calculation(rental, received_at + timedelta(hours=3))

    assert response.status_code == 200, response.json()
    assert rental.status == Rental.Status.RETURN_INSPECTION
    assert rental.return_received_at == received_at
    assert rental.booking.instance.status == ProductInstance.Status.RETURN_INSPECTION
    assert parse_datetime(response.json()["calculated_at"]) == received_at
    assert later["duration_minutes"] == 20


def test_both_parties_need_one_return_photo(tmp_path: Any, settings: Any) -> None:
    settings.MEDIA_ROOT = tmp_path
    rental, renter = create_overdue_rental(timezone.now())
    manager_client = authenticated_client(rental.booking.application.product.manager)
    renter_client = authenticated_client(renter)
    manager_client.post(f"/api/v1/manager/rentals/{rental.pk}/return/receive/")

    missing_photo = renter_client.post(f"/api/v1/rentals/{rental.pk}/return/complete/")
    upload_photo(renter_client, rental.pk, "condition.png")
    completed = renter_client.post(f"/api/v1/rentals/{rental.pk}/return/complete/")

    assert missing_photo.status_code == 400
    assert missing_photo.json()["field_errors"]["photos"] == [
        "Добавьте минимум одну фотографию возврата."
    ]
    assert completed.status_code == 200, completed.json()
    assert completed.json()["return_act"]["renter"]["is_completed"] is True


def test_waiver_removes_only_late_surcharge(tmp_path: Any, settings: Any) -> None:
    settings.MEDIA_ROOT = tmp_path
    received_at = timezone.now().replace(microsecond=0)
    rental, renter = create_overdue_rental(received_at)
    manager_client, _ = receive_and_add_photos(rental, renter)

    response = manager_client.patch(
        f"/api/v1/rentals/{rental.pk}/return/financials/",
        {
            "late_surcharge_waived": True,
            "late_surcharge_waiver_reason": "Постоянный клиент",
        },
        format="json",
    )

    assert response.status_code == 200, response.json()
    assert response.json()["late_surcharge_waived"] is True
    assert response.json()["late_base_cost"] != "0.00"
    assert response.json()["late_surcharge"] == "0.00"
    assert response.json()["return_act"]["late_surcharge_waiver_reason"] == (
        "Постоянный клиент"
    )


def test_damage_rejection_allows_only_amount_and_requires_new_consent(
    tmp_path: Any,
    settings: Any,
) -> None:
    settings.MEDIA_ROOT = tmp_path
    rental, renter = create_overdue_rental(timezone.now())
    manager_client, renter_client = receive_and_add_photos(rental, renter)
    financials = manager_client.patch(
        f"/api/v1/rentals/{rental.pk}/return/financials/",
        {
            "damage_enabled": True,
            "damage_description": "Трещина на корпусе",
            "damage_amount": "500.00",
        },
        format="json",
    )
    assert financials.status_code == 200, financials.json()
    renter_client.post(f"/api/v1/rentals/{rental.pk}/return/complete/")
    manager_client.post(f"/api/v1/rentals/{rental.pk}/return/complete/")

    rejected = renter_client.post(
        f"/api/v1/rentals/{rental.pk}/return/damage-decision/",
        {"accepted": False},
        format="json",
    )
    blocked_comment = manager_client.patch(
        f"/api/v1/rentals/{rental.pk}/return/materials/",
        {"comment": "Попытка изменить"},
        format="json",
    )
    blocked_description = manager_client.patch(
        f"/api/v1/rentals/{rental.pk}/return/financials/",
        {"damage_description": "Другое описание"},
        format="json",
    )
    new_amount = manager_client.patch(
        f"/api/v1/rentals/{rental.pk}/return/financials/",
        {"damage_amount": "120.00"},
        format="json",
    )

    assert rejected.json()["return_act"]["manager_amount_only"] is True
    assert blocked_comment.status_code == 400
    assert blocked_description.status_code == 400
    assert new_amount.status_code == 200, new_amount.json()
    assert new_amount.json()["return_act"]["damage_decision"] == "PENDING"
    assert new_amount.json()["return_act"]["manager"]["is_completed"] is True
    assert new_amount.json()["return_act"]["renter"]["is_confirmed"] is False
    assert new_amount.json()["return_act"]["manager"]["is_confirmed"] is False


def test_current_damage_consent_and_confirmations_complete_return(
    tmp_path: Any,
    settings: Any,
) -> None:
    settings.MEDIA_ROOT = tmp_path
    rental, renter = create_overdue_rental(timezone.now())
    manager_client, renter_client = receive_and_add_photos(rental, renter)
    manager_client.patch(
        f"/api/v1/rentals/{rental.pk}/return/financials/",
        {
            "damage_enabled": True,
            "damage_description": "Скол покрытия",
            "damage_amount": "75.50",
        },
        format="json",
    )
    renter_client.post(f"/api/v1/rentals/{rental.pk}/return/complete/")
    manager_client.post(f"/api/v1/rentals/{rental.pk}/return/complete/")
    renter_client.post(
        f"/api/v1/rentals/{rental.pk}/return/damage-decision/",
        {"accepted": True},
        format="json",
    )
    renter_client.post(f"/api/v1/rentals/{rental.pk}/return/confirm/")

    completed = manager_client.post(
        f"/api/v1/rentals/{rental.pk}/return/finish/",
        {"next_instance_status": "MAINTENANCE"},
        format="json",
    )
    rental.refresh_from_db()
    rental.booking.instance.refresh_from_db()

    assert completed.status_code == 200, completed.json()
    assert completed.json()["status"] == "COMPLETED"
    assert completed.json()["damage_amount"] == "75.50"
    assert rental.booking.instance.status == ProductInstance.Status.MAINTENANCE
    assert rental.ended_at is not None


def test_return_photo_is_private(tmp_path: Any, settings: Any) -> None:
    settings.MEDIA_ROOT = tmp_path
    rental, renter = create_overdue_rental(timezone.now())
    _, renter_client = receive_and_add_photos(rental, renter)
    photo = ReturnPhoto.objects.filter(author=renter).first()
    assert photo is not None
    stranger_client = authenticated_client(create_renter("other-return@example.com"))

    own = renter_client.get(f"/api/v1/return-photos/{photo.pk}/")
    forbidden = stranger_client.get(f"/api/v1/return-photos/{photo.pk}/")

    assert own.status_code == 200
    assert forbidden.status_code == 403
