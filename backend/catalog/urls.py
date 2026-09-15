"""Public product catalog API routes."""

from django.urls import path

from catalog.views import (
    ManagerActiveProductListView,
    ManagerFrozenProductListView,
    ManagerProfileView,
    ProductDetailView,
    ProductListView,
)

app_name = "catalog"

urlpatterns = [
    path("products/", ProductListView.as_view(), name="product-list"),
    path("products/<int:pk>/", ProductDetailView.as_view(), name="product-detail"),
    path("managers/<int:pk>/", ManagerProfileView.as_view(), name="manager-detail"),
    path(
        "managers/<int:pk>/products/active/",
        ManagerActiveProductListView.as_view(),
        name="manager-active-products",
    ),
    path(
        "managers/<int:pk>/products/frozen/",
        ManagerFrozenProductListView.as_view(),
        name="manager-frozen-products",
    ),
]
