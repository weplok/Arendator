"""Read-only cross-model analytics calculations."""

from collections import defaultdict
from datetime import datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, TypedDict

from analytics.periods import AnalyticsPeriod, MOSCOW_TIME_ZONE
from applications.models import Rental, RentalApplication, RentalBooking
from applications.services import rental_calculation
from django.db.models import QuerySet
from django.utils import timezone

from catalog.models import Maintenance, Product, ProductInstance
from users.models import User

ZERO = Decimal("0.00")
MONEY_STEP = Decimal("0.01")
PERCENT_STEP = Decimal("0.1")


class ParkItem(TypedDict):
    key: str
    label: str
    count: int


def build_manager_analytics(
    manager: User,
    period: AnalyticsPeriod,
    *,
    now: datetime | None = None,
) -> dict[str, Any]:
    current_time = now or timezone.now()
    rentals = _completed_rentals(period, manager=manager)
    financials = _financial_metrics(rentals, period.end)
    maintenance = _maintenance_metrics(period, manager=manager)
    utilization = _utilization_metrics(period, manager=manager, now=current_time)
    park = _park_metrics(manager=manager)
    overdue = _active_overdue_metrics(manager=manager, now=current_time)
    category_data = _category_metrics(rentals, period.end)
    total = Decimal(financials["income"]) - Decimal(maintenance["expenses"])
    return {
        "period": _period_payload(period),
        "snapshot_at": current_time.astimezone(MOSCOW_TIME_ZONE).isoformat(),
        "snapshot_label": _snapshot_label(current_time),
        "financials": {
            **financials,
            **maintenance,
            "net": _money(total),
        },
        "utilization": utilization,
        "active_overdues": overdue,
        "park": park,
        "categories": category_data,
    }


def build_admin_analytics(
    period: AnalyticsPeriod,
    *,
    now: datetime | None = None,
) -> dict[str, Any]:
    current_time = now or timezone.now()
    rentals = _completed_rentals(period)
    financials = _financial_metrics(rentals, period.end)
    maintenance = _maintenance_metrics(period)
    utilization = _utilization_metrics(period, now=current_time)
    park = _park_metrics()
    overdue = _active_overdue_metrics(now=current_time)
    applications = RentalApplication.objects.filter(
        created_at__gte=period.start,
        created_at__lt=period.end,
    )
    application_count = applications.count()
    converted_count = applications.filter(booking__isnull=False).count()
    booking_count = RentalBooking.objects.filter(
        created_at__gte=period.start,
        created_at__lt=period.end,
    ).count()
    total = Decimal(financials["income"]) - Decimal(maintenance["expenses"])
    return {
        "period": _period_payload(period),
        "snapshot_at": current_time.astimezone(MOSCOW_TIME_ZONE).isoformat(),
        "snapshot_label": _snapshot_label(current_time),
        "financials": {
            **financials,
            **maintenance,
            "net": _money(total),
        },
        "utilization": utilization,
        "active_overdues": overdue,
        "park": park,
        "platform": {
            "published_products": Product.objects.filter(
                status=Product.Status.PUBLISHED
            ).count(),
            "products_on_moderation": Product.objects.filter(
                status=Product.Status.ON_MODERATION
            ).count(),
            "managers": User.objects.filter(
                role=User.Role.MANAGER,
                is_superuser=False,
            ).count(),
            "renters": User.objects.filter(role=User.Role.RENTER).count(),
            "applications": application_count,
            "waiting_applications": RentalApplication.objects.filter(
                status=RentalApplication.Status.WAITING
            ).count(),
            "bookings": booking_count,
            "conversion_percent": _percent(converted_count, application_count),
        },
        "categories": _category_metrics(rentals, period.end),
        "product_statuses": _product_status_metrics(),
    }


def _completed_rentals(
    period: AnalyticsPeriod,
    *,
    manager: User | None = None,
) -> QuerySet[Rental]:
    rentals = Rental.objects.filter(
        status=Rental.Status.COMPLETED,
        ended_at__gte=period.start,
        ended_at__lt=period.end,
    ).select_related(
        "return_act",
        "booking__application__product__category",
    )
    if manager is not None:
        rentals = rentals.filter(booking__application__product__manager=manager)
    return rentals


def _financial_metrics(
    rentals: QuerySet[Rental],
    calculated_at: datetime,
) -> dict[str, Any]:
    rental_income = ZERO
    overdue_income = ZERO
    damage_income = ZERO
    rental_list = list(rentals)
    for rental in rental_list:
        calculation = rental_calculation(rental, calculated_at)
        rental_income += (
            rental.starting_price_snapshot
            + calculation["timely_cost"]
            + calculation["late_base_cost"]
        )
        overdue_income += calculation["late_surcharge"]
        damage_income += calculation["damage_amount"]
    income = rental_income + overdue_income + damage_income
    return {
        "rental_income": _money(rental_income),
        "overdue_income": _money(overdue_income),
        "damage_income": _money(damage_income),
        "income": _money(income),
        "completed_rentals": len(rental_list),
    }


def _maintenance_metrics(
    period: AnalyticsPeriod,
    *,
    manager: User | None = None,
) -> dict[str, Any]:
    maintenances = Maintenance.objects.filter(
        completed_at__gte=period.start,
        completed_at__lt=period.end,
    )
    if manager is not None:
        maintenances = maintenances.filter(instance__manager=manager)
    expenses = sum(
        (item.repair_cost or ZERO for item in maintenances),
        start=ZERO,
    )
    return {
        "expenses": _money(expenses),
        "completed_maintenances": maintenances.count(),
    }


def _utilization_metrics(
    period: AnalyticsPeriod,
    *,
    manager: User | None = None,
    now: datetime,
) -> dict[str, Any]:
    instances = ProductInstance.objects.filter(is_deleted=False)
    if manager is not None:
        instances = instances.filter(manager=manager)
    instance_list = list(instances.only("id", "created_at"))
    instance_ids = [instance.id for instance in instance_list]
    rentals = Rental.objects.filter(
        booking__instance_id__in=instance_ids,
        rental_started_at__lt=period.end,
    ).exclude(return_received_at__lte=period.start)
    maintenances = Maintenance.objects.filter(
        instance_id__in=instance_ids,
        started_at__lt=period.end,
    ).exclude(completed_at__lte=period.start)
    rental_intervals = [
        (rental.rental_started_at, rental.return_received_at or now)
        for rental in rentals.only("rental_started_at", "return_received_at")
    ]
    maintenance_intervals = [
        (maintenance.started_at, maintenance.completed_at or now)
        for maintenance in maintenances.only("started_at", "completed_at")
    ]
    points: list[dict[str, Any]] = []
    total_rental_minutes = 0.0
    total_operational_minutes = 0.0
    for offset in range(period.days):
        day_start = period.start + timedelta(days=offset)
        day_end = min(day_start + timedelta(days=1), period.end, now)
        operational = sum(
            _overlap_minutes(max(instance.created_at, day_start), day_end)
            for instance in instance_list
        )
        operational -= sum(
            _overlap_minutes(start, end, day_start, day_end)
            for start, end in maintenance_intervals
        )
        active = sum(
            _overlap_minutes(start, end, day_start, day_end)
            for start, end in rental_intervals
        )
        operational = max(0.0, operational)
        active = min(max(0.0, active), operational)
        total_rental_minutes += active
        total_operational_minutes += operational
        points.append(
            {
                "date": day_start.date().isoformat(),
                "label": day_start.strftime("%d.%m"),
                "percent": _percent(active, operational),
            }
        )
    return {
        "average_percent": _percent(
            total_rental_minutes,
            total_operational_minutes,
        ),
        "daily": points,
    }


def _park_metrics(*, manager: User | None = None) -> dict[str, Any]:
    instances = ProductInstance.objects.filter(is_deleted=False)
    if manager is not None:
        instances = instances.filter(manager=manager)
    counts: defaultdict[str, int] = defaultdict(int)
    for status in instances.values_list("status", flat=True):
        if status == ProductInstance.Status.PICKUP_IN_PROGRESS:
            counts[ProductInstance.Status.RESERVED] += 1
        else:
            counts[status] += 1
    items = [
        ("available", "Доступно", ProductInstance.Status.AVAILABLE),
        ("reserved", "Забронировано", ProductInstance.Status.RESERVED),
        ("rented", "В аренде", ProductInstance.Status.RENTED),
        ("return_inspection", "На осмотре", ProductInstance.Status.RETURN_INSPECTION),
        ("maintenance", "Обслуживание", ProductInstance.Status.MAINTENANCE),
    ]
    values: list[ParkItem] = [
        {"key": key, "label": label, "count": counts[status]}
        for key, label, status in items
    ]
    in_work = sum(item["count"] for item in values if item["key"] != "available")
    return {
        "total": sum(item["count"] for item in values),
        "in_work": in_work,
        "items": values,
    }


def _active_overdue_metrics(
    *,
    now: datetime,
    manager: User | None = None,
) -> dict[str, int]:
    rentals = Rental.objects.filter(
        status__in=(Rental.Status.ACTIVE, Rental.Status.OVERDUE),
        planned_return_at__lt=now,
    )
    if manager is not None:
        rentals = rentals.filter(booking__application__product__manager=manager)
    return {
        "rentals": rentals.count(),
        "products": rentals.values("booking__application__product_id")
        .distinct()
        .count(),
    }


def _category_metrics(
    rentals: QuerySet[Rental],
    calculated_at: datetime,
) -> list[dict[str, Any]]:
    categories: dict[tuple[int, str], dict[str, Any]] = {}
    for rental in rentals:
        category = rental.booking.application.product.category
        key = (category.pk, category.name)
        item = categories.setdefault(
            key,
            {
                "id": category.pk,
                "name": category.name,
                "income": ZERO,
                "completed_rentals": 0,
            },
        )
        item["income"] += rental_calculation(rental, calculated_at)["current_cost"]
        item["completed_rentals"] += 1
    result = [
        {**item, "income": _money(item["income"])} for item in categories.values()
    ]
    return sorted(result, key=lambda item: Decimal(item["income"]), reverse=True)


def _product_status_metrics() -> list[dict[str, Any]]:
    labels = dict(Product.Status.choices)
    counts: defaultdict[str, int] = defaultdict(int)
    for status in Product.objects.values_list("status", flat=True):
        counts[status] += 1
    return [
        {"key": status, "label": labels[status], "count": counts[status]}
        for status in Product.Status.values
    ]


def _period_payload(period: AnalyticsPeriod) -> dict[str, Any]:
    return {
        "key": period.key,
        "date_from": period.date_from.isoformat(),
        "date_to": period.date_to.isoformat(),
        "label": period.label,
        "days": period.days,
        "timezone": "Europe/Moscow",
    }


def _snapshot_label(value: datetime) -> str:
    localized = value.astimezone(MOSCOW_TIME_ZONE)
    return f"{localized:%d.%m.%Y, %H:%M} МСК"


def _overlap_minutes(
    start: datetime,
    end: datetime,
    boundary_start: datetime | None = None,
    boundary_end: datetime | None = None,
) -> float:
    overlap_start = max(start, boundary_start) if boundary_start else start
    overlap_end = min(end, boundary_end) if boundary_end else end
    return max(0.0, (overlap_end - overlap_start).total_seconds() / 60)


def _money(value: Decimal) -> str:
    return str(value.quantize(MONEY_STEP, rounding=ROUND_HALF_UP))


def _percent(numerator: int | float, denominator: int | float) -> float:
    if denominator <= 0:
        return 0.0
    value = (Decimal(str(numerator)) * 100 / Decimal(str(denominator))).quantize(
        PERCENT_STEP,
        rounding=ROUND_HALF_UP,
    )
    return float(value)
