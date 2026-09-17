"""Public category API tests."""

from typing import Any

from django.urls import reverse
import pytest
from rest_framework import status
from rest_framework.test import APIClient

from categories.models import Category, Characteristic, CharacteristicOption

pytestmark = pytest.mark.django_db


def test_category_list_is_public_and_has_a_fixed_query_count(
    django_assert_num_queries: Any,
) -> None:
    root = Category.objects.create(name="Инструменты")
    child = Category.objects.create(name="Дрели", parent=root)
    power = Characteristic.objects.create(
        category=child,
        name="Мощность",
        type=Characteristic.Type.NUMBER,
        unit="Вт",
        is_required=True,
        display_order=10,
    )
    chuck = Characteristic.objects.create(
        category=child,
        name="Тип патрона",
        type=Characteristic.Type.LIST,
        display_order=20,
    )
    CharacteristicOption.objects.create(
        characteristic=chuck,
        value="Ключевой",
        display_order=10,
    )

    with django_assert_num_queries(3):
        response = APIClient().get(reverse("categories:list"))

    assert response.status_code == status.HTTP_200_OK
    assert response.json() == [
        {
            "id": root.id,
            "name": "Инструменты",
            "parent_id": None,
            "characteristics": [],
        },
        {
            "id": child.id,
            "name": "Дрели",
            "parent_id": root.id,
            "characteristics": [
                {
                    "id": power.id,
                    "category_id": child.id,
                    "name": "Мощность",
                    "type": "NUMBER",
                    "is_required": True,
                    "unit": "Вт",
                    "display_order": 10,
                    "options": [],
                },
                {
                    "id": chuck.id,
                    "category_id": child.id,
                    "name": "Тип патрона",
                    "type": "LIST",
                    "is_required": False,
                    "unit": "",
                    "display_order": 20,
                    "options": [
                        {
                            "id": chuck.options.get().id,
                            "value": "Ключевой",
                            "display_order": 10,
                        }
                    ],
                },
            ],
        },
    ]


def test_category_list_exposes_inherited_definitions_at_every_depth() -> None:
    root = Category.objects.create(name="Инструменты")
    child = Category.objects.create(name="Пилы", parent=root)
    leaf = Category.objects.create(name="Циркулярные", parent=child)
    shared = Characteristic.objects.create(
        category=root, name="Бренд", type=Characteristic.Type.LIST
    )
    local = Characteristic.objects.create(
        category=child, name="Мощность", type=Characteristic.Type.NUMBER, unit="Вт"
    )

    response = APIClient().get(reverse("categories:list"))

    assert response.status_code == status.HTTP_200_OK
    categories = {item["id"]: item for item in response.json()}
    assert [item["id"] for item in categories[root.id]["characteristics"]] == [
        shared.id
    ]
    assert {item["id"] for item in categories[child.id]["characteristics"]} == {
        shared.id,
        local.id,
    }
    assert {item["id"] for item in categories[leaf.id]["characteristics"]} == {
        shared.id,
        local.id,
    }
