"""Stage 14 analytics contracts, scoping, periods, and admin integration."""

from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any, cast
from zoneinfo import ZoneInfo

from analytics.periods import parse_period
from applications.models import (
    Rental,
    RentalApplication,
    RentalBooking,
    ReturnAct,
)
from django.contrib.staticfiles.storage import staticfiles_storage
from django.core.files.storage import storages
from django.test import Client
from django.utils import timezone
from django.utils.functional import empty
import pytest
from rest_framework.exceptions import ValidationError
from rest_framework.test import APIClient

from catalog.models import Maintenance, ProductInstance
from catalog.tests.factories import create_manager, create_product, TEST_PASSWORD
from categories.models import Category
from users.models import User

pytestmark = pytest.mark.django_db
MOSCOW = ZoneInfo("Europe/Moscow")


def test_preset_periods_use_previous_complete_moscow_days() -> None:
    now = datetime(2026, 10, 4, 12, 30, tzinfo=MOSCOW)

    period = parse_period({"period": "week"}, now=now)

    assert period.date_from.isoformat() == "2026-09-27"
    assert period.date_to.isoformat() == "2026-10-03"
    assert period.start == datetime(2026, 9, 27, tzinfo=MOSCOW)
    assert period.end == datetime(2026, 10, 4, tzinfo=MOSCOW)


def test_custom_period_includes_both_full_days_and_validates_order() -> None:
    now = timezone.now()
    period = parse_period(
        {"period": "custom", "date_from": "2026-09-05", "date_to": "2026-10-04"},
        now=now,
    )

    assert period.days == 30
    assert period.end - period.start == timedelta(days=30)
    with pytest.raises(ValidationError):
        parse_period(
            {"period": "custom", "date_from": "2026-10-04", "date_to": "2026-09-05"},
            now=now,
        )


def test_manager_analytics_are_scoped_and_split_financial_components() -> None:
    manager = create_manager("analytics-manager@example.com")
    other = create_manager("analytics-other@example.com")
    day = datetime(2026, 10, 3, tzinfo=MOSCOW)
    own = create_product(manager=manager, minute_rate=Decimal("1.00"))
    foreign = create_product(manager=other, minute_rate=Decimal("5.00"))
    own_rental = create_completed_rental(own, day, damage=Decimal("5.00"))
    create_completed_rental(foreign, day, damage=Decimal("90.00"))
    instance = own.instances.get()
    ProductInstance.objects.filter(pk=instance.pk).update(created_at=day)
    maintenance = Maintenance.objects.create(
        instance=instance,
        started_by=manager,
        reason="Диагностика",
    )
    Maintenance.objects.filter(pk=maintenance.pk).update(
        started_at=day + timedelta(hours=15),
        completed_at=day + timedelta(hours=16),
        repair_cost=Decimal("20.00"),
    )
    client = authenticated_client(manager)

    response = client.get(
        "/api/v1/manager/analytics/",
        {"period": "custom", "date_from": "2026-10-03", "date_to": "2026-10-03"},
    )

    assert response.status_code == 200, response.json()
    payload = response.json()
    assert payload["financials"] == {
        "rental_income": "100.00",
        "overdue_income": "30.00",
        "damage_income": "5.00",
        "income": "135.00",
        "completed_rentals": 1,
        "expenses": "20.00",
        "completed_maintenances": 1,
        "net": "115.00",
    }
    assert payload["categories"] == [
        {
            "id": own.category_id,
            "name": own.category.name,
            "income": "135.00",
            "completed_rentals": 1,
        }
    ]
    assert payload["utilization"]["average_percent"] == 6.5
    assert own_rental.booking.application.product.manager == manager


def test_manager_endpoint_rejects_renter_and_superuser() -> None:
    renter = User.objects.create_user(
        email="analytics-renter@example.com",
        password=TEST_PASSWORD,
        name="Анна",
        role=User.Role.RENTER,
    )
    admin_user = User.objects.create_superuser(
        email="analytics-admin@example.com",
        password=TEST_PASSWORD,
        name="Администратор",
    )

    assert (
        authenticated_client(renter).get("/api/v1/manager/analytics/").status_code
        == 403
    )
    assert (
        authenticated_client(admin_user).get("/api/v1/manager/analytics/").status_code
        == 403
    )


def test_admin_analytics_is_custom_admin_view_and_superuser_only(settings: Any) -> None:
    settings.STORAGES = {
        **settings.STORAGES,
        "staticfiles": {
            "BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"
        },
    }
    cast(Any, storages)._storages.clear()
    cast(Any, staticfiles_storage)._wrapped = empty
    admin_user = User.objects.create_superuser(
        email="admin-report@example.com",
        password=TEST_PASSWORD,
        name="Администратор",
    )
    staff_manager = create_manager("staff-manager@example.com")
    staff_manager.is_staff = True
    staff_manager.save(update_fields=("is_staff",))
    income_category = Category.objects.create(name="Высокий доход")
    count_category = Category.objects.create(name="Больше аренд")
    high_income_product = create_product(
        manager=staff_manager,
        category=income_category,
        name="Доходный товар",
    )
    first_frequent_product = create_product(
        manager=staff_manager,
        category=count_category,
        name="Частый товар 1",
    )
    second_frequent_product = create_product(
        manager=staff_manager,
        category=count_category,
        name="Частый товар 2",
    )
    day = datetime(2026, 10, 3, tzinfo=MOSCOW)
    create_completed_rental(
        high_income_product,
        day,
        damage=Decimal("1000.00"),
    )
    create_completed_rental(
        first_frequent_product,
        day,
        damage=Decimal("0.00"),
    )
    create_completed_rental(
        second_frequent_product,
        day,
        damage=Decimal("0.00"),
    )
    admin_client = Client()
    admin_client.force_login(admin_user)
    manager_client = Client()
    manager_client.force_login(staff_manager)

    response = admin_client.get("/admin/analytics/?period=week")
    income_response = admin_client.get(
        "/admin/analytics/",
        {
            "period": "custom",
            "date_from": "2026-10-03",
            "date_to": "2026-10-03",
            "metric": "income",
        },
    )
    count_response = admin_client.get(
        "/admin/analytics/",
        {
            "period": "custom",
            "date_from": "2026-10-03",
            "date_to": "2026-10-03",
            "metric": "completed_rentals",
        },
    )
    invalid_period = admin_client.get(
        "/admin/analytics/",
        {
            "period": "custom",
            "date_from": "2026-10-04",
            "date_to": "2026-09-05",
        },
    )
    forbidden = manager_client.get("/admin/analytics/?period=week")

    assert response.status_code == 200
    assert "Аналитика площадки" in response.content.decode()
    assert "Таблица данных" in response.content.decode()
    assert response.context["analytics"]["platform"]["managers"] == 1
    assert income_response.context["analytics"]["categories"][0]["name"] == (
        income_category.name
    )
    assert count_response.context["analytics"]["categories"][0]["name"] == (
        count_category.name
    )
    assert invalid_period.status_code == 200
    assert "Проверьте выбранный период и даты" in invalid_period.content.decode()
    assert forbidden.status_code == 403


def authenticated_client(user: User) -> APIClient:
    client = APIClient()
    client.force_login(user)
    return client


def create_completed_rental(
    product: Any,
    day: datetime,
    *,
    damage: Decimal,
) -> Rental:
    renter = User.objects.create_user(
        email=f"renter-{product.pk}@example.com",
        password=TEST_PASSWORD,
        name="Арендатор",
        role=User.Role.RENTER,
    )
    application = RentalApplication.objects.create(
        renter=renter,
        product=product,
        pickup_deadline_at=day + timedelta(hours=11),
        planned_return_at=day + timedelta(hours=13),
        status=RentalApplication.Status.BOOKED,
    )
    instance = product.instances.get()
    booking = RentalBooking.objects.create(
        application=application,
        instance=instance,
        status=RentalBooking.Status.RENTED,
        minute_rate_snapshot=Decimal("1.00"),
        starting_price_snapshot=Decimal("10.00"),
    )
    RentalBooking.objects.filter(pk=booking.pk).update(
        created_at=day + timedelta(hours=11)
    )
    rental = Rental.objects.create(
        booking=booking,
        status=Rental.Status.COMPLETED,
        minute_rate_snapshot=Decimal("1.00"),
        starting_price_snapshot=Decimal("10.00"),
        planned_return_at=day + timedelta(hours=13),
        rental_started_at=day + timedelta(hours=12),
        return_received_at=day + timedelta(hours=13, minutes=30),
        ended_at=day + timedelta(hours=14),
    )
    ReturnAct.objects.create(
        rental=rental,
        damage_enabled=True,
        damage_amount=damage,
        damage_decision=ReturnAct.DamageDecision.ACCEPTED,
    )
    return rental
