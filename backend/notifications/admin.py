"""Read-only-friendly notification inspection in Django admin."""

from django.contrib import admin
from notifications.models import Notification, NotificationSettings


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ("title", "recipient", "event_type", "level", "created_at")
    list_filter = ("event_type", "level", "read_at")
    search_fields = ("title", "message", "recipient__email")


@admin.register(NotificationSettings)
class NotificationSettingsAdmin(admin.ModelAdmin):
    list_display = ("user", "sound_enabled", "updated_at")
