"""Public category API routes."""

from django.urls import path

from categories.views import CategoryListView

app_name = "categories"

urlpatterns = [
    path("", CategoryListView.as_view(), name="list"),
]
