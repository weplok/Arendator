"""Django admin site extended with a cross-model analytics report."""

from decimal import Decimal
from typing import Any

from analytics.periods import parse_period
from analytics.services import build_admin_analytics
from django.contrib import messages
from django.contrib.admin import AdminSite
from django.core.exceptions import PermissionDenied
from django.http import HttpRequest, HttpResponse
from django.shortcuts import render
from django.urls import path, reverse, URLPattern, URLResolver
from django.utils import timezone
from rest_framework.exceptions import ValidationError


class AnalyticsAdminSite(AdminSite):
    site_header = "Администрирование Арендатора"
    site_title = "Администрирование Арендатора"
    index_title = "Площадка"

    def get_urls(self) -> list[URLPattern | URLResolver]:
        custom_urls = [
            path(
                "analytics/",
                self.admin_view(self.analytics_view),
                name="analytics",
            )
        ]
        return custom_urls + super().get_urls()

    def get_app_list(
        self,
        request: HttpRequest,
        app_label: str | None = None,
    ) -> list[dict[str, Any]]:
        app_list = super().get_app_list(request, app_label)
        if not request.user.is_superuser or app_label not in (None, "analytics"):
            return app_list
        analytics_url = reverse("admin:analytics")
        analytics_app = {
            "name": "Площадка",
            "app_label": "analytics",
            "app_url": analytics_url,
            "has_module_perms": True,
            "models": [
                {
                    "model": None,
                    "name": "Аналитика",
                    "object_name": "Analytics",
                    "perms": {"view": True},
                    "admin_url": analytics_url,
                    "add_url": None,
                    "view_only": True,
                }
            ],
        }
        return [analytics_app, *app_list]

    def analytics_view(self, request: HttpRequest) -> HttpResponse:
        if not request.user.is_superuser:
            raise PermissionDenied("Доступно только администратору.")
        now = timezone.now()
        try:
            period = parse_period(request.GET, now=now)
        except ValidationError:
            messages.error(request, "Проверьте выбранный период и даты.")
            period = parse_period({"period": "week"}, now=now)
        analytics = build_admin_analytics(period, now=now)
        metric = request.GET.get("metric", "income")
        if metric not in ("income", "completed_rentals"):
            metric = "income"
        analytics["categories"].sort(
            key=lambda item: Decimal(str(item[metric])),
            reverse=True,
        )
        context = {
            **self.each_context(request),
            "title": "Аналитика площадки",
            "analytics": analytics,
            "metric": metric,
            "metric_max": max(
                (float(item[metric]) for item in analytics["categories"]),
                default=0,
            ),
            "opts": None,
        }
        return render(request, "admin/analytics.html", context)
