"""Django admin configuration for categories and characteristics."""

from django.contrib import admin

from categories.models import Category, Characteristic, CharacteristicOption


class CharacteristicInline(admin.TabularInline):
    model = Characteristic
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


class CharacteristicOptionInline(admin.TabularInline):
    model = CharacteristicOption
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
