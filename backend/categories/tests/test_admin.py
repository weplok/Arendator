"""Django admin configuration tests for categories."""

from django.contrib import admin
from django.test import Client
from django.urls import reverse
import pytest

from categories.admin import CategoryAdmin, CharacteristicAdmin
from categories.models import Category, Characteristic
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
