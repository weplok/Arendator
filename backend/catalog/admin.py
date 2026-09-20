"""Django admin configuration for catalog and moderation workflows."""

from typing import Any, cast

from django import forms
from django.contrib import admin, messages
from django.core.exceptions import ValidationError
from django.db import models
from django.http import HttpRequest
from django.http.response import HttpResponse, HttpResponseRedirect
from django.template.response import TemplateResponse
from django.urls import path, reverse
from django.utils.html import format_html

from catalog.models import (
    ModerationDecision,
    ModerationSettings,
    PickupPoint,
    Product,
    ProductCharacteristicValue,
    ProductInstance,
    ProductPhoto,
)
from catalog.moderation import (
    approve_all_pending_products,
    approve_product,
    reject_product,
)
from users.models import User


class ProductAdminForm(forms.ModelForm):
    class ModerationAction(models.TextChoices):
        KEEP = "", "Без решения"
        APPROVE = "APPROVE", "Одобрить"
        REJECT = "REJECT", "Отклонить"

    moderation_action = forms.ChoiceField(
        label="Решение модерации",
        choices=ModerationAction.choices,
        required=False,
    )
    moderation_reason = forms.CharField(
        label="Причина отклонения",
        required=False,
        widget=forms.Textarea(attrs={"rows": 3}),
        help_text="Обязательна при отклонении и будет показана менеджеру.",
    )
    manager_moderation_label = forms.ChoiceField(
        label="Метка менеджера",
        choices=User.ModerationLabel.choices,
        required=False,
        help_text="Визуальная служебная метка, не влияющая на права.",
    )

    class Meta:
        model = Product
        fields = "__all__"

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        if self.instance.pk and self.instance.manager_id:
            self.fields["manager_moderation_label"].initial = (
                self.instance.manager.moderation_label
            )

    def clean(self) -> dict[str, Any]:
        cleaned_data = super().clean() or {}
        action = cleaned_data.get("moderation_action")
        if action and self.instance.status != Product.Status.ON_MODERATION:
            self.add_error(
                "moderation_action",
                "Решение доступно только для товара на модерации.",
            )
        if (
            action == self.ModerationAction.REJECT
            and not cleaned_data.get("moderation_reason", "").strip()
        ):
            self.add_error("moderation_reason", "Укажите причину отклонения.")
        return cleaned_data

    def full_clean(self) -> None:
        self.instance._allow_admin_edit = True
        super().full_clean()


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


class PickupPointAdminForm(forms.ModelForm):
    class Meta:
        model = PickupPoint
        fields = "__all__"

    def full_clean(self) -> None:
        self.instance._allow_admin_edit = True
        super().full_clean()


class ProductPhotoInline(admin.TabularInline):
    model = ProductPhoto
    fields = ("photo_preview", "image", "display_order", "is_primary")
    readonly_fields = ("photo_preview",)
    extra = 0

    @admin.display(description="Превью")
    def photo_preview(self, obj: ProductPhoto) -> str:
        if not obj.pk or not obj.image:
            return "—"
        return format_html(
            '<img src="{}" alt="Фото товара" style="width: 160px; '
            'height: 120px; object-fit: cover; border-radius: 6px;">',
            obj.image.url,
        )


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


class ProductCharacteristicValueInline(admin.TabularInline):
    model = ProductCharacteristicValue
    fields = ("characteristic", "option", "number_value", "boolean_value")
    autocomplete_fields = ("characteristic",)
    extra = 0


@admin.register(PickupPoint)
class PickupPointAdmin(admin.ModelAdmin):
    form = PickupPointAdminForm
    list_display = ("city", "district", "full_address", "manager")
    list_select_related = ("manager",)
    search_fields = ("city", "district", "full_address", "manager__name")
    autocomplete_fields = ("manager",)

    def save_model(
        self,
        request: HttpRequest,
        obj: PickupPoint,
        form: PickupPointAdminForm,
        change: bool,
    ) -> None:
        obj._allow_admin_edit = True
        super().save_model(request, obj, form, change)


@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    form = ProductAdminForm
    change_form_template = "admin/catalog/product/change_form.html"
    change_list_template = "admin/catalog/product/change_list.html"
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
    readonly_fields = (
        "catalog_number",
        "status",
        "rejection_reason",
        "created_at",
        "published_at",
        "manager_approval_count",
        "manager_rejection_count",
    )
    fieldsets = (
        (
            "Карточка",
            {
                "fields": (
                    "manager",
                    "category",
                    "pickup_point",
                    "catalog_number",
                    "name",
                    "description",
                    "minute_rate",
                )
            },
        ),
        (
            "Модерация",
            {
                "fields": (
                    "status",
                    "rejection_reason",
                    "moderation_action",
                    "moderation_reason",
                    "manager_moderation_label",
                    "manager_approval_count",
                    "manager_rejection_count",
                )
            },
        ),
        ("Даты", {"fields": ("created_at", "published_at")}),
    )
    inlines = (
        ProductPhotoInline,
        ProductCharacteristicValueInline,
        ProductInstanceInline,
    )

    def get_urls(self) -> list[Any]:
        custom_urls = [
            path(
                "approve-all/",
                self.admin_site.admin_view(self.approve_all_view),
                name="catalog_product_approve_all",
            )
        ]
        return custom_urls + super().get_urls()

    def approve_all_view(self, request: HttpRequest) -> HttpResponse:
        if not self.has_change_permission(request):
            from django.core.exceptions import PermissionDenied

            raise PermissionDenied
        pending_count = Product.objects.filter(
            status=Product.Status.ON_MODERATION
        ).count()
        if request.method == "POST" and request.POST.get("confirm") == "yes":
            administrator = cast(User, request.user)
            approved_count = approve_all_pending_products(administrator)
            self.message_user(
                request,
                f"Одобрено заявок: {approved_count}.",
                level=messages.SUCCESS,
            )
            return HttpResponseRedirect(reverse("admin:catalog_product_changelist"))
        context = {
            **self.admin_site.each_context(request),
            "opts": self.model._meta,
            "pending_count": pending_count,
            "title": "Одобрить все заявки на модерацию",
        }
        return TemplateResponse(
            request,
            "admin/catalog/product/approve_all_confirmation.html",
            context,
        )

    def save_model(
        self,
        request: HttpRequest,
        obj: Product,
        form: ProductAdminForm,
        change: bool,
    ) -> None:
        obj._allow_admin_edit = True
        super().save_model(request, obj, form, change)
        manager_label = form.cleaned_data.get("manager_moderation_label", "")
        if obj.manager.moderation_label != manager_label:
            obj.manager.moderation_label = manager_label
            obj.manager.save(update_fields=("moderation_label",))
        action = form.cleaned_data.get("moderation_action")
        administrator = cast(User, request.user)
        try:
            if action == ProductAdminForm.ModerationAction.APPROVE:
                moderated_product = approve_product(obj.pk, administrator)
            elif action == ProductAdminForm.ModerationAction.REJECT:
                moderated_product = reject_product(
                    obj.pk,
                    form.cleaned_data["moderation_reason"],
                    administrator,
                )
            else:
                return
        except ValidationError as exc:
            raise forms.ValidationError(exc.messages) from exc
        obj.status = moderated_product.status
        obj.rejection_reason = moderated_product.rejection_reason
        obj.published_at = moderated_product.published_at

    @admin.display(description="Одобрений менеджера")
    def manager_approval_count(self, obj: Product) -> int:
        return obj.manager.moderation_decisions.filter(
            decision=ModerationDecision.Decision.APPROVED
        ).count()

    @admin.display(description="Отклонений менеджера")
    def manager_rejection_count(self, obj: Product) -> int:
        return obj.manager.moderation_decisions.filter(
            decision=ModerationDecision.Decision.REJECTED
        ).count()

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


@admin.register(ModerationSettings)
class ModerationSettingsAdmin(admin.ModelAdmin):
    fields = ("auto_approve_new_submissions",)

    def has_add_permission(self, request: HttpRequest) -> bool:
        return not ModerationSettings.objects.exists() and super().has_add_permission(
            request
        )

    def has_delete_permission(
        self,
        request: HttpRequest,
        obj: ModerationSettings | None = None,
    ) -> bool:
        return False


@admin.register(ModerationDecision)
class ModerationDecisionAdmin(admin.ModelAdmin):
    list_display = (
        "product_name",
        "manager",
        "decision",
        "decided_by",
        "is_automatic",
        "created_at",
    )
    list_filter = ("decision", "is_automatic", "created_at")
    search_fields = ("product_name", "manager__name", "manager__email", "reason")
    readonly_fields = (
        "product",
        "manager",
        "decided_by",
        "product_name",
        "decision",
        "reason",
        "is_automatic",
        "created_at",
    )

    def has_add_permission(self, request: HttpRequest) -> bool:
        return False

    def has_delete_permission(
        self,
        request: HttpRequest,
        obj: ModerationDecision | None = None,
    ) -> bool:
        return False
