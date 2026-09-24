"""Booking assignment, arrival, cancellation, and expiry API tests."""

from datetime import timedelta
from typing import Any

from applications.models import BookingEvent, RentalApplication, RentalBooking
from applications.services import expire_due_bookings
from django.utils import timezone
import pytest
from rest_framework.test import APIClient

from catalog.models import ProductInstance
from catalog.tests.factories import create_product, TEST_PASSWORD
from users.models import User

pytestmark = pytest.mark.django_db


def create_renter(email: str = "renter@example.com") -> User:
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


def create_application(
    product_id: int, renter: User, *, pickup_hours: int = 2
) -> RentalApplication:
    pickup_deadline_at = timezone.now() + timedelta(hours=pickup_hours)
    return RentalApplication.objects.create(
        product_id=product_id,
        renter=renter,
        pickup_deadline_at=pickup_deadline_at,
        planned_return_at=pickup_deadline_at + timedelta(days=1),
    )


def book_application(
    client: APIClient, application: RentalApplication, instance: ProductInstance
) -> Any:
    return client.post(
        f"/api/v1/manager/applications/{application.pk}/book/",
        {"instance_id": str(instance.pk)},
        format="json",
    )


def test_manager_assigns_instance_and_repeat_is_idempotent(
    tmp_path: Any, settings: Any
) -> None:
    settings.MEDIA_ROOT = tmp_path
    product = create_product(status="PUBLISHED")
    instance = product.instances.get()
    application = create_application(product.pk, create_renter())
    client = authenticated_client(product.manager)

    created = book_application(client, application, instance)
    repeated = book_application(client, application, instance)

    assert created.status_code == 201, created.json()
    assert repeated.status_code == 200, repeated.json()
    assert repeated.json()["id"] == created.json()["id"]
    assert repeated.json()["instance"]["inventory_number"] == instance.inventory_number
    assert repeated.json()["minute_rate_snapshot"] == "1.25"
    assert repeated.json()["starting_price_snapshot"] == "12.50"
    assert RentalBooking.objects.count() == 1
    application.refresh_from_db()
    instance.refresh_from_db()
    assert application.status == RentalApplication.Status.BOOKED
    assert instance.status == ProductInstance.Status.RESERVED


def test_only_manager_application_detail_contains_inventory_choices(
    tmp_path: Any, settings: Any
) -> None:
    settings.MEDIA_ROOT = tmp_path
    product = create_product(status="PUBLISHED")
    renter = create_renter()
    application = create_application(product.pk, renter)

    renter_detail = authenticated_client(renter).get(
        f"/api/v1/applications/{application.pk}/"
    )
    manager_detail = authenticated_client(product.manager).get(
        f"/api/v1/manager/applications/{application.pk}/"
    )

    assert "instances" not in renter_detail.json()
    assert manager_detail.json()["instances"][0]["inventory_number"]


def test_same_instance_cannot_be_assigned_to_two_bookings(
    tmp_path: Any, settings: Any
) -> None:
    settings.MEDIA_ROOT = tmp_path
    product = create_product(status="PUBLISHED")
    instance = product.instances.get()
    first = create_application(product.pk, create_renter("first@example.com"))
    second = create_application(product.pk, create_renter("second@example.com"))
    client = authenticated_client(product.manager)

    assert book_application(client, first, instance).status_code == 201
    conflict = book_application(client, second, instance)

    assert conflict.status_code == 409
    assert conflict.json()["code"] == "instance_unavailable"
    assert RentalBooking.objects.count() == 1
    second.refresh_from_db()
    assert second.status == RentalApplication.Status.WAITING


def test_booking_visibility_and_inventory_number_are_role_scoped(
    tmp_path: Any, settings: Any
) -> None:
    settings.MEDIA_ROOT = tmp_path
    product = create_product(status="PUBLISHED")
    renter = create_renter()
    application = create_application(product.pk, renter)
    instance = product.instances.get()
    booking = book_application(
        authenticated_client(product.manager), application, instance
    ).json()

    renter_response = authenticated_client(renter).get(
        f"/api/v1/bookings/{booking['id']}/"
    )
    manager_response = authenticated_client(product.manager).get(
        f"/api/v1/manager/bookings/{booking['id']}/"
    )
    stranger_response = authenticated_client(create_renter("other@example.com")).get(
        f"/api/v1/bookings/{booking['id']}/"
    )

    assert renter_response.status_code == 200
    assert renter_response.json()["instance"] is None
    assert manager_response.json()["instance"]["inventory_number"]
    assert stranger_response.status_code == 404


@pytest.mark.parametrize("actor", ["renter", "manager"])
def test_renter_or_manager_can_cancel_and_release_booking(
    tmp_path: Any, settings: Any, actor: str
) -> None:
    settings.MEDIA_ROOT = tmp_path
    product = create_product(status="PUBLISHED")
    renter = create_renter()
    application = create_application(product.pk, renter)
    instance = product.instances.get()
    manager_client = authenticated_client(product.manager)
    booking_id = book_application(manager_client, application, instance).json()["id"]
    client = authenticated_client(renter) if actor == "renter" else manager_client
    prefix = "" if actor == "renter" else "manager/"

    response = client.post(
        f"/api/v1/{prefix}bookings/{booking_id}/cancel/",
        {"reason": "Планы изменились"},
        format="json",
    )

    assert response.status_code == 200, response.json()
    assert response.json()["status"] == "CANCELLED"
    instance.refresh_from_db()
    assert instance.status == ProductInstance.Status.AVAILABLE
    assert response.json()["history"][-1]["actor"] == actor.upper()


def test_arrival_prevents_expiry_and_does_not_start_rental(
    tmp_path: Any, settings: Any
) -> None:
    settings.MEDIA_ROOT = tmp_path
    product = create_product(status="PUBLISHED")
    application = create_application(product.pk, create_renter())
    instance = product.instances.get()
    client = authenticated_client(product.manager)
    booking_id = book_application(client, application, instance).json()["id"]

    confirmed = client.post(f"/api/v1/manager/bookings/{booking_id}/arrival/")
    RentalApplication.objects.filter(pk=application.pk).update(
        pickup_deadline_at=timezone.now() - timedelta(minutes=1)
    )
    expired_count = expire_due_bookings()

    assert confirmed.status_code == 200, confirmed.json()
    assert confirmed.json()["status"] == "ARRIVED"
    assert confirmed.json()["arrival_confirmed_at"] is not None
    assert expired_count == 0
    instance.refresh_from_db()
    assert instance.status == ProductInstance.Status.PICKUP_IN_PROGRESS


def test_due_booking_expires_once_and_releases_instance(
    tmp_path: Any, settings: Any
) -> None:
    settings.MEDIA_ROOT = tmp_path
    product = create_product(status="PUBLISHED")
    application = create_application(product.pk, create_renter())
    instance = product.instances.get()
    booking_id = book_application(
        authenticated_client(product.manager), application, instance
    ).json()["id"]
    RentalApplication.objects.filter(pk=application.pk).update(
        pickup_deadline_at=timezone.now() - timedelta(minutes=1)
    )

    assert expire_due_bookings() == 1
    assert expire_due_bookings() == 0

    booking = RentalBooking.objects.get(pk=booking_id)
    instance.refresh_from_db()
    assert booking.status == RentalBooking.Status.EXPIRED
    assert instance.status == ProductInstance.Status.AVAILABLE
    assert (
        BookingEvent.objects.filter(
            booking=booking,
            event=BookingEvent.Event.EXPIRED,
            actor=BookingEvent.Actor.SYSTEM,
        ).count()
        == 1
    )


def test_arrival_after_deadline_is_rejected_and_booking_expires(
    tmp_path: Any, settings: Any
) -> None:
    settings.MEDIA_ROOT = tmp_path
    product = create_product(status="PUBLISHED")
    application = create_application(product.pk, create_renter())
    instance = product.instances.get()
    client = authenticated_client(product.manager)
    booking_id = book_application(client, application, instance).json()["id"]
    RentalApplication.objects.filter(pk=application.pk).update(
        pickup_deadline_at=timezone.now() - timedelta(seconds=1)
    )

    response = client.post(f"/api/v1/manager/bookings/{booking_id}/arrival/")

    assert response.status_code == 409
    assert response.json()["code"] == "booking_deadline_passed"
    assert (
        RentalBooking.objects.get(pk=booking_id).status == RentalBooking.Status.EXPIRED
    )
    instance.refresh_from_db()
    assert instance.status == ProductInstance.Status.AVAILABLE


def test_manager_booking_list_filters_period_and_includes_summary(
    tmp_path: Any, settings: Any
) -> None:
    settings.MEDIA_ROOT = tmp_path
    product = create_product(status="PUBLISHED")
    application = create_application(product.pk, create_renter(), pickup_hours=2)
    instance = product.instances.get()
    client = authenticated_client(product.manager)
    book_application(client, application, instance)

    response = client.get("/api/v1/manager/bookings/?period=three")

    assert response.status_code == 200
    assert response.json()["period"] == "three"
    assert response.json()["summary"]["three_days"] == 1
    assert len(response.json()["results"]) == 1
