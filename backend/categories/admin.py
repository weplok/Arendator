"""Django admin configuration for categories and characteristics."""

import json
from typing import Any

from django import forms
from django.contrib import admin
from django.contrib.admin.widgets import RelatedFieldWidgetWrapper
from django.db.models import QuerySet
from django.forms.models import BaseInlineFormSet
from django.http import HttpRequest

from categories.models import (
    ancestor_ids,
    Category,
    Characteristic,
    CharacteristicOption,
    descendant_ids,
)


def inherited_characteristic_names(*, include_category: bool) -> str:
    names_by_category: dict[str, list[str]] = {}
    for category in Category.objects.all():
        category_ids = ancestor_ids(category)
        if not include_category:
            category_ids = category_ids[1:]
        names_by_category[str(category.pk)] = list(
            Characteristic.objects.filter(category_id__in=category_ids)
            .order_by("name")
            .values_list("name", flat=True)
        )
    return json.dumps(names_by_category, ensure_ascii=False)


def add_inherited_names_data(
    field: forms.Field,
    *,
    include_category: bool,
) -> None:
    widget = field.widget
    if isinstance(widget, RelatedFieldWidgetWrapper):
        widget = widget.widget
    widget.attrs["data-inherited-characteristic-names"] = (
        inherited_characteristic_names(include_category=include_category)
    )


class CategoryAdminForm(forms.ModelForm):
    class Meta:
        model = Category
        fields = "__all__"

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        parent_field = self.fields["parent"]
        add_inherited_names_data(parent_field, include_category=True)
        if not self.instance.pk:
            return
        if not isinstance(parent_field, forms.ModelChoiceField):
            return
        parent_queryset = parent_field.queryset
        if parent_queryset is None:
            return
        parent_field.queryset = parent_queryset.exclude(
            pk__in=descendant_ids(self.instance)
        )
        parent_field.help_text = (
            "Текущую категорию и её потомков нельзя выбирать родителем."
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
                form.add_error(
                    "name", "Характеристика с таким названием уже есть в этой ветке."
                )
            else:
                names.add(name)


class CharacteristicInline(admin.TabularInline):
    model = Characteristic
    formset = CharacteristicInlineFormSet
    fields = ("name", "type", "is_required", "unit", "display_order")
    extra = 1
    show_change_link = True


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    form = CategoryAdminForm
    list_display = ("name", "parent")
    list_select_related = ("parent",)
    search_fields = ("name",)
    inlines = (CharacteristicInline,)

    class Media:
        js = ("categories/admin_validation.js",)

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


class CharacteristicAdminForm(forms.ModelForm):
    class Meta:
        model = Characteristic
        fields = "__all__"

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        category_field = self.fields["category"]
        add_inherited_names_data(category_field, include_category=False)
        category_field.help_text = (
            "Название характеристики не должно повторять название из категории-предка."
        )


@admin.register(Characteristic)
class CharacteristicAdmin(admin.ModelAdmin):
    form = CharacteristicAdminForm
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

    class Media:
        js = ("categories/admin_validation.js",)

    def delete_queryset(
        self, request: HttpRequest, queryset: QuerySet[Characteristic]
    ) -> None:
        for characteristic in queryset:
            characteristic.delete()
