"""Catalog model rules."""

from decimal import Decimal
from typing import Any

from django.core.exceptions import ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import IntegrityError
import pytest

from catalog.models import (
    PickupPoint,
    Product,
    ProductCharacteristicValue,
    ProductInstance,
    ProductPhoto,
)
from catalog.tests.factories import create_manager, create_product, make_png
from categories.models import Category, Characteristic, CharacteristicOption
from users.models import User

pytestmark = pytest.mark.django_db


def test_product_and_instance_numbers_are_stable_manager_sequences(
    tmp_path: Any,
    settings: Any,
) -> None:
    settings.MEDIA_ROOT = tmp_path
    manager = create_manager()
    first_product = create_product(manager=manager, name="Дрель")
    second_product = create_product(manager=manager, name="Шуруповёрт")

    second_instance = ProductInstance.objects.create(
        product=first_product,
        inventory_number="",
    )

    assert first_product.catalog_number == 1
    assert second_product.catalog_number == 2
    first_instance = first_product.instances.get(instance_number=1)
    assert first_instance.inventory_number == "1-1"
    assert second_instance.instance_number == 2
    assert second_instance.inventory_number == "1-2"


def test_inventory_number_is_unique_within_manager_catalog(
    tmp_path: Any,
    settings: Any,
) -> None:
    settings.MEDIA_ROOT = tmp_path
    manager = create_manager()
    first_product = create_product(manager=manager, name="Дрель")
    second_product = create_product(manager=manager, name="Шуруповёрт")

    with pytest.raises(ValidationError):
        ProductInstance.objects.create(
            product=second_product,
            inventory_number=first_product.instances.get().inventory_number,
        )


def test_same_inventory_number_is_allowed_for_different_managers(
    tmp_path: Any,
    settings: Any,
) -> None:
    settings.MEDIA_ROOT = tmp_path
    first = create_product(manager=create_manager("first@example.com"))
    second = create_product(manager=create_manager("second@example.com"))

    assert first.instances.get().inventory_number == "1-1"
    assert second.instances.get().inventory_number == "1-1"


def test_pickup_point_must_belong_to_product_manager() -> None:
    manager = create_manager("owner@example.com")
    other_manager = create_manager("other@example.com")
    category = Category.objects.create(name="Инструменты")
    other_pickup = PickupPoint.objects.create(
        manager=other_manager,
        latitude=Decimal("55.75"),
        longitude=Decimal("37.61"),
        city="Москва",
        district="Тверской",
        full_address="Тверская улица, 1",
    )

    with pytest.raises(ValidationError):
        Product.objects.create(
            manager=manager,
            category=category,
            pickup_point=other_pickup,
            name="Дрель",
            description="Описание",
            minute_rate=Decimal("1.00"),
        )


def test_only_manager_can_own_pickup_point() -> None:
    renter = User.objects.create_user(
        email="renter@example.com",
        password="test-password",
        name="Анна",
        role=User.Role.RENTER,
    )

    with pytest.raises(ValidationError):
        PickupPoint.objects.create(
            manager=renter,
            latitude=Decimal("55.75"),
            longitude=Decimal("37.61"),
            city="Москва",
            district="Тверской",
            full_address="Тверская улица, 1",
        )


def test_published_pickup_point_is_immutable(
    tmp_path: Any,
    settings: Any,
) -> None:
    settings.MEDIA_ROOT = tmp_path
    product = create_product(status=Product.Status.PUBLISHED)
    pickup_point = product.pickup_point
    pickup_point.full_address = "Новый адрес"

    with pytest.raises(ValidationError):
        pickup_point.save()


def test_product_cannot_change_pickup_point_after_publication(
    tmp_path: Any,
    settings: Any,
) -> None:
    settings.MEDIA_ROOT = tmp_path
    product = create_product(status=Product.Status.PUBLISHED)
    replacement = PickupPoint.objects.create(
        manager=product.manager,
        latitude=Decimal("59.934280"),
        longitude=Decimal("30.335099"),
        city="Санкт-Петербург",
        district="Центральный",
        full_address="Невский проспект, 1",
    )
    product.pickup_point = replacement

    with pytest.raises(ValidationError):
        product.save()


def test_product_rejects_invalid_status_transition(
    tmp_path: Any,
    settings: Any,
) -> None:
    settings.MEDIA_ROOT = tmp_path
    product = create_product()
    product.status = Product.Status.FROZEN

    with pytest.raises(ValidationError):
        product.save()

    product.refresh_from_db()
    assert product.status == Product.Status.DRAFT
    assert product.published_at is None


def test_deleted_instance_flags_must_be_consistent(
    tmp_path: Any,
    settings: Any,
) -> None:
    settings.MEDIA_ROOT = tmp_path
    product = create_product()

    with pytest.raises(ValidationError):
        ProductInstance.objects.create(
            product=product,
            inventory_number="deleted-1",
            status=ProductInstance.Status.DELETED,
            is_deleted=False,
        )


def test_database_rejects_duplicate_primary_photo(
    tmp_path: Any,
    settings: Any,
) -> None:
    settings.MEDIA_ROOT = tmp_path
    product = create_product()
    original_photo = product.photos.get()

    original_photo.pk = None
    with pytest.raises((ValidationError, IntegrityError)):
        original_photo.save()


def test_product_photo_rejects_mime_type_mismatch(
    tmp_path: Any,
    settings: Any,
) -> None:
    settings.MEDIA_ROOT = tmp_path
    product = create_product()
    image = SimpleUploadedFile(
        "photo.png",
        make_png(),
        content_type="image/jpeg",
    )

    with pytest.raises(ValidationError):
        ProductPhoto.objects.create(product=product, image=image)


def test_product_photo_rejects_extension_mismatch(
    tmp_path: Any,
    settings: Any,
) -> None:
    settings.MEDIA_ROOT = tmp_path
    product = create_product()
    image = SimpleUploadedFile(
        "photo.jpg",
        make_png(),
        content_type="image/png",
    )

    with pytest.raises(ValidationError):
        ProductPhoto.objects.create(product=product, image=image)


def test_product_photo_storage_name_is_generated_by_server(
    tmp_path: Any,
    settings: Any,
) -> None:
    settings.MEDIA_ROOT = tmp_path
    product = create_product()
    image = SimpleUploadedFile(
        "private-client-name.png",
        make_png(),
        content_type="image/png",
    )

    photo = ProductPhoto.objects.create(product=product, image=image)

    image_name = photo.image.name
    assert image_name is not None
    assert image_name.startswith(f"products/{product.pk}/")
    assert "private-client-name" not in image_name


def test_product_category_cannot_change_after_creation(
    tmp_path: Any, settings: Any
) -> None:
    settings.MEDIA_ROOT = tmp_path
    product = create_product()
    product.category = Category.objects.create(name="Другая")

    with pytest.raises(ValidationError) as error:
        product.save()

    assert "category" in error.value.message_dict


def test_inherited_required_value_is_checked_on_moderation(
    tmp_path: Any, settings: Any
) -> None:
    settings.MEDIA_ROOT = tmp_path
    root = Category.objects.create(name="Инструменты")
    child = Category.objects.create(name="Пилы", parent=root)
    leaf = Category.objects.create(name="Циркулярные", parent=child)
    characteristic = Characteristic.objects.create(
        category=root,
        name="Мощность",
        type=Characteristic.Type.NUMBER,
        unit="Вт",
        is_required=True,
    )
    product = create_product(category=leaf)
    product.status = Product.Status.ON_MODERATION

    with pytest.raises(ValidationError) as error:
        product.save()
    assert "characteristics" in error.value.message_dict

    ProductCharacteristicValue.objects.create(
        product=product, characteristic=characteristic, number_value=Decimal("500")
    )
    product.save()
    assert product.status == Product.Status.ON_MODERATION


def test_value_rejects_unrelated_definition_and_wrong_option(
    tmp_path: Any, settings: Any
) -> None:
    settings.MEDIA_ROOT = tmp_path
    root = Category.objects.create(name="Инструменты")
    sibling = Category.objects.create(name="Фото")
    product = create_product(category=root)
    other = Characteristic.objects.create(
        category=sibling, name="Бренд", type=Characteristic.Type.LIST
    )
    option = CharacteristicOption.objects.create(characteristic=other, value="A")

    with pytest.raises(ValidationError):
        ProductCharacteristicValue.objects.create(
            product=product, characteristic=other, option=option
        )

    own = Characteristic.objects.create(
        category=root, name="Другой бренд", type=Characteristic.Type.LIST
    )
    with pytest.raises(ValidationError):
        ProductCharacteristicValue.objects.create(
            product=product, characteristic=own, option=option
        )
