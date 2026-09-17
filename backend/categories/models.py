"""Category taxonomy and category-specific characteristic definitions."""

from typing import Any

from django.core.exceptions import ValidationError
from django.db import models, transaction


def ancestor_ids(category: "Category") -> list[int]:
    """Return this category and its ancestors, nearest first."""
    ids: list[int] = []
    current: Category | None = category
    while current is not None:
        if current.pk in ids:
            raise ValidationError("Обнаружен цикл в дереве категорий.")
        ids.append(current.pk)
        current = current.parent
    return ids


def descendant_ids(category: "Category") -> set[int]:
    """Return the complete branch, including its root."""
    ids = {category.pk}
    pending = [category.pk]
    while pending:
        children = list(
            Category.objects.filter(parent_id__in=pending).values_list("pk", flat=True)
        )
        pending = [child_id for child_id in children if child_id not in ids]
        ids.update(pending)
    return ids


class Category(models.Model):
    name = models.CharField("название", max_length=150)
    parent = models.ForeignKey(
        "self",
        verbose_name="родительская категория",
        blank=True,
        db_index=False,
        null=True,
        on_delete=models.SET_NULL,
        related_name="children",
    )

    class Meta:
        verbose_name = "категория"
        verbose_name_plural = "категории"
        ordering = ("name", "id")
        indexes = [
            models.Index(
                fields=("parent", "name", "id"),
                name="cat_parent_name_idx",
            )
        ]

    def clean(self) -> None:
        self.name = self.name.strip()
        if not self.name:
            raise ValidationError({"name": "Укажите название категории."})
        if self.parent_id is not None:
            self._validate_parent_chain()
        original = Category.objects.filter(pk=self.pk).first() if self.pk else None
        if original is not None and original.parent_id == self.parent_id:
            return
        incoming_ids: list[int] = []
        if self.parent_id is not None:
            parent = self.parent
            assert parent is not None
            incoming_ids = ancestor_ids(parent)
        incoming_names = {
            name.casefold()
            for name in Characteristic.objects.filter(
                category_id__in=incoming_ids
            ).values_list("name", flat=True)
        }
        branch_ids = descendant_ids(self) if self.pk else set()
        branch_names = {
            name.casefold()
            for name in Characteristic.objects.filter(
                category_id__in=branch_ids
            ).values_list("name", flat=True)
        }
        if incoming_names & branch_names:
            raise ValidationError(
                {"parent": "В новой ветке уже есть характеристика с таким названием."}
            )
        if original is not None:
            from catalog.models import ProductCharacteristicValue

            removed_ids = set(ancestor_ids(original)) - set(incoming_ids)
            if ProductCharacteristicValue.objects.filter(
                product__category_id__in=branch_ids,
                characteristic__category_id__in=removed_ids,
            ).exists():
                raise ValidationError(
                    {"parent": "Перенос оставит значения товаров вне их категории."}
                )

    def save(self, *args: Any, **kwargs: Any) -> None:
        self.full_clean()
        super().save(*args, **kwargs)

    def __str__(self) -> str:
        return self.name

    def _validate_parent_chain(self) -> None:
        ancestor = self.parent
        visited_ids: set[int] = set()
        while ancestor is not None:
            if ancestor.pk == self.pk or ancestor.pk in visited_ids:
                raise ValidationError(
                    {"parent": "Родительская категория создаёт цикл в дереве."}
                )
            visited_ids.add(ancestor.pk)
            ancestor = ancestor.parent

    def applicable_characteristics(self) -> models.QuerySet["Characteristic"]:
        """Definitions shared by products in this category and its descendants."""
        return Characteristic.objects.filter(category_id__in=ancestor_ids(self))

    def delete(self, *args: Any, **kwargs: Any) -> tuple[int, dict[str, int]]:
        with transaction.atomic():
            for characteristic in list(self.characteristics.all()):
                characteristic.delete()
            return super().delete(*args, **kwargs)


class Characteristic(models.Model):
    class Type(models.TextChoices):
        LIST = "LIST", "Список"
        NUMBER = "NUMBER", "Число"
        BOOLEAN = "BOOLEAN", "Да/нет"

    category = models.ForeignKey(
        Category,
        verbose_name="категория",
        db_index=False,
        on_delete=models.CASCADE,
        related_name="characteristics",
    )
    name = models.CharField("название", max_length=150)
    type = models.CharField("тип", max_length=10, choices=Type.choices)
    is_required = models.BooleanField("обязательная", default=False)
    unit = models.CharField("единица измерения", max_length=32, blank=True)
    display_order = models.PositiveIntegerField("порядок отображения", default=0)

    class Meta:
        verbose_name = "характеристика"
        verbose_name_plural = "характеристики"
        ordering = ("display_order", "id")
        indexes = [
            models.Index(
                fields=("category", "display_order", "id"),
                name="char_category_order_idx",
            )
        ]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(type__in=("LIST", "NUMBER", "BOOLEAN")),
                name="char_valid_type",
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(type="NUMBER") & ~models.Q(unit="")
                    | ~models.Q(type="NUMBER") & models.Q(unit="")
                ),
                name="char_unit_matches_type",
            ),
        ]

    def clean(self) -> None:
        self.name = self.name.strip()
        self.unit = self.unit.strip()
        if not self.name:
            raise ValidationError({"name": "Укажите название характеристики."})
        if self.type == self.Type.NUMBER and not self.unit:
            raise ValidationError(
                {"unit": "Для числовой характеристики нужна единица измерения."}
            )
        if self.type != self.Type.NUMBER and self.unit:
            raise ValidationError(
                {
                    "unit": (
                        "Единица измерения допустима только для числовой "
                        "характеристики."
                    )
                }
            )
        if self.pk:
            original = Characteristic.objects.only("type", "category_id").get(
                pk=self.pk
            )
            if self.type != original.type:
                raise ValidationError({"type": "Тип характеристики менять нельзя."})
            if (
                self.category_id != original.category_id
                and self.product_values.exists()
            ):
                raise ValidationError(
                    {"category": "Нельзя переносить используемую характеристику."}
                )
        if self.category_id:
            branch = set(ancestor_ids(self.category)) | descendant_ids(self.category)
            siblings = Characteristic.objects.filter(category_id__in=branch)
            for characteristic in siblings.exclude(pk=self.pk).only("name"):
                if characteristic.name.casefold() == self.name.casefold():
                    raise ValidationError(
                        {"name": "Такая характеристика уже есть в этой ветке."}
                    )

    def save(self, *args: Any, **kwargs: Any) -> None:
        self.full_clean()
        super().save(*args, **kwargs)

    def __str__(self) -> str:
        return f"{self.category}: {self.name}"

    def delete(self, *args: Any, **kwargs: Any) -> tuple[int, dict[str, int]]:
        """Remove dependent product values before protected list options."""
        from catalog.models import ProductCharacteristicValue

        with transaction.atomic():
            ProductCharacteristicValue.objects.filter(characteristic=self).delete()
            return super().delete(*args, **kwargs)


class CharacteristicOption(models.Model):
    characteristic = models.ForeignKey(
        Characteristic,
        verbose_name="характеристика",
        db_index=False,
        on_delete=models.CASCADE,
        related_name="options",
    )
    value = models.CharField("значение", max_length=150)
    display_order = models.PositiveIntegerField("порядок отображения", default=0)

    class Meta:
        verbose_name = "вариант списочной характеристики"
        verbose_name_plural = "варианты списочных характеристик"
        ordering = ("display_order", "id")
        indexes = [
            models.Index(
                fields=("characteristic", "display_order", "id"),
                name="char_option_order_idx",
            )
        ]
        constraints = [
            models.UniqueConstraint(
                fields=("characteristic", "value"),
                name="char_option_unique_value",
            )
        ]

    def clean(self) -> None:
        self.value = self.value.strip()
        if not self.value:
            raise ValidationError({"value": "Укажите значение варианта."})
        if self.characteristic.type != Characteristic.Type.LIST:
            raise ValidationError(
                {
                    "characteristic": (
                        "Варианты значений допустимы только для типа LIST."
                    )
                }
            )

    def save(self, *args: Any, **kwargs: Any) -> None:
        self.full_clean()
        super().save(*args, **kwargs)

    def __str__(self) -> str:
        return self.value
