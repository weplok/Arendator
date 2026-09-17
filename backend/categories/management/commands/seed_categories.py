"""Add missing categories and characteristics from the versioned taxonomy."""

from pathlib import Path
from typing import Any

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError, CommandParser
from django.db import transaction
import yaml

from categories.models import Category, Characteristic, CharacteristicOption

DEFAULT_TAXONOMY = Path(settings.BASE_DIR).parent / "docs" / "category-taxonomy-v2.yaml"


def require_mapping(value: object, location: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise CommandError(f"{location}: ожидается объект YAML.")
    return value


def require_list(value: object, location: str) -> list[Any]:
    if not isinstance(value, list):
        raise CommandError(f"{location}: ожидается список YAML.")
    return value


def require_name(value: object, location: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise CommandError(f"{location}: требуется непустое название.")
    return value.strip()


class Command(BaseCommand):
    help = "Добавить недостающие категории и характеристики из taxonomy v2."

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument(
            "--path",
            type=Path,
            default=DEFAULT_TAXONOMY,
            help="Путь к category-taxonomy-v2.yaml.",
        )

    def handle(self, *args: Any, **options: Any) -> None:
        path: Path = options["path"]
        try:
            taxonomy = require_mapping(
                yaml.safe_load(path.read_text(encoding="utf-8")), str(path)
            )
        except (OSError, yaml.YAMLError) as exc:
            raise CommandError(f"Не удалось прочитать {path}: {exc}") from exc

        if taxonomy.get("version") != 2:
            raise CommandError("Поддерживается только версия таксономии 2.")
        roots = require_list(taxonomy.get("categories"), "categories")
        created = {"categories": 0, "characteristics": 0, "options": 0}
        try:
            with transaction.atomic():
                for raw_category in roots:
                    self.seed_category(raw_category, None, created)
        except (
            ValidationError,
            Category.MultipleObjectsReturned,
            Characteristic.MultipleObjectsReturned,
            CharacteristicOption.MultipleObjectsReturned,
        ) as exc:
            raise CommandError(f"Ошибка загрузки таксономии: {exc}") from exc

        self.stdout.write(
            self.style.SUCCESS(
                "Таксономия v2: добавлено категорий {categories}, "
                "характеристик {characteristics}, вариантов {options}.".format(
                    **created
                )
            )
        )

    def seed_category(
        self,
        raw: object,
        parent: Category | None,
        created: dict[str, int],
    ) -> None:
        data = require_mapping(raw, "category")
        name = require_name(data.get("name"), "category.name")
        category, was_created = Category.objects.get_or_create(parent=parent, name=name)
        created["categories"] += int(was_created)

        for order, raw_characteristic in enumerate(
            require_list(data.get("characteristics", []), f"{name}.characteristics")
        ):
            self.seed_characteristic(raw_characteristic, category, order, created)

        for child in require_list(data.get("children", []), f"{name}.children"):
            self.seed_category(child, category, created)

    def seed_characteristic(
        self,
        raw: object,
        category: Category,
        order: int,
        created: dict[str, int],
    ) -> None:
        data = require_mapping(raw, f"{category.name}.characteristic")
        name = require_name(data.get("name"), "characteristic.name")
        characteristic_type = data.get("type")
        if characteristic_type not in Characteristic.Type.values:
            raise CommandError(f"{category.name}/{name}: неизвестный тип.")
        required = data.get("required")
        if not isinstance(required, bool):
            raise CommandError(f"{category.name}/{name}: required должен быть bool.")
        unit = data.get("unit", "")
        if not isinstance(unit, str):
            raise CommandError(f"{category.name}/{name}: unit должен быть строкой.")
        options = require_list(
            data.get("options", []), f"{category.name}/{name}.options"
        )
        if characteristic_type != Characteristic.Type.LIST and options:
            raise CommandError(
                f"{category.name}/{name}: options допустимы только для LIST."
            )

        characteristic, was_created = Characteristic.objects.get_or_create(
            category=category,
            name=name,
            defaults={
                "type": characteristic_type,
                "is_required": required,
                "unit": unit,
                "display_order": order,
            },
        )
        created["characteristics"] += int(was_created)
        if characteristic.type != characteristic_type:
            raise CommandError(
                f"{category.name}/{name}: существующая характеристика имеет "
                "другой тип."
            )
        for option_order, raw_option in enumerate(options):
            value = require_name(raw_option, f"{category.name}/{name}.option")
            _, option_created = CharacteristicOption.objects.get_or_create(
                characteristic=characteristic,
                value=value,
                defaults={"display_order": option_order},
            )
            created["options"] += int(option_created)
