"""Public product catalog API routes."""

from django.urls import path

from catalog.manager_views import (
    ManagerFreezeView,
    ManagerInstancesView,
    ManagerInstanceView,
    ManagerPhotoOrderView,
    ManagerPhotosView,
    ManagerPhotoView,
    ManagerPickupView,
    ManagerProductsView,
    ManagerProductView,
    ManagerSubmitView,
)
from catalog.views import (
    ManagerActiveProductListView,
    ManagerFrozenProductListView,
    ManagerProfileView,
    ProductCharacteristicValuesView,
    ProductDetailView,
    ProductListView,
)

app_name = "catalog"

urlpatterns = [
    path("manager/products/", ManagerProductsView.as_view(), name="manager-products"),
    path(
        "manager/products/<int:pk>/",
        ManagerProductView.as_view(),
        name="manager-product",
    ),
    path(
        "manager/products/<int:pk>/pickup/",
        ManagerPickupView.as_view(),
        name="manager-pickup",
    ),
    path(
        "manager/products/<int:pk>/photos/",
        ManagerPhotosView.as_view(),
        name="manager-photos",
    ),
    path(
        "manager/products/<int:pk>/photos/order/",
        ManagerPhotoOrderView.as_view(),
        name="manager-photo-order",
    ),
    path(
        "manager/products/<int:pk>/photos/<int:photo_id>/",
        ManagerPhotoView.as_view(),
        name="manager-photo",
    ),
    path(
        "manager/products/<int:pk>/instances/",
        ManagerInstancesView.as_view(),
        name="manager-instances",
    ),
    path(
        "manager/products/<int:pk>/instances/<uuid:instance_id>/",
        ManagerInstanceView.as_view(),
        name="manager-instance",
    ),
    path(
        "manager/products/<int:pk>/submit/",
        ManagerSubmitView.as_view(),
        name="manager-submit",
    ),
    path(
        "manager/products/<int:pk>/freeze/",
        ManagerFreezeView.as_view(),
        name="manager-freeze",
    ),
    path("products/", ProductListView.as_view(), name="product-list"),
    path("products/<int:pk>/", ProductDetailView.as_view(), name="product-detail"),
    path(
        "products/<int:pk>/characteristics/",
        ProductCharacteristicValuesView.as_view(),
        name="product-characteristics",
    ),
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
