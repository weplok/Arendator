"""Tests for the initial taxonomy import command."""

from pathlib import Path

from django.core.management import call_command
from django.core.management.base import CommandError
import pytest

from categories.models import Category, Characteristic, CharacteristicOption

pytestmark = pytest.mark.django_db


def test_seed_categories_is_repeatable_and_preserves_existing_definitions() -> None:
    root = Category.objects.create(name="Электроинструменты")
    existing = Characteristic.objects.create(
        category=root,
        name="Производитель",
        type=Characteristic.Type.LIST,
        is_required=False,
    )
    CharacteristicOption.objects.create(characteristic=existing, value="свой")

    call_command("seed_categories")

    assert Category.objects.count() == 73
    assert Characteristic.objects.count() == 254
    assert CharacteristicOption.objects.count() == 371
    assert Category.objects.get(name="Электроинструменты").pk == root.pk
    existing.refresh_from_db()
    assert existing.is_required is False
    assert existing.options.filter(value="bosch").exists()
    drill = Category.objects.get(name="Электрические дрели")
    assert drill.parent_id == root.pk
    assert drill.applicable_characteristics().filter(name="Производитель").exists()

    call_command("seed_categories")

    assert Category.objects.count() == 73
    assert Characteristic.objects.count() == 254
    assert CharacteristicOption.objects.count() == 371


def test_seed_categories_rolls_back_on_invalid_taxonomy(tmp_path: Path) -> None:
    taxonomy = tmp_path / "invalid.yaml"
    taxonomy.write_text(
        "version: 2\ncategories:\n"
        "  - name: Временная\n"
        "  - name: Ошибка\n"
        "    characteristics:\n"
        "      - {name: Вес, type: NUMBER, required: false}\n",
        encoding="utf-8",
    )

    with pytest.raises(CommandError):
        call_command("seed_categories", path=taxonomy)

    assert not Category.objects.filter(name="Временная").exists()
