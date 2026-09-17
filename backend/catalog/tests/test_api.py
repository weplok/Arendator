"""Public product catalog API acceptance tests."""

from typing import Any

from django.urls import reverse
import pytest
from rest_framework import status
from rest_framework.test import APIClient

from catalog.models import Product, ProductCharacteristicValue, ProductInstance
from catalog.tests.factories import create_manager, create_product
from categories.models import Category, Characteristic, CharacteristicOption
from users.models import User

pytestmark = pytest.mark.django_db


def test_catalog_is_public_paginated_and_contains_only_published_products(
    tmp_path: Any,
    settings: Any,
    django_assert_num_queries: Any,
) -> None:
    settings.MEDIA_ROOT = tmp_path
    published = create_product(
        manager=create_manager("published@example.com"),
        status=Product.Status.PUBLISHED,
    )
    create_product(
        manager=create_manager("draft@example.com"),
        status=Product.Status.DRAFT,
    )
    create_product(
        manager=create_manager("frozen@example.com"),
        status=Product.Status.FROZEN,
    )

    with django_assert_num_queries(3):
        response = APIClient().get(reverse("catalog:product-list"))

    assert response.status_code == status.HTTP_200_OK
    assert response.json()["count"] == 1
    result = response.json()["results"][0]
    assert result["id"] == published.id
    assert result["available_instances_count"] == 1
    assert result["primary_photo"]["url"].startswith("/media/products/")


def test_catalog_reports_only_available_non_deleted_instances(
    tmp_path: Any,
    settings: Any,
) -> None:
    settings.MEDIA_ROOT = tmp_path
    product = create_product(status=Product.Status.PUBLISHED)
    ProductInstance.objects.create(
        product=product,
        inventory_number="reserved",
        status=ProductInstance.Status.RESERVED,
    )
    ProductInstance.objects.create(
        product=product,
        inventory_number="deleted",
        status=ProductInstance.Status.DELETED,
        is_deleted=True,
    )

    response = APIClient().get(reverse("catalog:product-list"))

    assert response.json()["results"][0]["available_instances_count"] == 1


def test_guest_product_card_hides_exact_pickup_location(
    tmp_path: Any,
    settings: Any,
) -> None:
    settings.MEDIA_ROOT = tmp_path
    product = create_product(status=Product.Status.PUBLISHED)

    response = APIClient().get(
        reverse("catalog:product-detail", kwargs={"pk": product.pk})
    )

    assert response.status_code == status.HTTP_200_OK
    pickup = response.json()["pickup_point"]
    assert pickup == {"city": "Москва", "district": "Тверской"}
    assert "inventory_number" not in str(response.json())


def test_authenticated_product_card_exposes_address_and_yandex_maps_link(
    tmp_path: Any,
    settings: Any,
) -> None:
    settings.MEDIA_ROOT = tmp_path
    product = create_product(status=Product.Status.PUBLISHED)
    renter = User.objects.create_user(
        email="renter@example.com",
        password="test-password",
        name="Анна",
        role=User.Role.RENTER,
    )
    client = APIClient()
    client.force_login(renter)

    response = client.get(reverse("catalog:product-detail", kwargs={"pk": product.pk}))

    assert response.status_code == status.HTTP_200_OK
    pickup = response.json()["pickup_point"]
    assert pickup["full_address"] == "Тверская улица, 1"
    assert pickup["latitude"] == "55.751244"
    assert pickup["longitude"] == "37.618423"
    assert pickup["yandex_maps_url"] == (
        "https://yandex.ru/maps/?pt=37.618423,55.751244&z=16&l=map"
    )


def test_product_card_returns_ordered_carousel_photos(
    tmp_path: Any,
    settings: Any,
) -> None:
    settings.MEDIA_ROOT = tmp_path
    product = create_product(status=Product.Status.PUBLISHED)
    photo = product.photos.get()
    photo.display_order = 20
    photo.save()

    response = APIClient().get(
        reverse("catalog:product-detail", kwargs={"pk": product.pk})
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.json()["photos"] == [response.json()["primary_photo"]]


def test_hidden_product_card_returns_not_found(
    tmp_path: Any,
    settings: Any,
) -> None:
    settings.MEDIA_ROOT = tmp_path
    product = create_product(status=Product.Status.HIDDEN_BY_ADMIN)

    response = APIClient().get(
        reverse("catalog:product-detail", kwargs={"pk": product.pk})
    )

    assert response.status_code == status.HTTP_404_NOT_FOUND


def test_manager_profile_splits_active_and_frozen_products(
    tmp_path: Any,
    settings: Any,
) -> None:
    settings.MEDIA_ROOT = tmp_path
    manager = create_manager()
    active = create_product(
        manager=manager,
        name="Активный товар",
        status=Product.Status.PUBLISHED,
    )
    frozen = create_product(
        manager=manager,
        name="Архивный товар",
        status=Product.Status.FROZEN,
    )
    create_product(manager=manager, name="Черновик", status=Product.Status.DRAFT)
    client = APIClient()

    profile_response = client.get(
        reverse("catalog:manager-detail", kwargs={"pk": manager.pk})
    )
    active_response = client.get(
        reverse("catalog:manager-active-products", kwargs={"pk": manager.pk})
    )
    frozen_response = client.get(
        reverse("catalog:manager-frozen-products", kwargs={"pk": manager.pk})
    )

    assert profile_response.status_code == status.HTTP_200_OK
    assert profile_response.json()["active_products_count"] == 1
    assert profile_response.json()["frozen_products_count"] == 1
    assert [item["id"] for item in active_response.json()["results"]] == [active.id]
    assert [item["id"] for item in frozen_response.json()["results"]] == [frozen.id]


def test_root_characteristic_filter_matches_products_across_child_branches(
    tmp_path: Any, settings: Any
) -> None:
    settings.MEDIA_ROOT = tmp_path
    root = Category.objects.create(name="Инструменты")
    left = Category.objects.create(name="Дрели", parent=root)
    right = Category.objects.create(name="Пилы", parent=root)
    leaf = Category.objects.create(name="Циркулярные", parent=right)
    brand = Characteristic.objects.create(
        category=root, name="Бренд", type=Characteristic.Type.LIST
    )
    option = CharacteristicOption.objects.create(characteristic=brand, value="А")
    manager = create_manager()
    products = [
        create_product(manager=manager, category=category, name=f"Товар {index}")
        for index, category in enumerate((left, leaf, root))
    ]
    for product in products[:2]:
        ProductCharacteristicValue.objects.create(
            product=product, characteristic=brand, option=option
        )
    for product in products:
        product.status = Product.Status.ON_MODERATION
        product.save()
        product.status = Product.Status.PUBLISHED
        product.save()
    brand.is_required = True
    brand.save()

    response = APIClient().get(
        reverse("catalog:product-list"),
        {"category": root.pk, f"characteristic_{brand.pk}": option.pk},
    )

    assert response.status_code == status.HTTP_200_OK
    assert {item["id"] for item in response.json()["results"]} == {
        products[0].pk,
        products[1].pk,
    }
    products[2].refresh_from_db()
    assert products[2].status == Product.Status.PUBLISHED


def test_manager_replaces_values_and_must_include_inherited_required_value(
    tmp_path: Any, settings: Any
) -> None:
    settings.MEDIA_ROOT = tmp_path
    root = Category.objects.create(name="Инструменты")
    child = Category.objects.create(name="Пилы", parent=root)
    required = Characteristic.objects.create(
        category=root, name="Реверс", type=Characteristic.Type.BOOLEAN, is_required=True
    )
    product = create_product(category=child)
    client = APIClient()
    client.force_login(product.manager)
    url = reverse("catalog:product-characteristics", kwargs={"pk": product.pk})

    missing = client.put(url, {"values": []}, format="json")
    assert missing.status_code == status.HTTP_400_BAD_REQUEST
    saved = client.put(
        url,
        {"values": [{"characteristic_id": required.pk, "boolean_value": False}]},
        format="json",
    )

    assert saved.status_code == status.HTTP_200_OK
    assert saved.json()[0]["boolean_value"] is False
    assert product.characteristic_values.count() == 1
    product.status = Product.Status.ON_MODERATION
    product.save()


def test_characteristic_filter_rejects_definition_from_descendant(
    tmp_path: Any, settings: Any
) -> None:
    settings.MEDIA_ROOT = tmp_path
    root = Category.objects.create(name="Инструменты")
    child = Category.objects.create(name="Пилы", parent=root)
    characteristic = Characteristic.objects.create(
        category=child, name="Мощность", type=Characteristic.Type.NUMBER, unit="Вт"
    )

    response = APIClient().get(
        reverse("catalog:product-list"),
        {"category": root.pk, f"characteristic_{characteristic.pk}_min": "100"},
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST


def test_number_and_boolean_filters_respect_values_and_range(
    tmp_path: Any, settings: Any
) -> None:
    settings.MEDIA_ROOT = tmp_path
    root = Category.objects.create(name="Инструменты")
    child = Category.objects.create(name="Дрели", parent=root)
    power = Characteristic.objects.create(
        category=root, name="Мощность", type=Characteristic.Type.NUMBER, unit="Вт"
    )
    has_reverse = Characteristic.objects.create(
        category=root, name="Реверс", type=Characteristic.Type.BOOLEAN
    )
    product = create_product(category=child)
    ProductCharacteristicValue.objects.create(
        product=product, characteristic=power, number_value=500
    )
    ProductCharacteristicValue.objects.create(
        product=product, characteristic=has_reverse, boolean_value=False
    )
    product.status = Product.Status.ON_MODERATION
    product.save()
    product.status = Product.Status.PUBLISHED
    product.save()
    url = reverse("catalog:product-list")

    found = APIClient().get(
        url,
        {
            "category": root.pk,
            f"characteristic_{power.pk}_min": "400",
            f"characteristic_{power.pk}_max": "600",
            f"characteristic_{has_reverse.pk}": "false",
        },
    )
    missing = APIClient().get(
        url, {"category": root.pk, f"characteristic_{power.pk}_min": "501"}
    )

    assert found.json()["count"] == 1
    assert missing.json()["count"] == 0
    detail = APIClient().get(
        reverse("catalog:product-detail", kwargs={"pk": product.pk})
    )
    assert {item["characteristic_id"] for item in detail.json()["characteristics"]} == {
        power.pk,
        has_reverse.pk,
    }


def test_manager_cannot_change_another_managers_values(
    tmp_path: Any, settings: Any
) -> None:
    settings.MEDIA_ROOT = tmp_path
    product = create_product()
    intruder = create_manager("other@example.com")
    client = APIClient()
    client.force_login(intruder)

    response = client.put(
        reverse("catalog:product-characteristics", kwargs={"pk": product.pk}),
        {"values": []},
        format="json",
    )

    assert response.status_code == status.HTTP_403_FORBIDDEN


def test_new_required_definition_does_not_change_existing_status_but_blocks_edit(
    tmp_path: Any, settings: Any
) -> None:
    settings.MEDIA_ROOT = tmp_path
    category = Category.objects.create(name="Инструменты")
    product = create_product(category=category, status=Product.Status.PUBLISHED)
    characteristic = Characteristic.objects.create(
        category=category, name="Реверс", type=Characteristic.Type.BOOLEAN
    )
    characteristic.is_required = True
    characteristic.save()
    client = APIClient()
    client.force_login(product.manager)
    url = reverse("catalog:product-characteristics", kwargs={"pk": product.pk})

    missing = client.put(url, {"values": []}, format="json")
    product.refresh_from_db()
    assert product.status == Product.Status.PUBLISHED
    assert missing.status_code == status.HTTP_400_BAD_REQUEST

    saved = client.put(
        url,
        {"values": [{"characteristic_id": characteristic.pk, "boolean_value": True}]},
        format="json",
    )
    assert saved.status_code == status.HTTP_200_OK
