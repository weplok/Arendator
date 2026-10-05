"""Project-level application configuration."""

from django.contrib.admin.apps import AdminConfig


class ArendatorAdminConfig(AdminConfig):
    default_site = "analytics.admin_site.AnalyticsAdminSite"
