"""Notification REST routes."""

from django.urls import path
from notifications.views import (
    NotificationDeleteView,
    NotificationListView,
    NotificationReadAllView,
    NotificationReadView,
    NotificationSettingsView,
)

app_name = "notifications"

urlpatterns = [
    path("notifications/", NotificationListView.as_view(), name="list"),
    path(
        "notifications/<int:pk>/",
        NotificationDeleteView.as_view(),
        name="delete",
    ),
    path(
        "notifications/read-all/",
        NotificationReadAllView.as_view(),
        name="read-all",
    ),
    path("notifications/read/", NotificationReadView.as_view(), name="read"),
    path(
        "notifications/settings/",
        NotificationSettingsView.as_view(),
        name="settings",
    ),
]
