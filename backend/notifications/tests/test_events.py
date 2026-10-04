"""Notification level rules for domain events."""

from datetime import timedelta
from decimal import Decimal

from applications.models import RentalApplication, RentalBooking
from django.utils import timezone
from notifications.events import (
    notify_application_cancelled,
    notify_booking_cancelled,
    notify_moderation_result,
)
from notifications.models import Notification
import pytest

from catalog.models import Product
from catalog.tests.factories import create_product, TEST_PASSWORD
from users.models import User

pytestmark = pytest.mark.django_db


def create_renter() -> User:
    return User.objects.create_user(
        email="notification-levels-renter@example.com",
        password=TEST_PASSWORD,
        name="Анна Смирнова",
        role=User.Role.RENTER,
    )


def create_application(product: Product, renter: User) -> RentalApplication:
    pickup_deadline = timezone.now() + timedelta(hours=2)
    return RentalApplication.objects.create(
        product=product,
        renter=renter,
        pickup_deadline_at=pickup_deadline,
        planned_return_at=pickup_deadline + timedelta(days=1),
    )


def create_booking(application: RentalApplication) -> RentalBooking:
    return RentalBooking.objects.create(
        application=application,
        instance=application.product.instances.get(),
        minute_rate_snapshot=Decimal("1.25"),
        starting_price_snapshot=Decimal("12.50"),
    )


def test_renter_cancellations_are_warnings() -> None:
    product = create_product(status=Product.Status.PUBLISHED)
    application = create_application(product, create_renter())
    booking = create_booking(application)

    notify_application_cancelled(application, actor="MANAGER")
    notify_booking_cancelled(booking, actor="MANAGER")

    levels = list(
        Notification.objects.filter(recipient=application.renter)
        .order_by("event_type")
        .values_list("event_type", "level")
    )
    assert levels == [
        (Notification.Event.APPLICATION_CANCELLED, Notification.Level.WARNING),
        (Notification.Event.BOOKING_CANCELLED, Notification.Level.WARNING),
    ]


def test_renter_booking_cancellation_warns_both_parties() -> None:
    product = create_product(status=Product.Status.PUBLISHED)
    application = create_application(product, create_renter())
    booking = create_booking(application)

    notify_booking_cancelled(booking, actor="RENTER")

    assert set(
        Notification.objects.filter(
            event_type=Notification.Event.BOOKING_CANCELLED
        ).values_list("recipient_id", "level")
    ) == {
        (application.renter_id, Notification.Level.WARNING),
        (product.manager_id, Notification.Level.WARNING),
    }


def test_moderation_rejection_warns_and_approval_informs() -> None:
    product = create_product(status=Product.Status.PUBLISHED)

    notify_moderation_result(product, approved=False)
    notify_moderation_result(product, approved=True)

    levels = list(
        Notification.objects.filter(
            recipient=product.manager,
            event_type=Notification.Event.MODERATION_RESULT,
        )
        .order_by("id")
        .values_list("level", flat=True)
    )
    assert levels == [Notification.Level.WARNING, Notification.Level.INFO]
