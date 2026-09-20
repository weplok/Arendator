"""Django admin integration tests for product instances."""

from decimal import Decimal
from typing import Any

from django.test import Client
from django.urls import reverse
import pytest

from catalog.models import (
    ModerationDecision,
    PickupPoint,
    Product,
    ProductInstance,
)
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
            "characteristic_values-TOTAL_FORMS": "0",
            "characteristic_values-INITIAL_FORMS": "0",
            "characteristic_values-MIN_NUM_FORMS": "0",
            "characteristic_values-MAX_NUM_FORMS": "1000",
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


def test_product_change_form_places_moderation_after_inlines_before_save(
    tmp_path: Any,
    settings: Any,
) -> None:
    settings.MEDIA_ROOT = tmp_path
    product = create_product(status=Product.Status.ON_MODERATION)
    client = create_admin_client()

    response = client.get(reverse("admin:catalog_product_change", args=(product.pk,)))

    content = response.content.decode()
    assert response.status_code == 200
    assert content.index('id="instances-group"') < content.index("Модерация")
    assert content.index("Модерация") < content.index('name="_save"')


def test_admin_approves_all_pending_products_after_confirmation(
    tmp_path: Any,
    settings: Any,
) -> None:
    settings.MEDIA_ROOT = tmp_path
    first = create_product(status=Product.Status.ON_MODERATION, name="Дрель")
    second = create_product(
        manager=create_manager("second@example.com"),
        status=Product.Status.ON_MODERATION,
        name="Пила",
    )
    client = create_admin_client()
    url = reverse("admin:catalog_product_approve_all")

    confirmation = client.get(url)
    response = client.post(url, {"confirm": "yes"})

    assert confirmation.status_code == 200
    assert "Одобрить все заявки" in confirmation.content.decode()
    assert response.status_code == 302
    assert not Product.objects.filter(status=Product.Status.ON_MODERATION).exists()
    assert (
        Product.objects.filter(
            pk__in=(first.pk, second.pk), status=Product.Status.PUBLISHED
        ).count()
        == 2
    )
    assert (
        ModerationDecision.objects.filter(
            decision=ModerationDecision.Decision.APPROVED
        ).count()
        == 2
    )


def test_admin_rejects_product_with_reason_and_marks_manager(
    tmp_path: Any,
    settings: Any,
) -> None:
    settings.MEDIA_ROOT = tmp_path
    product = create_product(status=Product.Status.ON_MODERATION)
    photo = product.photos.get()
    instance = product.instances.get()
    client = create_admin_client()

    response = client.post(
        reverse("admin:catalog_product_change", args=(product.pk,)),
        {
            "manager": product.manager_id,
            "category": product.category_id,
            "pickup_point": product.pickup_point_id,
            "name": product.name,
            "description": product.description,
            "minute_rate": str(product.minute_rate),
            "moderation_action": "REJECT",
            "moderation_reason": "Нужна фотография серийного номера.",
            "manager_moderation_label": User.ModerationLabel.TRUSTED,
            "photos-TOTAL_FORMS": "1",
            "photos-INITIAL_FORMS": "1",
            "photos-MIN_NUM_FORMS": "0",
            "photos-MAX_NUM_FORMS": "1000",
            "photos-0-id": photo.pk,
            "photos-0-display_order": photo.display_order,
            "photos-0-is_primary": "on",
            "characteristic_values-TOTAL_FORMS": "0",
            "characteristic_values-INITIAL_FORMS": "0",
            "characteristic_values-MIN_NUM_FORMS": "0",
            "characteristic_values-MAX_NUM_FORMS": "1000",
            "instances-TOTAL_FORMS": "1",
            "instances-INITIAL_FORMS": "1",
            "instances-MIN_NUM_FORMS": "0",
            "instances-MAX_NUM_FORMS": "1000",
            "instances-0-id": instance.pk,
            "instances-0-inventory_number": instance.inventory_number,
            "instances-0-status": instance.status,
            "_save": "Сохранить",
        },
    )

    product.refresh_from_db()
    product.manager.refresh_from_db()
    assert response.status_code == 302
    assert product.status == Product.Status.REJECTED
    assert product.rejection_reason == "Нужна фотография серийного номера."
    assert product.manager.moderation_label == User.ModerationLabel.TRUSTED
    assert ModerationDecision.objects.filter(
        product=product,
        decision=ModerationDecision.Decision.REJECTED,
        reason="Нужна фотография серийного номера.",
    ).exists()
