"""Read-only public catalog and manager profile API views."""

from django.db.models import Count, Prefetch, Q, QuerySet
from rest_framework.generics import ListAPIView, RetrieveAPIView
from rest_framework.permissions import AllowAny

from catalog.models import Product, ProductPhoto
from catalog.pagination import CatalogPagination
from catalog.serializers import (
    ManagerProfileSerializer,
    ProductDetailSerializer,
    ProductSummarySerializer,
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


class ProductListView(ListAPIView):
    """Return published products without search, filters, or user sorting."""

    permission_classes = [AllowAny]
    pagination_class = CatalogPagination
    serializer_class = ProductSummarySerializer

    def get_queryset(self) -> QuerySet[Product]:
        return public_product_queryset().filter(status=Product.Status.PUBLISHED)


class ProductDetailView(RetrieveAPIView):
    """Return a published or publicly archived product card."""

    permission_classes = [AllowAny]
    serializer_class = ProductDetailSerializer

    def get_queryset(self) -> QuerySet[Product]:
        return public_product_queryset().filter(
            status__in=(Product.Status.PUBLISHED, Product.Status.FROZEN)
        )


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
