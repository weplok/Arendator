"""Manager catalog workflow and ownership boundaries."""

from typing import Any

from django.core.files.uploadedfile import SimpleUploadedFile
import pytest
from rest_framework.test import APIClient

from catalog.models import (
    ModerationDecision,
    ModerationSettings,
    Product,
    ProductInstance,
)
from catalog.tests.factories import create_manager, create_product, make_png
from categories.models import Category
from users.models import User

pytestmark = pytest.mark.django_db


def manager_client(manager: User) -> APIClient:
    client = APIClient()
    client.force_login(manager)
    return client


def test_completed_draft_is_sent_to_moderation_and_hidden_from_catalog(
    tmp_path: Any, settings: Any
) -> None:
    settings.MEDIA_ROOT = tmp_path
    manager = create_manager()
    client = manager_client(manager)
    category = Category.objects.create(name="Инструменты")
    created = client.post(
        "/api/v1/manager/products/",
        {
            "category": category.pk,
            "name": "Дрель",
            "description": "Рабочая дрель",
            "minute_rate": "3.00",
        },
    )
    assert created.status_code == 201, created.json()
    product_id = created.json()["id"]
    assert created.json()["pickup_point"] is None
    assert (
        client.post(f"/api/v1/manager/products/{product_id}/submit/").status_code == 400
    )
    assert Product.objects.get(pk=product_id).status == Product.Status.DRAFT
    pickup_response = client.put(
        f"/api/v1/manager/products/{product_id}/pickup/",
        {
            "city": "Москва",
            "district": "Центр",
            "full_address": "Улица 1",
            "latitude": "55.750000",
            "longitude": "37.610000",
        },
    )
    assert pickup_response.status_code == 200
    assert pickup_response.json()["pickup_point"]["full_address"] == "Улица 1"
    assert (
        client.post(
            f"/api/v1/manager/products/{product_id}/photos/",
            {
                "image": SimpleUploadedFile(
                    "drill.png", make_png(), content_type="image/png"
                )
            },
            format="multipart",
        ).status_code
        == 201
    )
    assert (
        client.post(f"/api/v1/manager/products/{product_id}/instances/", {}).status_code
        == 201
    )
    submitted = client.post(f"/api/v1/manager/products/{product_id}/submit/")
    assert submitted.status_code == 200, submitted.json()
    assert submitted.json()["status"] == "ON_MODERATION"
    assert Product.objects.get(pk=product_id).published_at is None
    assert APIClient().get("/api/v1/products/").json()["count"] == 0


def test_rejected_product_can_be_resubmitted_without_changes(
    tmp_path: Any, settings: Any
) -> None:
    settings.MEDIA_ROOT = tmp_path
    product = create_product(status=Product.Status.REJECTED)
    client = manager_client(product.manager)

    response = client.post(f"/api/v1/manager/products/{product.pk}/submit/")

    assert response.status_code == 200
    assert response.json()["status"] == Product.Status.ON_MODERATION
    assert response.json()["rejection_reason"] == ""


def test_auto_moderation_approves_only_new_submission(
    tmp_path: Any, settings: Any
) -> None:
    settings.MEDIA_ROOT = tmp_path
    previous = create_product(status=Product.Status.ON_MODERATION, name="Старая")
    incoming = create_product(
        manager=create_manager("incoming@example.com"),
        name="Новая",
    )
    moderation_settings = ModerationSettings.load()
    moderation_settings.auto_approve_new_submissions = True
    moderation_settings.save()

    response = manager_client(incoming.manager).post(
        f"/api/v1/manager/products/{incoming.pk}/submit/"
    )

    previous.refresh_from_db()
    assert response.status_code == 200
    assert response.json()["status"] == Product.Status.PUBLISHED
    assert previous.status == Product.Status.ON_MODERATION
    assert ModerationDecision.objects.filter(
        product=incoming,
        decision=ModerationDecision.Decision.APPROVED,
        is_automatic=True,
    ).exists()


def test_manager_physically_deletes_rejected_unpublished_product(
    tmp_path: Any, settings: Any
) -> None:
    settings.MEDIA_ROOT = tmp_path
    product = create_product(status=Product.Status.REJECTED)
    client = manager_client(product.manager)

    response = client.delete(f"/api/v1/manager/products/{product.pk}/")

    assert response.status_code == 204
    assert not Product.objects.filter(pk=product.pk).exists()


def test_manager_cannot_delete_published_product(tmp_path: Any, settings: Any) -> None:
    settings.MEDIA_ROOT = tmp_path
    product = create_product(status=Product.Status.PUBLISHED)

    response = manager_client(product.manager).delete(
        f"/api/v1/manager/products/{product.pk}/"
    )

    assert response.status_code == 400
    assert Product.objects.filter(pk=product.pk).exists()


def test_manager_cannot_read_or_modify_another_catalog(
    tmp_path: Any, settings: Any
) -> None:
    settings.MEDIA_ROOT = tmp_path
    product = create_product(manager=create_manager("owner@example.com"))
    client = manager_client(create_manager("other@example.com"))
    assert client.get("/api/v1/manager/products/").json() == []
    base = f"/api/v1/manager/products/{product.pk}/"
    assert client.get(base).status_code == 404
    assert client.patch(base, {"name": "Чужой"}).status_code == 404
    assert client.post(base + "submit/").status_code == 404
    assert client.post(base + "instances/").status_code == 404
    assert client.put(base + "pickup/", {}).status_code == 404
    assert client.post(base + "photos/", {}).status_code == 404
    instance = product.instances.first()
    assert instance is not None
    assert client.delete(base + f"instances/{instance.pk}/").status_code == 404


def test_freeze_and_instance_soft_delete(tmp_path: Any, settings: Any) -> None:
    settings.MEDIA_ROOT = tmp_path
    product = create_product(status=Product.Status.PUBLISHED)
    client = manager_client(product.manager)
    instance = product.instances.first()
    assert instance is not None
    assert (
        client.delete(
            f"/api/v1/manager/products/{product.pk}/instances/{instance.pk}/"
        ).status_code
        == 204
    )
    instance.refresh_from_db()
    assert instance.status == ProductInstance.Status.DELETED
    assert instance.is_deleted
    assert (
        client.post(f"/api/v1/manager/products/{product.pk}/freeze/").status_code == 200
    )
    assert APIClient().get("/api/v1/products/").json()["count"] == 0
    assert (
        client.post(f"/api/v1/manager/products/{product.pk}/submit/").status_code == 400
    )


def test_renter_cannot_create_product() -> None:
    renter = User.objects.create_user(
        email="renter@example.com",
        password="test-pass",
        name="Анна",
        role=User.Role.RENTER,
    )
    response = manager_client(renter).post("/api/v1/manager/products/", {})
    assert response.status_code == 403


def test_published_product_requires_photo_and_keeps_category_and_pickup(
    tmp_path: Any, settings: Any
) -> None:
    settings.MEDIA_ROOT = tmp_path
    product = create_product(status=Product.Status.PUBLISHED)
    client = manager_client(product.manager)
    base = f"/api/v1/manager/products/{product.pk}/"
    photo = product.photos.first()
    assert photo is not None
    assert client.delete(base + f"photos/{photo.pk}/").status_code == 400
    assert (
        client.patch(
            base, {"category": Category.objects.create(name="Другое").pk}
        ).status_code
        == 400
    )
    assert client.put(base + "pickup/", {}).status_code == 400
    assert client.patch(base, {"minute_rate": "4.50"}).status_code == 200
    assert product.photos.count() == 1


def test_manager_can_reorder_photos_and_first_photo_becomes_primary(
    tmp_path: Any, settings: Any
) -> None:
    settings.MEDIA_ROOT = tmp_path
    product = create_product()
    client = manager_client(product.manager)
    base = f"/api/v1/manager/products/{product.pk}/photos/"
    created = client.post(
        base,
        {
            "image": SimpleUploadedFile(
                "second.png",
                make_png(),
                content_type="image/png",
            )
        },
        format="multipart",
    )
    assert created.status_code == 201
    first_photo = product.photos.order_by("display_order", "id").first()
    assert first_photo is not None
    second_photo_id = created.json()["id"]

    reordered = client.put(
        base + "order/",
        {"photo_ids": [second_photo_id, first_photo.pk]},
        format="json",
    )

    assert reordered.status_code == 204
    ordered_photos = list(product.photos.order_by("display_order", "id"))
    assert [photo.pk for photo in ordered_photos] == [second_photo_id, first_photo.pk]
    assert [photo.is_primary for photo in ordered_photos] == [True, False]
