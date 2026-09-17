"""Public catalog and manager profile API views."""

from decimal import Decimal, InvalidOperation

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import Count, Prefetch, Q, QuerySet
from django.shortcuts import get_object_or_404
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


def public_product_queryset() -> QuerySet[Product]:
    """Build the optimized queryset shared by public product endpoints."""
    photos = ProductPhoto.objects.order_by("display_order", "id")
    return (
        Product.objects.select_related("category", "manager", "pickup_point")
        .annotate(
            available_instances_count=Count(
                "instances",
                filter=Q(
                    instances__status="AVAILABLE",
                    instances__is_deleted=False,
                ),
            )
        )
        .prefetch_related(Prefetch("photos", queryset=photos, to_attr="catalog_photos"))
        .order_by("id")
    )


@extend_schema(
    parameters=[
        OpenApiParameter("category", int, description="Категория и все её потомки"),
        OpenApiParameter("search", str, description="Поиск по названию"),
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
        params = self.request.query_params
        search = params.get("search", "").strip()
        if search:
            queryset = queryset.filter(name__icontains=search)
        category_value = params.get("category")
        filter_names = [key for key in params if key.startswith("characteristic_")]
        if filter_names and not category_value:
            raise ValidationError({"category": "Укажите категорию для фильтрации."})
        if category_value:
            try:
                category = Category.objects.get(pk=int(category_value))
            except (ValueError, Category.DoesNotExist) as exc:
                raise ValidationError({"category": "Категория не найдена."}) from exc
            queryset = queryset.filter(category_id__in=descendant_ids(category))
            applicable = {
                item.pk: item for item in category.applicable_characteristics()
            }
            for key in filter_names:
                parts = key.split("_")
                if len(parts) not in (2, 3) or not parts[1].isdigit():
                    raise ValidationError({key: "Неверный фильтр характеристики."})
                characteristic = applicable.get(int(parts[1]))
                if characteristic is None:
                    raise ValidationError({key: "Характеристика не доступна."})
                suffix = parts[2] if len(parts) == 3 else ""
                value = params[key]
                matches = ProductCharacteristicValue.objects.filter(
                    characteristic=characteristic
                )
                if characteristic.type == Characteristic.Type.LIST and not suffix:
                    try:
                        option_ids = [int(item) for item in value.split(",")]
                    except ValueError as exc:
                        raise ValidationError({key: "Укажите ID вариантов."}) from exc
                    valid_ids = set(
                        characteristic.options.filter(pk__in=option_ids).values_list(
                            "pk", flat=True
                        )
                    )
                    if not option_ids or set(option_ids) != valid_ids:
                        raise ValidationError({key: "Недопустимый вариант."})
                    matches = matches.filter(option_id__in=option_ids)
                elif characteristic.type == Characteristic.Type.BOOLEAN and not suffix:
                    if value.lower() not in ("true", "false"):
                        raise ValidationError({key: "Укажите true или false."})
                    matches = matches.filter(boolean_value=value.lower() == "true")
                elif characteristic.type == Characteristic.Type.NUMBER and suffix in (
                    "min",
                    "max",
                ):
                    try:
                        threshold = Decimal(value)
                    except InvalidOperation as exc:
                        raise ValidationError({key: "Укажите число."}) from exc
                    if not threshold.is_finite():
                        raise ValidationError({key: "Укажите конечное число."})
                    lookup = (
                        "number_value__gte" if suffix == "min" else "number_value__lte"
                    )
                    matches = matches.filter(**{lookup: threshold})
                else:
                    raise ValidationError({key: "Фильтр не соответствует типу."})
                queryset = queryset.filter(pk__in=matches.values("product_id"))
        ordering = params.get("ordering", "")
        order_fields = {
            "newest": ("-created_at", "-id"),
            "oldest": ("created_at", "id"),
            "rate_asc": ("minute_rate", "id"),
            "rate_desc": ("-minute_rate", "id"),
        }
        if ordering:
            if ordering not in order_fields:
                raise ValidationError({"ordering": "Неверный порядок сортировки."})
            queryset = queryset.order_by(*order_fields[ordering])
        return queryset


class ProductDetailView(RetrieveAPIView):
    """Return a published or publicly archived product card."""

    permission_classes = [AllowAny]
    serializer_class = ProductDetailSerializer

    def get_queryset(self) -> QuerySet[Product]:
        values = ProductCharacteristicValue.objects.order_by("characteristic_id")
        return (
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
