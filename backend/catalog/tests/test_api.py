"""Public product catalog API acceptance tests."""

from typing import Any

from django.urls import reverse
import pytest
from rest_framework import status
from rest_framework.test import APIClient

from catalog.models import Product, ProductInstance
from catalog.tests.factories import create_manager, create_product
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
