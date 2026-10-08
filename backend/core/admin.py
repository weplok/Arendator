"""Read-only administrative access to the immutable audit trail."""

from django.contrib import admin
from django.http import HttpRequest

from core.models import AuditEvent


@admin.register(AuditEvent)
class AuditEventAdmin(admin.ModelAdmin):
    list_display = (
        "created_at",
        "entity_type",
        "event_type",
        "actor_role",
        "actor_name",
        "description",
    )
    list_filter = ("entity_type", "event_type", "actor_role")
    search_fields = (
        "entity_id",
        "actor_name",
        "description",
        "instance_id",
    )
    date_hierarchy = "created_at"

    def has_add_permission(self, request: HttpRequest) -> bool:
        return False

    def has_change_permission(
        self,
        request: HttpRequest,
        obj: AuditEvent | None = None,
    ) -> bool:
        return False

    def has_delete_permission(
        self,
        request: HttpRequest,
        obj: AuditEvent | None = None,
    ) -> bool:
        return False
