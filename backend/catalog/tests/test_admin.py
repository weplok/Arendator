"""Django admin integration tests for product instances."""

from decimal import Decimal
from typing import Any

from django.test import Client
from django.urls import reverse
import pytest

from catalog.models import PickupPoint, Product, ProductInstance
from catalog.tests.factories import (
    create_manager,
    create_product,
    TEST_PASSWORD,
)
from categories.models import Category
from users.models import User

pytestmark = pytest.mark.django_db


def create_admin_client() -> Client:
    administrator = User.objects.create_superuser(
        email="admin@example.com",
        password=TEST_PASSWORD,
        name="Администратор",
    )
    client = Client()
    client.force_login(administrator)
    return client


def test_instance_add_form_derives_manager_and_generates_inventory_number(
    tmp_path: Any,
    settings: Any,
) -> None:
    settings.MEDIA_ROOT = tmp_path
    product = create_product()
    client = create_admin_client()

    response = client.post(
        reverse("admin:catalog_productinstance_add"),
        {
            "product": product.pk,
            "inventory_number": "",
            "generate_inventory_number": "on",
            "status": ProductInstance.Status.AVAILABLE,
            "_save": "Сохранить",
        },
    )

    assert response.status_code == 302
    instance = product.instances.get(instance_number=2)
    assert instance.manager == product.manager
    assert instance.inventory_number == "1-2"


def test_instance_add_form_accepts_manual_inventory_number(
    tmp_path: Any,
    settings: Any,
) -> None:
    settings.MEDIA_ROOT = tmp_path
    product = create_product()
    client = create_admin_client()

    response = client.post(
        reverse("admin:catalog_productinstance_add"),
        {
            "product": product.pk,
            "inventory_number": "CUSTOM-42",
            "status": ProductInstance.Status.AVAILABLE,
            "_save": "Сохранить",
        },
    )

    assert response.status_code == 302
    instance = product.instances.get(inventory_number="CUSTOM-42")
    assert instance.manager == product.manager
    assert instance.instance_number == 2


def test_instance_add_form_hides_derived_manager_and_explains_generation(
    tmp_path: Any,
    settings: Any,
) -> None:
    settings.MEDIA_ROOT = tmp_path
    create_product()
    client = create_admin_client()

    response = client.get(reverse("admin:catalog_productinstance_add"))

    assert response.status_code == 200
    assert "id_manager" not in response.content.decode()
    content = response.content.decode()
    assert "Сгенерировать инвентарный номер автоматически" in content
    assert "Введите номер вручную или запросите генерацию" in content


def test_product_add_form_creates_inline_instance_with_generated_number(
    tmp_path: Any,
    settings: Any,
) -> None:
    settings.MEDIA_ROOT = tmp_path
    manager = create_manager()
    category = Category.objects.create(name="Инструменты")
    pickup_point = PickupPoint.objects.create(
        manager=manager,
        latitude=Decimal("55.751244"),
        longitude=Decimal("37.618423"),
        city="Москва",
        district="Тверской",
        full_address="Тверская улица, 1",
    )
    client = create_admin_client()

    response = client.post(
        reverse("admin:catalog_product_add"),
        {
            "manager": manager.pk,
            "category": category.pk,
            "pickup_point": pickup_point.pk,
            "name": "Новый товар",
            "description": "Описание товара",
            "minute_rate": "1.50",
            "status": Product.Status.DRAFT,
            "rejection_reason": "",
            "photos-TOTAL_FORMS": "1",
            "photos-INITIAL_FORMS": "0",
            "photos-MIN_NUM_FORMS": "0",
            "photos-MAX_NUM_FORMS": "1000",
            "photos-0-image": "",
            "photos-0-display_order": "0",
            "instances-TOTAL_FORMS": "1",
            "instances-INITIAL_FORMS": "0",
            "instances-MIN_NUM_FORMS": "0",
            "instances-MAX_NUM_FORMS": "1000",
            "instances-0-inventory_number": "",
            "instances-0-generate_inventory_number": "on",
            "instances-0-status": ProductInstance.Status.AVAILABLE,
            "_save": "Сохранить",
        },
    )

    assert response.status_code == 302
    product = Product.objects.get(name="Новый товар")
    instance = product.instances.get()
    assert instance.manager == manager
    assert instance.inventory_number == "1-1"
