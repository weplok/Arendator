"""Analytics API routes."""

from analytics.views import ManagerAnalyticsView
from django.urls import path

app_name = "analytics"

urlpatterns = [
    path("manager/analytics/", ManagerAnalyticsView.as_view(), name="manager"),
]
