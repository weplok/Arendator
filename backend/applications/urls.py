"""Versioned API routes for rental applications."""

from applications.views import (
    ManagerApplicationBookView,
    ManagerApplicationCancelView,
    ManagerApplicationDetailView,
    ManagerApplicationListView,
    ManagerBookingArrivalView,
    ManagerBookingCancelView,
    ManagerBookingDetailView,
    ManagerBookingListView,
    ManagerQueuePreferenceView,
    ProductApplicationCreateView,
    RenterApplicationCancelView,
    RenterApplicationDetailView,
    RenterApplicationListView,
    RenterBookingCancelView,
    RenterBookingDetailView,
    RenterBookingListView,
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
        "manager/applications/<int:pk>/book/",
        ManagerApplicationBookView.as_view(),
        name="manager-book",
    ),
    path(
        "manager/application-preferences/",
        ManagerQueuePreferenceView.as_view(),
        name="manager-preferences",
    ),
    path("bookings/", RenterBookingListView.as_view(), name="renter-booking-list"),
    path(
        "bookings/<int:pk>/",
        RenterBookingDetailView.as_view(),
        name="renter-booking-detail",
    ),
    path(
        "bookings/<int:pk>/cancel/",
        RenterBookingCancelView.as_view(),
        name="renter-booking-cancel",
    ),
    path(
        "manager/bookings/",
        ManagerBookingListView.as_view(),
        name="manager-booking-list",
    ),
    path(
        "manager/bookings/<int:pk>/",
        ManagerBookingDetailView.as_view(),
        name="manager-booking-detail",
    ),
    path(
        "manager/bookings/<int:pk>/cancel/",
        ManagerBookingCancelView.as_view(),
        name="manager-booking-cancel",
    ),
    path(
        "manager/bookings/<int:pk>/arrival/",
        ManagerBookingArrivalView.as_view(),
        name="manager-booking-arrival",
    ),
]
