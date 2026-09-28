"""Pre-rental handover and active rental API tests."""

from datetime import timedelta
from decimal import Decimal
from typing import Any

from applications.models import HandoverPhoto, Rental, RentalApplication
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
import pytest
from rest_framework.test import APIClient

from catalog.models import ProductInstance
from catalog.tests.factories import create_product, make_png, TEST_PASSWORD
from users.models import User

pytestmark = pytest.mark.django_db


def create_renter(email: str = "handover-renter@example.com") -> User:
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


def create_arrived_booking(*, planned_return_hours: int = 24) -> tuple[Any, User]:
    product = create_product(status="PUBLISHED")
    renter = create_renter()
    pickup_deadline_at = timezone.now() + timedelta(hours=2)
    application = RentalApplication.objects.create(
        product=product,
        renter=renter,
        pickup_deadline_at=pickup_deadline_at,
        planned_return_at=timezone.now() + timedelta(hours=planned_return_hours),
    )
    manager_client = authenticated_client(product.manager)
    instance = product.instances.get()
    booking_response = manager_client.post(
        f"/api/v1/manager/applications/{application.pk}/book/",
        {"instance_id": str(instance.pk)},
        format="json",
    )
    booking_id = booking_response.json()["id"]
    arrival_response = manager_client.post(
        f"/api/v1/manager/bookings/{booking_id}/arrival/"
    )
    assert arrival_response.status_code == 200
    return application.booking, renter


def upload_photo(client: APIClient, booking_id: int, name: str) -> Any:
    return client.post(
        f"/api/v1/bookings/{booking_id}/handover/photos/",
        {
            "image": SimpleUploadedFile(
                name,
                make_png(),
                content_type="image/png",
            )
        },
        format="multipart",
    )


def test_renter_needs_two_photos_but_manager_can_complete_without_photos(
    tmp_path: Any, settings: Any
) -> None:
    settings.MEDIA_ROOT = tmp_path
    booking, renter = create_arrived_booking()
    renter_client = authenticated_client(renter)
    manager_client = authenticated_client(booking.application.product.manager)

    upload = upload_photo(renter_client, booking.pk, "first.png")
    renter_complete = renter_client.post(
        f"/api/v1/bookings/{booking.pk}/handover/complete/"
    )
    manager_complete = manager_client.post(
        f"/api/v1/bookings/{booking.pk}/handover/complete/"
    )

    assert upload.status_code == 201, upload.json()
    assert renter_complete.status_code == 400
    assert renter_complete.json()["field_errors"]["photos"] == [
        "Арендатор должен добавить минимум 2 фотографии."
    ]
    assert manager_complete.status_code == 200, manager_complete.json()
    assert manager_complete.json()["handover"]["manager"]["is_completed"] is True


def test_parties_share_materials_and_only_author_can_delete_photo(
    tmp_path: Any, settings: Any
) -> None:
    settings.MEDIA_ROOT = tmp_path
    booking, renter = create_arrived_booking()
    renter_client = authenticated_client(renter)
    manager_client = authenticated_client(booking.application.product.manager)
    stranger_client = authenticated_client(create_renter("stranger@example.com"))

    photo_id = upload_photo(renter_client, booking.pk, "condition.png").json()["id"]
    renter_client.patch(
        f"/api/v1/bookings/{booking.pk}/handover/materials/",
        {"comment": "Царапина на корпусе"},
        format="json",
    )

    manager_detail = manager_client.get(f"/api/v1/manager/bookings/{booking.pk}/")
    forbidden = stranger_client.get(f"/api/v1/bookings/{booking.pk}/")
    manager_delete = manager_client.delete(
        f"/api/v1/bookings/{booking.pk}/handover/photos/{photo_id}/"
    )
    renter_delete = renter_client.delete(
        f"/api/v1/bookings/{booking.pk}/handover/photos/{photo_id}/"
    )

    assert manager_detail.json()["handover"]["renter"]["comment"] == (
        "Царапина на корпусе"
    )
    assert forbidden.status_code == 404
    assert manager_delete.status_code == 403
    assert renter_delete.status_code == 204
    assert not HandoverPhoto.objects.filter(pk=photo_id).exists()


def test_change_request_preserves_materials_and_requires_fresh_confirmations(
    tmp_path: Any, settings: Any
) -> None:
    settings.MEDIA_ROOT = tmp_path
    booking, renter = create_arrived_booking()
    renter_client = authenticated_client(renter)
    manager_client = authenticated_client(booking.application.product.manager)

    upload_photo(renter_client, booking.pk, "first.png")
    upload_photo(renter_client, booking.pk, "second.png")
    renter_client.patch(
        f"/api/v1/bookings/{booking.pk}/handover/materials/",
        {"comment": "Состояние принято"},
        format="json",
    )
    renter_client.post(f"/api/v1/bookings/{booking.pk}/handover/complete/")
    manager_client.post(f"/api/v1/bookings/{booking.pk}/handover/complete/")
    manager_client.post(f"/api/v1/bookings/{booking.pk}/handover/confirm/")

    requested = renter_client.post(
        f"/api/v1/bookings/{booking.pk}/handover/request-changes/"
    )

    assert requested.status_code == 200, requested.json()
    handover = requested.json()["handover"]
    assert handover["renter"]["is_completed"] is True
    assert handover["manager"]["is_completed"] is False
    assert handover["renter"]["comment"] == "Состояние принято"
    assert handover["manager"]["is_confirmed"] is False
    assert Rental.objects.count() == 0


def test_second_confirmation_starts_rental_and_returns_live_calculation(
    tmp_path: Any, settings: Any
) -> None:
    settings.MEDIA_ROOT = tmp_path
    booking, renter = create_arrived_booking()
    renter_client = authenticated_client(renter)
    manager_client = authenticated_client(booking.application.product.manager)
    upload_photo(renter_client, booking.pk, "first.png")
    upload_photo(renter_client, booking.pk, "second.png")
    renter_client.post(f"/api/v1/bookings/{booking.pk}/handover/complete/")
    manager_client.post(f"/api/v1/bookings/{booking.pk}/handover/complete/")

    first = renter_client.post(f"/api/v1/bookings/{booking.pk}/handover/confirm/")
    second = manager_client.post(f"/api/v1/bookings/{booking.pk}/handover/confirm/")
    rental_id = second.json()["rental"]["id"]
    detail = renter_client.get(f"/api/v1/rentals/{rental_id}/")

    assert first.json()["rental"] is None
    assert second.status_code == 200, second.json()
    assert second.json()["status"] == "RENTED"
    assert Rental.objects.count() == 1
    rental = Rental.objects.get()
    assert rental.minute_rate_snapshot == Decimal("1.25")
    assert rental.starting_price_snapshot == Decimal("12.50")
    assert detail.json()["current_cost"] == "13.75"
    booking.instance.refresh_from_db()
    assert booking.instance.status == ProductInstance.Status.RENTED


def test_second_confirmation_rejects_past_planned_return(
    tmp_path: Any, settings: Any
) -> None:
    settings.MEDIA_ROOT = tmp_path
    booking, renter = create_arrived_booking(planned_return_hours=3)
    renter_client = authenticated_client(renter)
    manager_client = authenticated_client(booking.application.product.manager)
    upload_photo(renter_client, booking.pk, "first.png")
    upload_photo(renter_client, booking.pk, "second.png")
    renter_client.post(f"/api/v1/bookings/{booking.pk}/handover/complete/")
    manager_client.post(f"/api/v1/bookings/{booking.pk}/handover/complete/")
    renter_client.post(f"/api/v1/bookings/{booking.pk}/handover/confirm/")
    RentalApplication.objects.filter(pk=booking.application_id).update(
        pickup_deadline_at=timezone.now() - timedelta(minutes=2),
        planned_return_at=timezone.now() - timedelta(seconds=1),
    )

    response = manager_client.post(f"/api/v1/bookings/{booking.pk}/handover/confirm/")

    assert response.status_code == 409
    assert response.json()["code"] == "planned_return_passed"
    assert Rental.objects.count() == 0


def test_renter_activity_exposes_pickup_then_active_rental(
    tmp_path: Any, settings: Any
) -> None:
    settings.MEDIA_ROOT = tmp_path
    booking, renter = create_arrived_booking()
    renter_client = authenticated_client(renter)
    manager_client = authenticated_client(booking.application.product.manager)

    pickup = renter_client.get("/api/v1/activity/")
    upload_photo(renter_client, booking.pk, "first.png")
    upload_photo(renter_client, booking.pk, "second.png")
    renter_client.post(f"/api/v1/bookings/{booking.pk}/handover/complete/")
    manager_client.post(f"/api/v1/bookings/{booking.pk}/handover/complete/")
    renter_client.post(f"/api/v1/bookings/{booking.pk}/handover/confirm/")
    manager_client.post(f"/api/v1/bookings/{booking.pk}/handover/confirm/")
    rental = renter_client.get("/api/v1/activity/")

    assert pickup.json()["handover"]["id"] == booking.pk
    assert pickup.json()["rental"] is None
    assert rental.json()["handover"] is None
    assert rental.json()["rental"]["booking_id"] == booking.pk
