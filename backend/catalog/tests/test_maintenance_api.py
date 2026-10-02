"""Manager maintenance workflow and instance history API."""

from decimal import Decimal
from typing import Any

from django.core.files.uploadedfile import SimpleUploadedFile
import pytest
from rest_framework.test import APIClient

from catalog.models import Maintenance, MaintenancePhoto, Product, ProductInstance
from catalog.tests.factories import create_manager, create_product, make_png
from users.models import User

pytestmark = pytest.mark.django_db


def manager_client(manager: User) -> APIClient:
    client = APIClient()
    client.force_login(manager)
    return client


def test_manager_searches_own_instance_by_exact_inventory_number() -> None:
    product = create_product(status=Product.Status.PUBLISHED)
    instance = product.instances.get()
    client = manager_client(product.manager)

    exact = client.get(
        "/api/v1/manager/instances/search/",
        {"inventory_number": instance.inventory_number},
    )
    partial = client.get(
        "/api/v1/manager/instances/search/",
        {"inventory_number": instance.inventory_number[:-1]},
    )

    assert exact.status_code == 200
    assert exact.json()["id"] == str(instance.pk)
    assert exact.json()["product"]["name"] == product.name
    assert partial.status_code == 404


def test_manager_cannot_search_another_managers_instance() -> None:
    product = create_product(status=Product.Status.PUBLISHED)
    other_manager = create_manager("other-maintenance@example.com")

    response = manager_client(other_manager).get(
        "/api/v1/manager/instances/search/",
        {"inventory_number": product.instances.get().inventory_number},
    )

    assert response.status_code == 404


def test_available_instance_can_start_maintenance_with_required_reason() -> None:
    product = create_product(status=Product.Status.PUBLISHED)
    instance = product.instances.get()
    client = manager_client(product.manager)
    endpoint = f"/api/v1/manager/instances/{instance.pk}/maintenance/"

    missing_reason = client.post(endpoint, {"reason": "   "}, format="json")
    started = client.post(
        endpoint,
        {"reason": "Повреждён патрон"},
        format="json",
    )
    instance.refresh_from_db()

    assert missing_reason.status_code == 400
    assert started.status_code == 201
    assert started.json()["reason"] == "Повреждён патрон"
    assert instance.status == ProductInstance.Status.MAINTENANCE
    assert Maintenance.objects.get(instance=instance).completed_at is None


def test_busy_instance_cannot_start_maintenance() -> None:
    product = create_product(status=Product.Status.PUBLISHED)
    instance = product.instances.get()
    instance.status = ProductInstance.Status.RESERVED
    instance.save(update_fields=("status",))

    response = manager_client(product.manager).post(
        f"/api/v1/manager/instances/{instance.pk}/maintenance/",
        {"reason": "Проверка"},
        format="json",
    )

    assert response.status_code == 400
    assert not Maintenance.objects.filter(instance=instance).exists()


def test_manager_completes_maintenance_with_optional_photo_act(
    tmp_path: Any,
    settings: Any,
) -> None:
    settings.MEDIA_ROOT = tmp_path
    product = create_product(status=Product.Status.PUBLISHED)
    instance = product.instances.get()
    client = manager_client(product.manager)
    start = client.post(
        f"/api/v1/manager/instances/{instance.pk}/maintenance/",
        {"reason": "Повреждён патрон"},
        format="json",
    )

    completed = client.post(
        f"/api/v1/manager/maintenances/{start.json()['id']}/complete/",
        {
            "repair_cost": "1250.50",
            "damage_description": "Патрон заменён",
            "images": SimpleUploadedFile(
                "repair.png",
                make_png(),
                content_type="image/png",
            ),
        },
        format="multipart",
    )
    instance.refresh_from_db()
    maintenance = Maintenance.objects.get(pk=start.json()["id"])

    assert completed.status_code == 200, completed.json()
    assert completed.json()["repair_cost"] == "1250.50"
    assert len(completed.json()["photos"]) == 1
    assert instance.status == ProductInstance.Status.AVAILABLE
    assert maintenance.completed_at is not None
    assert maintenance.repair_cost == Decimal("1250.50")
    assert MaintenancePhoto.objects.filter(maintenance=maintenance).count() == 1


def test_maintenance_completion_defaults_description_to_start_reason() -> None:
    product = create_product(status=Product.Status.PUBLISHED)
    instance = product.instances.get()
    client = manager_client(product.manager)
    started = client.post(
        f"/api/v1/manager/instances/{instance.pk}/maintenance/",
        {"reason": "Скол корпуса"},
        format="json",
    )

    completed = client.post(
        f"/api/v1/manager/maintenances/{started.json()['id']}/complete/",
        {"repair_cost": "0", "damage_description": ""},
        format="multipart",
    )

    assert completed.status_code == 200
    assert completed.json()["damage_description"] == "Скол корпуса"


def test_product_detail_includes_maintenance_history_and_total() -> None:
    product = create_product(status=Product.Status.PUBLISHED)
    instance = product.instances.get()
    maintenance = Maintenance.objects.create(
        instance=instance,
        started_by=product.manager,
        reason="Скол корпуса",
    )
    maintenance.damage_description = "Корпус заменён"
    maintenance.repair_cost = Decimal("750.00")
    from django.utils import timezone

    maintenance.completed_at = timezone.now()
    maintenance.save()

    response = manager_client(product.manager).get(
        f"/api/v1/manager/products/{product.pk}/"
    )
    instance_data = response.json()["instances"][0]

    assert response.status_code == 200
    assert instance_data["repair_total"] == "750.00"
    assert instance_data["history"][0]["kind"] == "MAINTENANCE"
    assert instance_data["history"][0]["damage_description"] == "Корпус заменён"


def test_maintenance_photo_is_private(tmp_path: Any, settings: Any) -> None:
    settings.MEDIA_ROOT = tmp_path
    product = create_product(status=Product.Status.PUBLISHED)
    maintenance = Maintenance.objects.create(
        instance=product.instances.get(),
        started_by=product.manager,
        reason="Проверка",
    )
    photo = MaintenancePhoto.objects.create(
        maintenance=maintenance,
        image=SimpleUploadedFile(
            "repair.png",
            make_png(),
            content_type="image/png",
        ),
    )
    stranger = create_manager("stranger-maintenance@example.com")

    own = manager_client(product.manager).get(f"/api/v1/maintenance-photos/{photo.pk}/")
    forbidden = manager_client(stranger).get(f"/api/v1/maintenance-photos/{photo.pk}/")

    assert own.status_code == 200
    assert forbidden.status_code == 403
