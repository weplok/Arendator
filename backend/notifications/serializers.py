"""REST representations for notifications and settings."""

from typing import Any

from notifications.models import Notification, NotificationSettings
from notifications.services import available_events_for_user
from rest_framework import serializers


class NotificationSerializer(serializers.ModelSerializer[Notification]):
    is_read = serializers.SerializerMethodField()

    class Meta:
        model = Notification
        fields = (
            "id",
            "event_type",
            "level",
            "title",
            "message",
            "target_url",
            "target_label",
            "is_read",
            "created_at",
        )

    def get_is_read(self, notification: Notification) -> bool:
        return notification.read_at is not None


class NotificationIdsSerializer(serializers.Serializer[dict[str, Any]]):
    ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        allow_empty=False,
        max_length=1000,
    )


class NotificationSettingsSerializer(serializers.Serializer[dict[str, Any]]):
    sound_enabled = serializers.BooleanField()
    enabled_events = serializers.ListField(child=serializers.CharField())

    def validate_enabled_events(self, value: list[str]) -> list[str]:
        user = self.context["request"].user
        available_events = available_events_for_user(user)
        invalid_events = set(value) - set(available_events)
        if invalid_events:
            raise serializers.ValidationError(
                "Настройка содержит недоступные для роли события."
            )
        return list(dict.fromkeys(value))

    def update(
        self,
        instance: NotificationSettings,
        validated_data: dict[str, Any],
    ) -> NotificationSettings:
        available_events = available_events_for_user(instance.user)
        if "enabled_events" in validated_data:
            enabled_events = set(validated_data["enabled_events"])
            instance.disabled_events = [
                event for event in available_events if event not in enabled_events
            ]
        if "sound_enabled" in validated_data:
            instance.sound_enabled = validated_data["sound_enabled"]
        instance.save()
        return instance

    def create(self, validated_data: dict[str, Any]) -> NotificationSettings:
        raise NotImplementedError("Настройки создаются представлением.")

    def to_representation(self, instance: NotificationSettings) -> dict[str, Any]:
        available_events = available_events_for_user(instance.user)
        disabled_events = set(instance.disabled_events)
        return {
            "sound_enabled": instance.sound_enabled,
            "enabled_events": [
                event for event in available_events if event not in disabled_events
            ],
            "available_events": available_events,
        }
