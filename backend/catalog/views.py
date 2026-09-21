"""Public catalog and manager profile API views."""

from decimal import Decimal, InvalidOperation
import re

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import connection, transaction
from django.db.models import Count, IntegerField, Prefetch, Q, QuerySet, Value
from django.http import QueryDict
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.utils import extend_schema, OpenApiParameter
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.generics import ListAPIView, RetrieveAPIView
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from catalog.models import Product, ProductCharacteristicValue, ProductPhoto
from catalog.pagination import CatalogPagination
from catalog.serializers import (
    CharacteristicValueInputSerializer,
    ManagerProfileSerializer,
    ProductCharacteristicValueSerializer,
    ProductCharacteristicValuesInputSerializer,
    ProductDetailSerializer,
    ProductSummarySerializer,
)
from categories.models import (
    Category,
    Characteristic,
    CharacteristicOption,
    descendant_ids,
)
from users.models import User

CATALOG_ORDER_FIELDS = {
    "newest": ("-created_at", "-id"),
    "oldest": ("created_at", "id"),
    "rate_asc": ("minute_rate", "id"),
    "rate_desc": ("-minute_rate", "id"),
}


def public_product_queryset() -> QuerySet[Product]:
    """Build the optimized queryset shared by public product endpoints."""
    photos = ProductPhoto.objects.order_by("display_order", "id")
    return (
        Product.objects.select_related("category", "manager", "pickup_point")
        .annotate(
            total_instances_count=Count(
                "instances",
                filter=Q(instances__is_deleted=False),
                distinct=True,
            ),
            available_instances_count=Count(
                "instances",
                filter=Q(
                    instances__status="AVAILABLE",
                    instances__is_deleted=False,
                ),
                distinct=True,
            ),
        )
        .prefetch_related(Prefetch("photos", queryset=photos, to_attr="catalog_photos"))
        .order_by("id")
    )


def parse_decimal_parameter(params: QueryDict, key: str) -> Decimal | None:
    value = params.get(key)
    if value is None:
        return None
    try:
        number = Decimal(value)
    except InvalidOperation as exc:
        raise ValidationError({key: "Укажите число."}) from exc
    if not number.is_finite():
        raise ValidationError({key: "Укажите конечное число."})
    return number


def validate_range(
    minimum: Decimal | None,
    maximum: Decimal | None,
    error_key: str,
) -> None:
    if minimum is not None and maximum is not None and minimum > maximum:
        raise ValidationError({error_key: "Значение «от» не может быть больше «до»."})


def apply_price_filter(
    queryset: QuerySet[Product], params: QueryDict
) -> QuerySet[Product]:
    minimum = parse_decimal_parameter(params, "price_min")
    maximum = parse_decimal_parameter(params, "price_max")
    validate_range(minimum, maximum, "price")
    if minimum is not None:
        queryset = queryset.filter(minute_rate__gte=minimum)
    if maximum is not None:
        queryset = queryset.filter(minute_rate__lte=maximum)
    return queryset


def parse_characteristic_filter_key(key: str) -> tuple[int, str]:
    parts = key.split("_")
    if len(parts) not in (2, 3) or not parts[1].isdigit():
        raise ValidationError({key: "Неверный фильтр характеристики."})
    return int(parts[1]), parts[2] if len(parts) == 3 else ""


def filter_by_list_characteristic(
    queryset: QuerySet[Product],
    characteristic: Characteristic,
    key: str,
    value: str,
) -> QuerySet[Product]:
    try:
        option_ids = [int(item) for item in value.split(",")]
    except ValueError as exc:
        raise ValidationError({key: "Укажите ID вариантов."}) from exc
    valid_ids = set(
        characteristic.options.filter(pk__in=option_ids).values_list("pk", flat=True)
    )
    if not option_ids or set(option_ids) != valid_ids:
        raise ValidationError({key: "Недопустимый вариант."})
    matches = ProductCharacteristicValue.objects.filter(
        characteristic=characteristic,
        option_id__in=option_ids,
    )
    return queryset.filter(pk__in=matches.values("product_id"))


def filter_by_boolean_characteristic(
    queryset: QuerySet[Product],
    characteristic: Characteristic,
    key: str,
    value: str,
) -> QuerySet[Product]:
    if value.lower() not in ("true", "false"):
        raise ValidationError({key: "Укажите true или false."})
    matches = ProductCharacteristicValue.objects.filter(
        characteristic=characteristic,
        boolean_value=value.lower() == "true",
    )
    return queryset.filter(pk__in=matches.values("product_id"))


def filter_by_number_characteristic(
    queryset: QuerySet[Product],
    characteristic: Characteristic,
    key: str,
    suffix: str,
    params: QueryDict,
) -> QuerySet[Product]:
    minimum_key = f"characteristic_{characteristic.pk}_min"
    maximum_key = f"characteristic_{characteristic.pk}_max"
    minimum = parse_decimal_parameter(params, minimum_key)
    maximum = parse_decimal_parameter(params, maximum_key)
    validate_range(minimum, maximum, f"characteristic_{characteristic.pk}")
    threshold = minimum if suffix == "min" else maximum
    if threshold is None:
        raise ValidationError({key: "Укажите число."})
    lookup = "number_value__gte" if suffix == "min" else "number_value__lte"
    matches = ProductCharacteristicValue.objects.filter(
        characteristic=characteristic,
        **{lookup: threshold},
    )
    return queryset.filter(pk__in=matches.values("product_id"))


def apply_characteristic_filter(
    queryset: QuerySet[Product],
    characteristic: Characteristic,
    key: str,
    suffix: str,
    params: QueryDict,
) -> QuerySet[Product]:
    value = params.get(key)
    if not isinstance(value, str):
        raise ValidationError({key: "Укажите значение фильтра."})
    if characteristic.type == Characteristic.Type.LIST and not suffix:
        return filter_by_list_characteristic(queryset, characteristic, key, value)
    if characteristic.type == Characteristic.Type.BOOLEAN and not suffix:
        return filter_by_boolean_characteristic(queryset, characteristic, key, value)
    if characteristic.type == Characteristic.Type.NUMBER and suffix in ("min", "max"):
        return filter_by_number_characteristic(
            queryset, characteristic, key, suffix, params
        )
    raise ValidationError({key: "Фильтр не соответствует типу."})


def get_selected_category(params: QueryDict) -> Category | None:
    category_value = params.get("category")
    if not category_value:
        return None
    try:
        return Category.objects.get(pk=int(category_value))
    except (ValueError, Category.DoesNotExist) as exc:
        raise ValidationError({"category": "Категория не найдена."}) from exc


def apply_category_filters(
    queryset: QuerySet[Product], params: QueryDict
) -> QuerySet[Product]:
    filter_names = [key for key in params if key.startswith("characteristic_")]
    category = get_selected_category(params)
    if filter_names and category is None:
        raise ValidationError({"category": "Укажите категорию для фильтрации."})
    if category is None:
        return queryset
    queryset = queryset.filter(category_id__in=descendant_ids(category))
    applicable = {item.pk: item for item in category.applicable_characteristics()}
    for key in filter_names:
        characteristic_id, suffix = parse_characteristic_filter_key(key)
        characteristic = applicable.get(characteristic_id)
        if characteristic is None:
            raise ValidationError({key: "Характеристика не доступна."})
        queryset = apply_characteristic_filter(
            queryset, characteristic, key, suffix, params
        )
    return queryset


def filter_and_order_catalog(
    queryset: QuerySet[Product], params: QueryDict
) -> QuerySet[Product]:
    search = params.get("search", "").strip()
    if search:
        if connection.vendor == "sqlite":
            escaped_search = re.escape(search)
            queryset = queryset.filter(
                Q(name__iregex=escaped_search) | Q(description__iregex=escaped_search)
            )
        else:
            queryset = queryset.filter(
                Q(name__icontains=search) | Q(description__icontains=search)
            )
    queryset = apply_price_filter(queryset, params)
    queryset = apply_category_filters(queryset, params)
    ordering = params.get("ordering", "newest")
    if ordering not in CATALOG_ORDER_FIELDS:
        raise ValidationError({"ordering": "Неверный порядок сортировки."})
    return queryset.order_by(*CATALOG_ORDER_FIELDS[ordering])


@extend_schema(
    parameters=[
        OpenApiParameter("category", int, description="Категория и все её потомки"),
        OpenApiParameter("search", str, description="Поиск по названию и описанию"),
        OpenApiParameter("price_min", float, description="Минимальная минутная ставка"),
        OpenApiParameter(
            "price_max", float, description="Максимальная минутная ставка"
        ),
        OpenApiParameter(
            "ordering", str, description="newest, oldest, rate_asc или rate_desc"
        ),
    ],
    description=(
        "Фильтры характеристики требуют category. Для LIST используйте "
        "characteristic_<id>=<option_id>[,<option_id>], для BOOLEAN — "
        "characteristic_<id>=true|false, для NUMBER — "
        "characteristic_<id>_min и characteristic_<id>_max."
    ),
)
class ProductListView(ListAPIView):
    """Return published products with branch-wide characteristic filters."""

    permission_classes = [AllowAny]
    pagination_class = CatalogPagination
    serializer_class = ProductSummarySerializer

    def get_queryset(self) -> QuerySet[Product]:
        queryset = public_product_queryset().filter(status=Product.Status.PUBLISHED)
        return filter_and_order_catalog(queryset, self.request.query_params)


class ProductDetailView(RetrieveAPIView):
    """Return a published or publicly archived product card."""

    permission_classes = [AllowAny]
    serializer_class = ProductDetailSerializer

    def get_queryset(self) -> QuerySet[Product]:
        values = ProductCharacteristicValue.objects.order_by("characteristic_id")
        queryset = (
            public_product_queryset()
            .filter(status__in=(Product.Status.PUBLISHED, Product.Status.FROZEN))
            .prefetch_related(
                Prefetch(
                    "characteristic_values",
                    queryset=values,
                    to_attr="catalog_characteristics",
                )
            )
        )
        user = self.request.user
        if user.is_authenticated and user.role == User.Role.RENTER:
            return queryset.annotate(
                current_user_pending_applications_count=Count(
                    "rental_applications",
                    filter=Q(
                        rental_applications__renter=user,
                        rental_applications__status="WAITING",
                        rental_applications__pickup_deadline_at__gt=timezone.now(),
                    ),
                    distinct=True,
                )
            )
        return queryset.annotate(
            current_user_pending_applications_count=Value(
                0, output_field=IntegerField()
            )
        )


class ProductCharacteristicValuesView(APIView):
    """Read or replace a manager's product characteristic values."""

    permission_classes = [IsAuthenticated]

    def get_product(self, pk: int) -> Product:
        product = get_object_or_404(Product, pk=pk)
        if product.manager_id != self.request.user.pk:
            raise PermissionDenied("Товар принадлежит другому менеджеру.")
        return product

    @extend_schema(responses=ProductCharacteristicValueSerializer(many=True))
    def get(self, request: Request, pk: int) -> Response:
        product = self.get_product(pk)
        values = product.characteristic_values.order_by("characteristic_id")
        return Response(ProductCharacteristicValueSerializer(values, many=True).data)

    @extend_schema(
        request=ProductCharacteristicValuesInputSerializer,
        responses=ProductCharacteristicValueSerializer(many=True),
    )
    def put(self, request: Request, pk: int) -> Response:
        product = self.get_product(pk)
        if product.status not in (
            Product.Status.DRAFT,
            Product.Status.PUBLISHED,
            Product.Status.REJECTED,
        ):
            raise ValidationError({"status": "Товар в этом статусе нельзя изменять."})
        values_data = request.data.get("values")
        if not isinstance(values_data, list):
            raise ValidationError({"values": "Укажите список значений."})
        value_serializer = CharacteristicValueInputSerializer(
            data=values_data, many=True
        )
        value_serializer.is_valid(raise_exception=True)
        applicable = {
            item.pk: item for item in product.category.applicable_characteristics()
        }
        values: list[ProductCharacteristicValue] = []
        seen: set[int] = set()
        for item in value_serializer.validated_data:
            characteristic_id = item["characteristic_id"]
            if characteristic_id in seen:
                raise ValidationError({"values": "Характеристика повторяется."})
            seen.add(characteristic_id)
            characteristic = applicable.get(characteristic_id)
            if characteristic is None:
                raise ValidationError({"values": "Характеристика не применима."})
            value = ProductCharacteristicValue(
                product=product,
                characteristic=characteristic,
                option_id=item.get("option_id"),
                number_value=item.get("number_value"),
                boolean_value=item.get("boolean_value"),
            )
            try:
                value.clean()
            except (DjangoValidationError, CharacteristicOption.DoesNotExist) as exc:
                raise ValidationError({"values": str(exc)}) from exc
            values.append(value)
        required = {item.pk for item in applicable.values() if item.is_required}
        if required - seen:
            raise ValidationError({"values": "Заполните обязательные характеристики."})
        with transaction.atomic():
            Product.objects.select_for_update().get(pk=pk)
            product.characteristic_values.all().delete()
            for value in values:
                value.save()
        return Response(ProductCharacteristicValueSerializer(values, many=True).data)


class ManagerProfileView(RetrieveAPIView):
    """Return public manager identity and product section counts."""

    authentication_classes: list[type] = []
    permission_classes = [AllowAny]
    serializer_class = ManagerProfileSerializer

    def get_queryset(self) -> QuerySet[User]:
        return User.objects.filter(
            role=User.Role.MANAGER,
            is_active=True,
        ).annotate(
            active_products_count=Count(
                "products",
                filter=Q(products__status=Product.Status.PUBLISHED),
                distinct=True,
            ),
            frozen_products_count=Count(
                "products",
                filter=Q(products__status=Product.Status.FROZEN),
                distinct=True,
            ),
        )


class ManagerProductListView(ListAPIView):
    """Return one public section of a manager's catalog."""

    permission_classes = [AllowAny]
    pagination_class = CatalogPagination
    serializer_class = ProductSummarySerializer
    product_status: str

    def get_queryset(self) -> QuerySet[Product]:
        return public_product_queryset().filter(
            manager_id=self.kwargs["pk"],
            manager__role=User.Role.MANAGER,
            manager__is_active=True,
            status=self.product_status,
        )


class ManagerActiveProductListView(ManagerProductListView):
    product_status = Product.Status.PUBLISHED


class ManagerFrozenProductListView(ManagerProductListView):
    product_status = Product.Status.FROZEN
