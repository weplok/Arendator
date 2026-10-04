"""Authenticated WebSocket delivery for notification cards."""

from typing import Any

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.utils import timezone
from notifications.delivery import build_backlog_cards
from notifications.models import Notification
from notifications.services import notification_group

from users.models import User


class NotificationConsumer(AsyncJsonWebsocketConsumer):
    group_name = ""

    async def connect(self) -> None:
        user = self.scope["user"]
        if not user.is_authenticated:
            await self.close(code=4401)
            return
        self.group_name = notification_group(user.pk)
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()
        cards = await self._backlog(user)
        await self.send_json({"type": "notifications.backlog", "cards": cards})

    async def disconnect(self, close_code: int) -> None:
        if self.group_name:
            await self.channel_layer.group_discard(
                self.group_name,
                self.channel_name,
            )

    async def receive_json(self, content: dict[str, Any], **kwargs: Any) -> None:
        if content.get("type") != "notifications.delivered":
            return
        notification_ids = content.get("notification_ids", [])
        if not isinstance(notification_ids, list):
            return
        safe_ids = [value for value in notification_ids if isinstance(value, int)]
        await self._mark_delivered(self.scope["user"].pk, safe_ids)

    async def notification_created(self, event: dict[str, Any]) -> None:
        await self.send_json(
            {"type": "notification.created", "card": event["notification"]}
        )

    @database_sync_to_async
    def _backlog(self, user: User) -> list[dict[str, Any]]:
        return build_backlog_cards(user)

    @database_sync_to_async
    def _mark_delivered(self, user_id: int, notification_ids: list[int]) -> None:
        Notification.objects.filter(
            recipient_id=user_id,
            pk__in=notification_ids,
            delivered_at__isnull=True,
        ).update(delivered_at=timezone.now())
