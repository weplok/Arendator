"""Versioned API routes for rental applications."""

from applications.views import (
    ManagerApplicationCancelView,
    ManagerApplicationDetailView,
    ManagerApplicationListView,
    ManagerQueuePreferenceView,
    ProductApplicationCreateView,
    RenterApplicationCancelView,
    RenterApplicationDetailView,
    RenterApplicationListView,
)
from django.urls import path

app_name = "applications"

urlpatterns = [
    path(
        "products/<int:pk>/applications/",
        ProductApplicationCreateView.as_view(),
        name="product-application-create",
    ),
    path("applications/", RenterApplicationListView.as_view(), name="renter-list"),
    path(
        "applications/<int:pk>/",
        RenterApplicationDetailView.as_view(),
        name="renter-detail",
    ),
    path(
        "applications/<int:pk>/cancel/",
        RenterApplicationCancelView.as_view(),
        name="renter-cancel",
    ),
    path(
        "manager/applications/",
        ManagerApplicationListView.as_view(),
        name="manager-list",
    ),
    path(
        "manager/applications/<int:pk>/",
        ManagerApplicationDetailView.as_view(),
        name="manager-detail",
    ),
    path(
        "manager/applications/<int:pk>/cancel/",
        ManagerApplicationCancelView.as_view(),
        name="manager-cancel",
    ),
    path(
        "manager/application-preferences/",
        ManagerQueuePreferenceView.as_view(),
        name="manager-preferences",
    ),
]
