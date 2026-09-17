"""Django admin configuration for categories and characteristics."""

from django import forms
from django.contrib import admin
from django.db.models import QuerySet
from django.forms.models import BaseInlineFormSet
from django.http import HttpRequest

from categories.models import (
    ancestor_ids,
    Category,
    Characteristic,
    CharacteristicOption,
)


class CharacteristicInlineFormSet(BaseInlineFormSet):
    def clean(self) -> None:
        super().clean()
        if any(self.errors):
            return
        names: set[str] = set()
        if self.instance.parent_id:
            parent = self.instance.parent
            assert parent is not None
            names = {
                name.casefold()
                for name in Characteristic.objects.filter(
                    category_id__in=ancestor_ids(parent)
                ).values_list("name", flat=True)
            }
        for form in self.forms:
            if not form.cleaned_data or form.cleaned_data.get("DELETE"):
                continue
            name = str(form.cleaned_data.get("name", "")).strip().casefold()
            if name in names:
                raise forms.ValidationError(
                    "Характеристика с таким названием уже есть в этой ветке."
                )
            names.add(name)


class CharacteristicInline(admin.TabularInline):
    model = Characteristic
    formset = CharacteristicInlineFormSet
    fields = ("name", "type", "is_required", "unit", "display_order")
    extra = 1
    show_change_link = True


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ("name", "parent")
    list_select_related = ("parent",)
    search_fields = ("name",)
    autocomplete_fields = ("parent",)
    inlines = (CharacteristicInline,)

    def delete_queryset(
        self, request: HttpRequest, queryset: QuerySet[Category]
    ) -> None:
        for category in queryset:
            category.delete()


class CharacteristicOptionInlineFormSet(BaseInlineFormSet):
    def clean(self) -> None:
        super().clean()
        if any(self.errors):
            return
        for form in self.forms:
            if (
                form.cleaned_data.get("DELETE")
                and form.instance.pk
                and form.instance.product_values.exists()
            ):
                raise forms.ValidationError(
                    "Нельзя удалить вариант, используемый товаром."
                )


class CharacteristicOptionInline(admin.TabularInline):
    model = CharacteristicOption
    formset = CharacteristicOptionInlineFormSet
    fields = ("value", "display_order")
    extra = 1


@admin.register(Characteristic)
class CharacteristicAdmin(admin.ModelAdmin):
    list_display = (
        "name",
        "category",
        "type",
        "is_required",
        "unit",
        "display_order",
    )
    list_filter = ("type", "is_required", "category")
    list_select_related = ("category",)
    search_fields = ("name", "category__name")
    autocomplete_fields = ("category",)
    inlines = (CharacteristicOptionInline,)

    def delete_queryset(
        self, request: HttpRequest, queryset: QuerySet[Characteristic]
    ) -> None:
        for characteristic in queryset:
            characteristic.delete()
