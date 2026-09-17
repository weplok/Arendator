"""Product catalog, pickup point, photo, and physical instance models."""

from decimal import Decimal
from pathlib import Path
from typing import Any
import uuid

from django.core.exceptions import ValidationError
from django.core.validators import (
    FileExtensionValidator,
    MaxValueValidator,
    MinValueValidator,
)
from django.db import models, transaction
from django.db.models import Max
from django.utils import timezone
from PIL import Image, UnidentifiedImageError

from categories.models import (
    ancestor_ids,
    Category,
    Characteristic,
    CharacteristicOption,
)
from users.models import User

MAX_PHOTO_SIZE = 15 * 1024 * 1024
ALLOWED_IMAGE_FORMATS = {"JPEG", "PNG"}


def product_photo_upload_to(instance: "ProductPhoto", filename: str) -> str:
    """Generate a storage name independent from the uploaded client filename."""
    extension = Path(filename).suffix.lower()
    return f"products/{instance.product_id}/{uuid.uuid4().hex}{extension}"


def validate_product_photo(image: Any) -> None:
    """Validate product photos according to the public image contract."""
    if image.size > MAX_PHOTO_SIZE:
        raise ValidationError("Размер изображения не должен превышать 15 МБ.")

    original_position = image.tell() if hasattr(image, "tell") else None
    try:
        if hasattr(image, "seek"):
            image.seek(0)
        with Image.open(image) as detected_image:
            detected_format = detected_image.format
            detected_image.verify()
    except (OSError, SyntaxError, UnidentifiedImageError) as exc:
        raise ValidationError("Файл не является корректным изображением.") from exc
    finally:
        if original_position is not None and hasattr(image, "seek"):
            image.seek(original_position)

    if detected_format not in ALLOWED_IMAGE_FORMATS:
        raise ValidationError("Поддерживаются только изображения JPEG и PNG.")

    image_extension = Path(image.name).suffix.lower()
    extensions_by_format = {
        "JPEG": {".jpg", ".jpeg"},
        "PNG": {".png"},
    }
    if image_extension not in extensions_by_format[detected_format]:
        raise ValidationError("Расширение файла не соответствует его содержимому.")

    source_file = getattr(image, "file", image)
    content_type = getattr(source_file, "content_type", None)
    allowed_content_types = {
        "JPEG": {"image/jpeg"},
        "PNG": {"image/png"},
    }
    if content_type and content_type not in allowed_content_types[detected_format]:
        raise ValidationError("MIME-тип файла не соответствует его содержимому.")


class PickupPoint(models.Model):
    manager = models.ForeignKey(
        User,
        verbose_name="менеджер",
        on_delete=models.PROTECT,
        related_name="pickup_points",
    )
    latitude = models.DecimalField(
        "широта",
        max_digits=9,
        decimal_places=6,
        validators=[
            MinValueValidator(Decimal("-90")),
            MaxValueValidator(Decimal("90")),
        ],
    )
    longitude = models.DecimalField(
        "долгота",
        max_digits=9,
        decimal_places=6,
        validators=[
            MinValueValidator(Decimal("-180")),
            MaxValueValidator(Decimal("180")),
        ],
    )
    city = models.CharField("город", max_length=150)
    district = models.CharField("район", max_length=150)
    full_address = models.CharField("полный адрес", max_length=300)

    class Meta:
        verbose_name = "точка самовывоза"
        verbose_name_plural = "точки самовывоза"
        indexes = [
            models.Index(fields=("manager", "city"), name="pickup_manager_city_idx")
        ]

    def clean(self) -> None:
        self.city = self.city.strip()
        self.district = self.district.strip()
        self.full_address = self.full_address.strip()
        errors: dict[str, str] = {}
        if not self.city:
            errors["city"] = "Укажите город."
        if not self.district:
            errors["district"] = "Укажите район."
        if not self.full_address:
            errors["full_address"] = "Укажите полный адрес."
        if self.manager_id and self.manager.role != User.Role.MANAGER:
            errors["manager"] = "Точка самовывоза должна принадлежать менеджеру."
        if self.pk:
            original = self.__class__.objects.get(pk=self.pk)
            location_changed = any(
                getattr(self, field) != getattr(original, field)
                for field in (
                    "latitude",
                    "longitude",
                    "city",
                    "district",
                    "full_address",
                )
            )
            if (
                location_changed
                and original.products.filter(published_at__isnull=False).exists()
            ):
                errors["full_address"] = (
                    "Точку самовывоза нельзя менять после публикации товара."
                )
        if errors:
            raise ValidationError(errors)

    def save(self, *args: Any, **kwargs: Any) -> None:
        self.full_clean()
        super().save(*args, **kwargs)

    def __str__(self) -> str:
        return f"{self.city}, {self.district}: {self.full_address}"


class Product(models.Model):
    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Черновик"
        ON_MODERATION = "ON_MODERATION", "На модерации"
        PUBLISHED = "PUBLISHED", "Опубликован"
        REJECTED = "REJECTED", "Отклонён"
        FROZEN = "FROZEN", "Заморожен"
        HIDDEN_BY_ADMIN = "HIDDEN_BY_ADMIN", "Скрыт администратором"

    ALLOWED_STATUS_TRANSITIONS: dict[str, set[str]] = {
        Status.DRAFT: {Status.ON_MODERATION},
        Status.ON_MODERATION: {Status.PUBLISHED, Status.REJECTED},
        Status.REJECTED: {Status.DRAFT},
        Status.PUBLISHED: {Status.FROZEN, Status.HIDDEN_BY_ADMIN},
        Status.FROZEN: set(),
        Status.HIDDEN_BY_ADMIN: set(),
    }

    manager = models.ForeignKey(
        User,
        verbose_name="менеджер",
        on_delete=models.PROTECT,
        related_name="products",
    )
    category = models.ForeignKey(
        Category,
        verbose_name="категория",
        on_delete=models.PROTECT,
        related_name="products",
    )
    pickup_point = models.ForeignKey(
        PickupPoint,
        verbose_name="точка самовывоза",
        on_delete=models.PROTECT,
        related_name="products",
    )
    catalog_number = models.PositiveIntegerField(
        "номер в каталоге менеджера",
        editable=False,
    )
    name = models.CharField("название", max_length=200)
    description = models.TextField("описание")
    minute_rate = models.DecimalField(
        "минутная ставка",
        max_digits=12,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0.01"))],
    )
    status = models.CharField(
        "статус",
        max_length=20,
        choices=Status.choices,
        default=Status.DRAFT,
    )
    rejection_reason = models.TextField("причина отклонения", blank=True)
    created_at = models.DateTimeField("дата создания", auto_now_add=True)
    published_at = models.DateTimeField("дата первой публикации", null=True, blank=True)

    class Meta:
        verbose_name = "товар"
        verbose_name_plural = "товары"
        constraints = [
            models.UniqueConstraint(
                fields=("manager", "catalog_number"),
                name="product_manager_catalog_number_unique",
            ),
            models.CheckConstraint(
                condition=models.Q(
                    status__in=(
                        "DRAFT",
                        "ON_MODERATION",
                        "PUBLISHED",
                        "REJECTED",
                        "FROZEN",
                        "HIDDEN_BY_ADMIN",
                    )
                ),
                name="product_valid_status",
            ),
            models.CheckConstraint(
                condition=models.Q(minute_rate__gt=0),
                name="product_positive_minute_rate",
            ),
        ]
        indexes = [
            models.Index(fields=("status", "id"), name="product_status_id_idx"),
            models.Index(
                fields=("manager", "status", "id"),
                name="product_manager_status_idx",
            ),
            models.Index(
                fields=("category", "status"), name="product_category_status_idx"
            ),
        ]

    def clean(self) -> None:
        self.name = self.name.strip()
        self.description = self.description.strip()
        self.rejection_reason = self.rejection_reason.strip()
        errors: dict[str, str] = {}
        original_status: str | None = None
        if not self.name:
            errors["name"] = "Укажите название товара."
        if not self.description:
            errors["description"] = "Укажите описание товара."
        if self.manager_id and self.manager.role != User.Role.MANAGER:
            errors["manager"] = "Товар должен принадлежать менеджеру."
        if (
            self.manager_id
            and self.pickup_point_id
            and self.pickup_point.manager_id != self.manager_id
        ):
            errors["pickup_point"] = (
                "Точка самовывоза должна принадлежать владельцу товара."
            )
        if self.status == self.Status.REJECTED and not self.rejection_reason:
            errors["rejection_reason"] = "Для отклонённого товара укажите причину."
        if self.status != self.Status.REJECTED and self.rejection_reason:
            errors["rejection_reason"] = (
                "Причина отклонения допустима только для отклонённого товара."
            )
        if self.pk:
            original = self.__class__.objects.only(
                "status",
                "category_id",
                "pickup_point_id",
                "published_at",
            ).get(pk=self.pk)
            original_status = original.status
            if self.category_id != original.category_id:
                errors["category"] = "Категорию созданного товара менять нельзя."
            if (
                self.status != original_status
                and self.status
                not in self.ALLOWED_STATUS_TRANSITIONS.get(original_status, set())
            ):
                errors["status"] = (
                    f"Переход {original_status} -> {self.status} недопустим."
                )
            if (
                original.published_at is not None
                and self.pickup_point_id != original.pickup_point_id
            ):
                errors["pickup_point"] = (
                    "Точку самовывоза нельзя менять после публикации товара."
                )
            if self.published_at != original.published_at:
                errors["published_at"] = (
                    "Дату первой публикации нельзя изменять вручную."
                )
        elif self.status != self.Status.DRAFT:
            errors["status"] = "Новый товар должен создаваться как черновик."
        if (
            self.pk
            and self.status == self.Status.ON_MODERATION
            and original_status != self.Status.ON_MODERATION
        ):
            required_ids = set(
                self.category.applicable_characteristics()
                .filter(is_required=True)
                .values_list("id", flat=True)
            )
            supplied_ids = set(
                self.characteristic_values.filter(
                    characteristic_id__in=required_ids
                ).values_list("characteristic_id", flat=True)
            )
            if required_ids - supplied_ids:
                errors["characteristics"] = (
                    "Заполните все обязательные характеристики категории."
                )
        if self.pk and self.status == self.Status.PUBLISHED:
            if not self.instances.filter(is_deleted=False).exists():
                errors["status"] = "Для первой публикации нужен хотя бы один экземпляр."
            if not self.photos.exists():
                errors["status"] = "Для публикации нужна хотя бы одна фотография."
        if errors:
            raise ValidationError(errors)

    def save(self, *args: Any, **kwargs: Any) -> None:
        is_new = self.pk is None
        with transaction.atomic():
            if is_new and not self.catalog_number:
                User.objects.select_for_update().get(pk=self.manager_id)
                current_number = (
                    Product.objects.filter(manager_id=self.manager_id).aggregate(
                        maximum=Max("catalog_number")
                    )["maximum"]
                    or 0
                )
                self.catalog_number = current_number + 1
            self.full_clean()
            if self.status == self.Status.PUBLISHED and self.published_at is None:
                self.published_at = timezone.now()
            super().save(*args, **kwargs)

    def __str__(self) -> str:
        return self.name


class ProductCharacteristicValue(models.Model):
    """A typed value for one applicable characteristic of a product."""

    product = models.ForeignKey(
        Product,
        verbose_name="товар",
        on_delete=models.CASCADE,
        related_name="characteristic_values",
    )
    characteristic = models.ForeignKey(
        Characteristic,
        verbose_name="характеристика",
        on_delete=models.CASCADE,
        related_name="product_values",
    )
    option = models.ForeignKey(
        CharacteristicOption,
        verbose_name="вариант",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="product_values",
    )
    number_value = models.DecimalField(
        "числовое значение",
        max_digits=18,
        decimal_places=6,
        null=True,
        blank=True,
    )
    boolean_value = models.BooleanField(
        "логическое значение",
        null=True,
        blank=True,
    )

    class Meta:
        verbose_name = "значение характеристики товара"
        verbose_name_plural = "значения характеристик товаров"
        constraints = [
            models.UniqueConstraint(
                fields=("product", "characteristic"),
                name="product_one_characteristic_value",
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(
                        option__isnull=False,
                        number_value__isnull=True,
                        boolean_value__isnull=True,
                    )
                    | models.Q(
                        option__isnull=True,
                        number_value__isnull=False,
                        boolean_value__isnull=True,
                    )
                    | models.Q(
                        option__isnull=True,
                        number_value__isnull=True,
                        boolean_value__isnull=False,
                    )
                ),
                name="product_characteristic_one_typed_value",
            ),
        ]
        indexes = [
            models.Index(
                fields=("characteristic", "option", "product"),
                name="product_char_option_idx",
            ),
            models.Index(
                fields=("characteristic", "number_value", "product"),
                name="product_char_number_idx",
            ),
            models.Index(
                fields=("characteristic", "boolean_value", "product"),
                name="product_char_boolean_idx",
            ),
        ]

    def clean(self) -> None:
        errors: dict[str, str] = {}
        if (
            self.product_id
            and self.characteristic_id
            and self.characteristic.category_id
            not in ancestor_ids(self.product.category)
        ):
            errors["characteristic"] = (
                "Характеристика не применяется к категории товара."
            )
        if self.characteristic_id:
            expected_fields: dict[str, str] = {
                Characteristic.Type.LIST: "option",
                Characteristic.Type.NUMBER: "number_value",
                Characteristic.Type.BOOLEAN: "boolean_value",
            }
            expected = expected_fields.get(self.characteristic.type)
            for field in ("option", "number_value", "boolean_value"):
                present = getattr(self, f"{field}_id" if field == "option" else field)
                if (field == expected) != (present is not None):
                    errors[field] = "Значение не соответствует типу характеристики."
        if (
            self.option_id
            and self.characteristic_id
            and self.option is not None
            and self.option.characteristic_id != self.characteristic_id
        ):
            errors["option"] = "Вариант относится к другой характеристике."
        if errors:
            raise ValidationError(errors)

    def save(self, *args: Any, **kwargs: Any) -> None:
        self.full_clean()
        super().save(*args, **kwargs)


class ProductPhoto(models.Model):
    product = models.ForeignKey(
        Product,
        verbose_name="товар",
        on_delete=models.CASCADE,
        related_name="photos",
    )
    image = models.ImageField(
        "фотография",
        upload_to=product_photo_upload_to,
        validators=[
            FileExtensionValidator(allowed_extensions=("jpg", "jpeg", "png")),
            validate_product_photo,
        ],
    )
    display_order = models.PositiveIntegerField("порядок отображения", default=0)
    is_primary = models.BooleanField("основная фотография", default=False)

    class Meta:
        verbose_name = "фотография товара"
        verbose_name_plural = "фотографии товаров"
        ordering = ("display_order", "id")
        constraints = [
            models.UniqueConstraint(
                fields=("product",),
                condition=models.Q(is_primary=True),
                name="product_one_primary_photo",
            )
        ]
        indexes = [
            models.Index(
                fields=("product", "display_order", "id"),
                name="photo_product_order_idx",
            )
        ]

    def save(self, *args: Any, **kwargs: Any) -> None:
        self.full_clean()
        super().save(*args, **kwargs)

    def __str__(self) -> str:
        return f"{self.product}: фото {self.pk or 'новое'}"


class ProductInstance(models.Model):
    class Status(models.TextChoices):
        AVAILABLE = "AVAILABLE", "Свободен"
        RESERVED = "RESERVED", "Забронирован"
        PICKUP_IN_PROGRESS = "PICKUP_IN_PROGRESS", "Оформляется выдача"
        RENTED = "RENTED", "В аренде"
        RETURN_INSPECTION = "RETURN_INSPECTION", "Оформляется возврат"
        MAINTENANCE = "MAINTENANCE", "На обслуживании"
        DELETED = "DELETED", "Удалён"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    product = models.ForeignKey(
        Product,
        verbose_name="товар",
        on_delete=models.PROTECT,
        related_name="instances",
        help_text="Менеджер экземпляра определяется по владельцу товара.",
    )
    manager = models.ForeignKey(
        User,
        verbose_name="менеджер",
        on_delete=models.PROTECT,
        related_name="product_instances",
        editable=False,
    )
    instance_number = models.PositiveIntegerField(
        "номер экземпляра в товаре",
        editable=False,
    )
    inventory_number = models.CharField(
        "инвентарный номер",
        max_length=100,
        blank=True,
        help_text="Введите номер вручную или запросите генерацию в формате N-M.",
    )
    status = models.CharField(
        "операционный статус",
        max_length=24,
        choices=Status.choices,
        default=Status.AVAILABLE,
    )
    created_at = models.DateTimeField("дата создания", auto_now_add=True)
    is_deleted = models.BooleanField("мягко удалён", default=False)

    class Meta:
        verbose_name = "экземпляр товара"
        verbose_name_plural = "экземпляры товаров"
        constraints = [
            models.UniqueConstraint(
                fields=("product", "instance_number"),
                name="instance_product_number_unique",
            ),
            models.UniqueConstraint(
                fields=("manager", "inventory_number"),
                name="instance_manager_inventory_unique",
            ),
            models.CheckConstraint(
                condition=models.Q(
                    status__in=(
                        "AVAILABLE",
                        "RESERVED",
                        "PICKUP_IN_PROGRESS",
                        "RENTED",
                        "RETURN_INSPECTION",
                        "MAINTENANCE",
                        "DELETED",
                    )
                ),
                name="instance_valid_status",
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(status="DELETED", is_deleted=True)
                    | ~models.Q(status="DELETED") & models.Q(is_deleted=False)
                ),
                name="instance_deleted_state_consistent",
            ),
        ]
        indexes = [
            models.Index(
                fields=("product", "status", "is_deleted"),
                name="instance_product_status_idx",
            )
        ]

    def clean(self) -> None:
        self.inventory_number = self.inventory_number.strip()
        errors: dict[str, str] = {}
        if (
            self.product_id
            and self.manager_id is not None
            and self.manager_id != self.product.manager_id
        ):
            errors["manager"] = "Экземпляр должен принадлежать владельцу товара."
        if self.status == self.Status.DELETED and not self.is_deleted:
            errors["is_deleted"] = "Удалённый экземпляр должен иметь признак удаления."
        if self.status != self.Status.DELETED and self.is_deleted:
            errors["status"] = "Мягко удалённый экземпляр должен иметь статус DELETED."
        if errors:
            raise ValidationError(errors)

    def save(self, *args: Any, **kwargs: Any) -> None:
        is_new = self._state.adding
        with transaction.atomic():
            if is_new:
                product = Product.objects.select_for_update().get(pk=self.product_id)
                self.manager_id = product.manager_id
                if not self.instance_number:
                    current_number = (
                        ProductInstance.objects.filter(
                            product_id=self.product_id
                        ).aggregate(maximum=Max("instance_number"))["maximum"]
                        or 0
                    )
                    self.instance_number = current_number + 1
                if not self.inventory_number:
                    self.inventory_number = (
                        f"{product.catalog_number}-{self.instance_number}"
                    )
            self.full_clean()
            super().save(*args, **kwargs)

    def __str__(self) -> str:
        return self.inventory_number
