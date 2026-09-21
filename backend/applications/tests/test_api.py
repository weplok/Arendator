"""Application creation, cancellation, limits, and manager queue API tests."""

from datetime import timedelta
from typing import Any

from applications.models import RentalApplication
from django.utils import timezone
import pytest
from rest_framework.test import APIClient

from catalog.models import ProductInstance
from catalog.tests.factories import create_manager, create_product, TEST_PASSWORD
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


def application_payload(
    *, pickup_hours: int = 2, duration_hours: int = 25
) -> dict[str, str]:
    pickup = timezone.now() + timedelta(hours=pickup_hours)
    return {
        "pickup_deadline_at": pickup.isoformat(),
        "planned_return_at": (pickup + timedelta(hours=duration_hours)).isoformat(),
    }


def test_renter_can_apply_when_all_instances_are_unavailable(
    tmp_path: Any, settings: Any
) -> None:
    settings.MEDIA_ROOT = tmp_path
    product = create_product(status="PUBLISHED")
    product.instances.update(status=ProductInstance.Status.RENTED)
    renter = create_renter()

    response = authenticated_client(renter).post(
        f"/api/v1/products/{product.pk}/applications/",
        application_payload(),
        format="json",
    )

    assert response.status_code == 201, response.json()
    assert response.json()["status"] == "WAITING"
    assert response.json()["product"]["available_instances_count"] == 0
    assert response.json()["product"]["total_instances_count"] == 1
    assert response.json()["estimated_cost"] == "1887.50"


def test_pending_application_limit_equals_active_instance_count(
    tmp_path: Any, settings: Any
) -> None:
    settings.MEDIA_ROOT = tmp_path
    product = create_product(status="PUBLISHED")
    renter = create_renter()
    client = authenticated_client(renter)

    assert (
        client.post(
            f"/api/v1/products/{product.pk}/applications/",
            application_payload(),
            format="json",
        ).status_code
        == 201
    )
    conflict = client.post(
        f"/api/v1/products/{product.pk}/applications/",
        application_payload(pickup_hours=3),
        format="json",
    )

    assert conflict.status_code == 409
    assert conflict.json()["code"] == "application_limit_reached"
    assert conflict.json()["field_errors"]["product"] == [
        "У вас уже 1 из 1 ожидающих заявок на этот товар."
    ]


def test_multiple_renters_can_wait_for_the_same_single_instance(
    tmp_path: Any, settings: Any
) -> None:
    settings.MEDIA_ROOT = tmp_path
    product = create_product(status="PUBLISHED")

    responses = [
        authenticated_client(create_renter(email)).post(
            f"/api/v1/products/{product.pk}/applications/",
            application_payload(),
            format="json",
        )
        for email in ("first@example.com", "second@example.com")
    ]

    assert [response.status_code for response in responses] == [201, 201]
    assert (
        RentalApplication.objects.filter(
            product=product, status=RentalApplication.Status.WAITING
        ).count()
        == 2
    )


def test_renter_can_create_one_waiting_application_per_active_instance(
    tmp_path: Any, settings: Any
) -> None:
    settings.MEDIA_ROOT = tmp_path
    product = create_product(status="PUBLISHED")
    ProductInstance.objects.create(product=product, inventory_number="second")
    client = authenticated_client(create_renter())

    responses = [
        client.post(
            f"/api/v1/products/{product.pk}/applications/",
            application_payload(pickup_hours=hours),
            format="json",
        )
        for hours in (2, 3, 4)
    ]

    assert [response.status_code for response in responses] == [201, 201, 409]


@pytest.mark.parametrize(
    ("pickup_delta", "return_delta", "field"),
    [
        (timedelta(minutes=-1), timedelta(hours=1), "pickup_deadline_at"),
        (timedelta(hours=2), timedelta(hours=1), "planned_return_at"),
    ],
)
def test_application_rejects_invalid_deadlines(
    tmp_path: Any,
    settings: Any,
    pickup_delta: timedelta,
    return_delta: timedelta,
    field: str,
) -> None:
    settings.MEDIA_ROOT = tmp_path
    product = create_product(status="PUBLISHED")
    now = timezone.now()

    response = authenticated_client(create_renter()).post(
        f"/api/v1/products/{product.pk}/applications/",
        {
            "pickup_deadline_at": (now + pickup_delta).isoformat(),
            "planned_return_at": (now + return_delta).isoformat(),
        },
        format="json",
    )

    assert response.status_code == 400
    assert field in response.json()["field_errors"]


def test_guest_and_manager_cannot_create_application(
    tmp_path: Any, settings: Any
) -> None:
    settings.MEDIA_ROOT = tmp_path
    product = create_product(status="PUBLISHED")
    url = f"/api/v1/products/{product.pk}/applications/"

    assert (
        APIClient().post(url, application_payload(), format="json").status_code == 401
    )
    assert (
        authenticated_client(product.manager)
        .post(url, application_payload(), format="json")
        .status_code
        == 403
    )


def test_renter_lists_and_cancels_only_own_waiting_application(
    tmp_path: Any, settings: Any
) -> None:
    settings.MEDIA_ROOT = tmp_path
    product = create_product(status="PUBLISHED")
    renter = create_renter()
    other = create_renter("other@example.com")
    created = authenticated_client(renter).post(
        f"/api/v1/products/{product.pk}/applications/",
        application_payload(),
        format="json",
    )
    application_id = created.json()["id"]

    assert (
        authenticated_client(other)
        .get(f"/api/v1/applications/{application_id}/")
        .status_code
        == 404
    )
    cancelled = authenticated_client(renter).post(
        f"/api/v1/applications/{application_id}/cancel/",
        {"reason": "Планы изменились"},
        format="json",
    )

    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "CANCELLED"
    assert cancelled.json()["history"][-1]["actor"] == "RENTER"
    applications = authenticated_client(renter).get("/api/v1/applications/").json()
    assert applications[0]["status"] == "CANCELLED"
    assert (
        authenticated_client(renter)
        .post(f"/api/v1/applications/{application_id}/cancel/", {}, format="json")
        .status_code
        == 400
    )


def test_manager_queue_prioritizes_available_products_and_saves_preferences(
    tmp_path: Any, settings: Any
) -> None:
    settings.MEDIA_ROOT = tmp_path
    manager = create_manager()
    unavailable_product = create_product(
        manager=manager, status="PUBLISHED", name="Нет свободных"
    )
    unavailable_product.instances.update(status=ProductInstance.Status.RENTED)
    available_product = create_product(
        manager=manager, status="PUBLISHED", name="Есть свободные"
    )
    renter = create_renter()
    renter_client = authenticated_client(renter)
    for product, hours in ((unavailable_product, 1), (available_product, 3)):
        assert (
            renter_client.post(
                f"/api/v1/products/{product.pk}/applications/",
                application_payload(pickup_hours=hours),
                format="json",
            ).status_code
            == 201
        )

    manager_client = authenticated_client(manager)
    queue = manager_client.get("/api/v1/manager/applications/")

    assert queue.status_code == 200
    assert [item["product"]["name"] for item in queue.json()["results"]] == [
        "Есть свободные",
        "Нет свободных",
    ]
    saved = manager_client.patch(
        "/api/v1/manager/application-preferences/",
        {"ordering": "LATEST", "hide_unavailable": True},
        format="json",
    )
    assert saved.status_code == 200
    assert saved.json() == {"ordering": "LATEST", "hide_unavailable": True}
    filtered = manager_client.get("/api/v1/manager/applications/").json()
    assert filtered["preferences"] == saved.json()
    assert [item["product"]["name"] for item in filtered["results"]] == [
        "Есть свободные"
    ]


def test_manager_can_read_and_cancel_only_own_product_application(
    tmp_path: Any, settings: Any
) -> None:
    settings.MEDIA_ROOT = tmp_path
    product = create_product(status="PUBLISHED")
    renter = create_renter()
    created = authenticated_client(renter).post(
        f"/api/v1/products/{product.pk}/applications/",
        application_payload(),
        format="json",
    )
    application_id = created.json()["id"]
    other_manager = create_manager("other-manager@example.com")

    assert (
        authenticated_client(other_manager)
        .get(f"/api/v1/manager/applications/{application_id}/")
        .status_code
        == 404
    )
    cancelled = authenticated_client(product.manager).post(
        f"/api/v1/manager/applications/{application_id}/cancel/",
        {},
        format="json",
    )

    assert cancelled.status_code == 200
    assert cancelled.json()["history"][-1]["actor"] == "MANAGER"


def test_deleting_instance_cancels_latest_excess_application(
    tmp_path: Any, settings: Any
) -> None:
    settings.MEDIA_ROOT = tmp_path
    product = create_product(status="PUBLISHED")
    second_instance = ProductInstance.objects.create(
        product=product, inventory_number="second"
    )
    client = authenticated_client(create_renter())
    first = client.post(
        f"/api/v1/products/{product.pk}/applications/",
        application_payload(pickup_hours=2),
        format="json",
    ).json()
    second = client.post(
        f"/api/v1/products/{product.pk}/applications/",
        application_payload(pickup_hours=3),
        format="json",
    ).json()

    response = authenticated_client(product.manager).delete(
        f"/api/v1/manager/products/{product.pk}/instances/{second_instance.pk}/"
    )

    assert response.status_code == 204
    assert RentalApplication.objects.get(pk=first["id"]).status == "WAITING"
    assert RentalApplication.objects.get(pk=second["id"]).status == "CANCELLED"
