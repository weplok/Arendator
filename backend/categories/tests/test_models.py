"""Category and characteristic model tests."""

from typing import Any

from django.core.exceptions import ValidationError
from django.db.models.deletion import ProtectedError
import pytest

from catalog.models import ProductCharacteristicValue
from catalog.tests.factories import create_product
from categories.models import Category, Characteristic, CharacteristicOption

pytestmark = pytest.mark.django_db


def test_category_can_have_an_unlimited_depth_parent_chain() -> None:
    root = Category.objects.create(name="Инструменты")
    child = Category.objects.create(name="Электроинструменты", parent=root)
    grandchild = Category.objects.create(name="Дрели", parent=child)

    assert grandchild.parent == child
    assert child.parent == root


def test_category_cannot_be_moved_below_its_descendant() -> None:
    root = Category.objects.create(name="Инструменты")
    child = Category.objects.create(name="Дрели", parent=root)
    root.parent = child

    with pytest.raises(ValidationError, match="цикл"):
        root.save()


def test_category_rejects_a_whitespace_only_name() -> None:
    with pytest.raises(ValidationError) as error:
        Category.objects.create(name="   ")

    assert "name" in error.value.message_dict


def test_deleting_category_keeps_its_children_as_roots() -> None:
    root = Category.objects.create(name="Инструменты")
    child = Category.objects.create(name="Дрели", parent=root)

    root.delete()

    child.refresh_from_db()
    assert child.parent is None


@pytest.mark.parametrize(
    ("characteristic_type", "unit"),
    [
        (Characteristic.Type.LIST, "мм"),
        (Characteristic.Type.BOOLEAN, "шт."),
        (Characteristic.Type.NUMBER, ""),
    ],
)
def test_characteristic_rejects_an_incompatible_unit(
    characteristic_type: str,
    unit: str,
) -> None:
    category = Category.objects.create(name="Дрели")

    with pytest.raises(ValidationError) as error:
        Characteristic.objects.create(
            category=category,
            name="Параметр",
            type=characteristic_type,
            unit=unit,
        )

    assert "unit" in error.value.message_dict


def test_characteristic_rejects_a_whitespace_only_name() -> None:
    category = Category.objects.create(name="Дрели")

    with pytest.raises(ValidationError) as error:
        Characteristic.objects.create(
            category=category,
            name="   ",
            type=Characteristic.Type.BOOLEAN,
        )

    assert "name" in error.value.message_dict


def test_list_characteristic_accepts_ordered_options() -> None:
    category = Category.objects.create(name="Дрели")
    characteristic = Characteristic.objects.create(
        category=category,
        name="Тип патрона",
        type=Characteristic.Type.LIST,
    )
    second = CharacteristicOption.objects.create(
        characteristic=characteristic,
        value="Быстрозажимной",
        display_order=20,
    )
    first = CharacteristicOption.objects.create(
        characteristic=characteristic,
        value="Ключевой",
        display_order=10,
    )

    assert list(characteristic.options.all()) == [first, second]


def test_non_list_characteristic_rejects_options() -> None:
    category = Category.objects.create(name="Дрели")
    characteristic = Characteristic.objects.create(
        category=category,
        name="Мощность",
        type=Characteristic.Type.NUMBER,
        unit="Вт",
    )

    with pytest.raises(ValidationError, match="LIST"):
        CharacteristicOption.objects.create(
            characteristic=characteristic,
            value="500",
        )


def test_list_option_rejects_a_whitespace_only_value() -> None:
    category = Category.objects.create(name="Дрели")
    characteristic = Characteristic.objects.create(
        category=category,
        name="Тип патрона",
        type=Characteristic.Type.LIST,
    )

    with pytest.raises(ValidationError) as error:
        CharacteristicOption.objects.create(
            characteristic=characteristic,
            value="   ",
        )

    assert "value" in error.value.message_dict


def test_descendant_cannot_redefine_ancestor_characteristic() -> None:
    root = Category.objects.create(name="Инструменты")
    child = Category.objects.create(name="Дрели", parent=root)
    Characteristic.objects.create(
        category=root, name="Бренд", type=Characteristic.Type.LIST
    )

    with pytest.raises(ValidationError) as error:
        Characteristic.objects.create(
            category=child, name="бренд", type=Characteristic.Type.BOOLEAN
        )

    assert "name" in error.value.message_dict


def test_same_name_in_separate_branches_is_allowed() -> None:
    left = Category.objects.create(name="Инструменты")
    right = Category.objects.create(name="Фото")
    for category in (left, right):
        Characteristic.objects.create(
            category=category, name="Бренд", type=Characteristic.Type.LIST
        )


def test_existing_characteristic_type_is_immutable() -> None:
    category = Category.objects.create(name="Инструменты")
    characteristic = Characteristic.objects.create(
        category=category, name="Бренд", type=Characteristic.Type.LIST
    )
    characteristic.type = Characteristic.Type.BOOLEAN

    with pytest.raises(ValidationError) as error:
        characteristic.save()

    assert "type" in error.value.message_dict


def test_used_list_option_is_protected_but_definition_can_be_deleted(
    tmp_path: Any, settings: Any
) -> None:
    settings.MEDIA_ROOT = tmp_path
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

    with pytest.raises(ProtectedError):
        option.delete()
    characteristic.delete()

    assert not ProductCharacteristicValue.objects.filter(product=product).exists()


def test_moving_branch_cannot_orphan_existing_values(
    tmp_path: Any, settings: Any
) -> None:
    settings.MEDIA_ROOT = tmp_path
    root = Category.objects.create(name="Инструменты")
    child = Category.objects.create(name="Дрели", parent=root)
    other_root = Category.objects.create(name="Фото")
    characteristic = Characteristic.objects.create(
        category=root, name="Бренд", type=Characteristic.Type.LIST
    )
    option = CharacteristicOption.objects.create(
        characteristic=characteristic, value="A"
    )
    product = create_product(category=child)
    ProductCharacteristicValue.objects.create(
        product=product, characteristic=characteristic, option=option
    )
    child.parent = other_root

    with pytest.raises(ValidationError) as error:
        child.save()

    assert "parent" in error.value.message_dict
