"""Category taxonomy and category-specific characteristic definitions."""

from typing import Any

from django.core.exceptions import ValidationError
from django.db import models


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
        if self.parent_id is None:
            return
        self._validate_parent_chain()

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

    def save(self, *args: Any, **kwargs: Any) -> None:
        self.full_clean()
        super().save(*args, **kwargs)

    def __str__(self) -> str:
        return f"{self.category}: {self.name}"


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
