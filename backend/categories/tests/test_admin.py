"""Django admin configuration tests for categories."""

from typing import Any

from django.contrib import admin
from django.test import Client
from django.urls import reverse
import pytest

from catalog.models import ProductCharacteristicValue
from catalog.tests.factories import create_product
from categories.admin import CategoryAdmin, CharacteristicAdmin
from categories.models import Category, Characteristic, CharacteristicOption
from users.models import User

pytestmark = pytest.mark.django_db


def test_category_admin_supports_creating_characteristics_inline() -> None:
    category_admin = admin.site._registry[Category]

    assert isinstance(category_admin, CategoryAdmin)
    assert any(inline.model is Characteristic for inline in category_admin.inlines)


def test_characteristic_admin_supports_creating_list_options_inline() -> None:
    characteristic_admin = admin.site._registry[Characteristic]

    assert isinstance(characteristic_admin, CharacteristicAdmin)
    assert characteristic_admin.inlines


def test_admin_creates_a_category_with_multiple_characteristics() -> None:
    administrator = User.objects.create_superuser(
        email="admin@example.com",
        password="Strong-test-pass-937!",
        name="Администратор",
    )
    client = Client()
    client.force_login(administrator)

    response = client.post(
        reverse("admin:categories_category_add"),
        {
            "name": "Дрели",
            "parent": "",
            "characteristics-TOTAL_FORMS": "2",
            "characteristics-INITIAL_FORMS": "0",
            "characteristics-MIN_NUM_FORMS": "0",
            "characteristics-MAX_NUM_FORMS": "1000",
            "characteristics-0-name": "Мощность",
            "characteristics-0-type": Characteristic.Type.NUMBER,
            "characteristics-0-is_required": "on",
            "characteristics-0-unit": "Вт",
            "characteristics-0-display_order": "10",
            "characteristics-1-name": "Есть реверс",
            "characteristics-1-type": Characteristic.Type.BOOLEAN,
            "characteristics-1-unit": "",
            "characteristics-1-display_order": "20",
            "_save": "Сохранить",
        },
    )

    assert response.status_code == 302
    category = Category.objects.get(name="Дрели")
    assert list(category.characteristics.values_list("name", flat=True)) == [
        "Мощность",
        "Есть реверс",
    ]


def test_admin_rejects_inherited_characteristic_name_on_new_category() -> None:
    administrator = User.objects.create_superuser(
        email="admin@example.com",
        password="Strong-test-pass-937!",
        name="Администратор",
    )
    root = Category.objects.create(name="Инструменты")
    Characteristic.objects.create(
        category=root, name="Бренд", type=Characteristic.Type.LIST
    )
    client = Client()
    client.force_login(administrator)

    response = client.post(
        reverse("admin:categories_category_add"),
        {
            "name": "Дрели",
            "parent": root.pk,
            "characteristics-TOTAL_FORMS": "1",
            "characteristics-INITIAL_FORMS": "0",
            "characteristics-MIN_NUM_FORMS": "0",
            "characteristics-MAX_NUM_FORMS": "1000",
            "characteristics-0-name": "бренд",
            "characteristics-0-type": Characteristic.Type.LIST,
            "characteristics-0-unit": "",
            "characteristics-0-display_order": "0",
            "_save": "Сохранить",
        },
    )

    assert response.status_code == 200
    assert not Category.objects.filter(name="Дрели").exists()


def test_admin_rejects_deleting_a_used_list_option(
    tmp_path: Any, settings: Any
) -> None:
    settings.MEDIA_ROOT = tmp_path
    administrator = User.objects.create_superuser(
        email="admin@example.com",
        password="Strong-test-pass-937!",
        name="Администратор",
    )
    category = Category.objects.create(name="Инструменты")
    characteristic = Characteristic.objects.create(
        category=category, name="Бренд", type=Characteristic.Type.LIST
    )
    option = CharacteristicOption.objects.create(
        characteristic=characteristic, value="A"
    )
    product = create_product(category=category)
    ProductCharacteristicValue.objects.create(
        product=product, characteristic=characteristic, option=option
    )
    client = Client()
    client.force_login(administrator)

    response = client.post(
        reverse("admin:categories_characteristic_change", args=[characteristic.pk]),
        {
            "category": category.pk,
            "name": characteristic.name,
            "type": characteristic.type,
            "unit": "",
            "display_order": "0",
            "options-TOTAL_FORMS": "1",
            "options-INITIAL_FORMS": "1",
            "options-MIN_NUM_FORMS": "0",
            "options-MAX_NUM_FORMS": "1000",
            "options-0-id": option.pk,
            "options-0-value": option.value,
            "options-0-display_order": "0",
            "options-0-DELETE": "on",
            "_save": "Сохранить",
        },
    )

    assert response.status_code == 200
    assert CharacteristicOption.objects.filter(pk=option.pk).exists()
