"""Django admin configuration for catalog demo data."""

from typing import Any

from django import forms
from django.contrib import admin
from django.http import HttpRequest

from catalog.models import (
    PickupPoint,
    Product,
    ProductCharacteristicValue,
    ProductInstance,
    ProductPhoto,
)


class ProductInstanceAdminForm(forms.ModelForm):
    generate_inventory_number = forms.BooleanField(
        label="Сгенерировать инвентарный номер автоматически",
        required=False,
        help_text="Будет использован следующий свободный номер в формате N-M.",
    )

    class Meta:
        model = ProductInstance
        fields = "__all__"

    def clean(self) -> dict[str, Any]:
        cleaned_data = super().clean() or {}
        inventory_number = cleaned_data.get("inventory_number", "").strip()
        generate_number = cleaned_data.get("generate_inventory_number", False)
        if self.instance._state.adding and inventory_number and generate_number:
            self.add_error(
                "generate_inventory_number",
                "Выберите один способ: ручной номер или автоматическая генерация.",
            )
        if self.instance._state.adding and not inventory_number and not generate_number:
            self.add_error(
                "inventory_number",
                "Введите номер или запросите автоматическую генерацию.",
            )
        return cleaned_data


class ProductPhotoInline(admin.TabularInline):
    model = ProductPhoto
    fields = ("image", "display_order", "is_primary")
    extra = 1


class ProductInstanceInline(admin.TabularInline):
    model = ProductInstance
    form = ProductInstanceAdminForm
    fields = (
        "inventory_number",
        "generate_inventory_number",
        "status",
        "is_deleted",
    )
    can_delete = False
    extra = 1


@admin.register(PickupPoint)
class PickupPointAdmin(admin.ModelAdmin):
    list_display = ("city", "district", "full_address", "manager")
    list_select_related = ("manager",)
    search_fields = ("city", "district", "full_address", "manager__name")
    autocomplete_fields = ("manager",)


@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    list_display = (
        "name",
        "manager",
        "category",
        "minute_rate",
        "status",
        "catalog_number",
    )
    list_filter = ("status", "category")
    list_select_related = ("manager", "category", "pickup_point")
    search_fields = ("name", "description", "manager__name")
    autocomplete_fields = ("manager", "category", "pickup_point")
    readonly_fields = ("catalog_number", "created_at", "published_at")
    inlines = (ProductPhotoInline, ProductInstanceInline)

    def has_delete_permission(
        self,
        request: HttpRequest,
        obj: Product | None = None,
    ) -> bool:
        return False


@admin.register(ProductInstance)
class ProductInstanceAdmin(admin.ModelAdmin):
    form = ProductInstanceAdminForm
    list_display = ("inventory_number", "product", "status", "is_deleted")
    list_filter = ("status", "is_deleted")
    list_select_related = ("product", "manager")
    search_fields = ("inventory_number", "product__name", "manager__name")
    autocomplete_fields = ("product",)

    def get_readonly_fields(
        self,
        request: HttpRequest,
        obj: ProductInstance | None = None,
    ) -> tuple[str, ...]:
        if obj is None:
            return ()
        return ("product", "manager", "instance_number", "created_at")

    def has_delete_permission(
        self,
        request: HttpRequest,
        obj: ProductInstance | None = None,
    ) -> bool:
        return False


@admin.register(ProductCharacteristicValue)
class ProductCharacteristicValueAdmin(admin.ModelAdmin):
    list_display = (
        "product",
        "characteristic",
        "option",
        "number_value",
        "boolean_value",
    )
    list_select_related = ("product", "characteristic", "option")
    autocomplete_fields = ("product", "characteristic")
