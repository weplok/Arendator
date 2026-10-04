"""Persistent in-app notifications and per-user preferences."""

from typing import Any

from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q

from users.models import User


class Notification(models.Model):
    class Level(models.TextChoices):
        INFO = "INFO", "Информация"
        WARNING = "WARNING", "Предупреждение"

    class Event(models.TextChoices):
        APPLICATION_EXPIRED = "APPLICATION_EXPIRED", "Истёк срок заявки"
        BOOKING_CREATED = "BOOKING_CREATED", "Бронь подтверждена"
        APPLICATION_CANCELLED = "APPLICATION_CANCELLED", "Заявка отменена"
        BOOKING_CANCELLED = "BOOKING_CANCELLED", "Бронь отменена"
        BOOKING_EXPIRED = "BOOKING_EXPIRED", "Истёк срок получения"
        HANDOVER_STARTED = "HANDOVER_STARTED", "Началась приёмка товара"
        RENTAL_STARTED = "RENTAL_STARTED", "Аренда началась"
        RENTAL_OVERDUE = "RENTAL_OVERDUE", "Истёк плановый возврат"
        RETURN_STARTED = "RETURN_STARTED", "Началась приёмка возврата"
        RENTAL_COMPLETED = "RENTAL_COMPLETED", "Аренда завершена"
        NEW_APPLICATION = "NEW_APPLICATION", "Новая заявка"
        MODERATION_RESULT = "MODERATION_RESULT", "Результат модерации"
        PRODUCT_SUBMITTED = "PRODUCT_SUBMITTED", "Новая карточка на модерации"

    recipient = models.ForeignKey(
        User,
        verbose_name="получатель",
        on_delete=models.CASCADE,
        related_name="notifications",
    )
    event_type = models.CharField(
        "событие",
        max_length=32,
        choices=Event.choices,
    )
    level = models.CharField("тип", max_length=16, choices=Level.choices)
    title = models.CharField("заголовок", max_length=200)
    message = models.TextField("текст")
    target_url = models.CharField("целевая ссылка", max_length=500)
    target_label = models.CharField("подпись действия", max_length=100)
    read_at = models.DateTimeField("прочитано", null=True, blank=True)
    delivered_at = models.DateTimeField(
        "показано во всплывающей ленте", null=True, blank=True
    )
    created_at = models.DateTimeField("создано", auto_now_add=True)

    class Meta:
        verbose_name = "уведомление"
        verbose_name_plural = "уведомления"
        ordering = ("-created_at", "-id")
        constraints = [
            models.CheckConstraint(
                condition=Q(level__in=("INFO", "WARNING")),
                name="notification_valid_level",
            )
        ]
        indexes = [
            models.Index(
                fields=("recipient", "-created_at", "-id"),
                name="notif_recipient_time_idx",
            ),
            models.Index(
                fields=("recipient", "read_at"),
                name="notif_recipient_read_idx",
            ),
            models.Index(
                fields=("recipient", "delivered_at"),
                name="notif_recipient_delivery_idx",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.recipient}: {self.title}"


class NotificationSettings(models.Model):
    user = models.OneToOneField(
        User,
        verbose_name="пользователь",
        on_delete=models.CASCADE,
        related_name="notification_settings",
    )
    sound_enabled = models.BooleanField("звук включён", default=True)
    disabled_events = models.JSONField(
        "отключённые события",
        default=list,
        blank=True,
    )
    updated_at = models.DateTimeField("изменено", auto_now=True)

    class Meta:
        verbose_name = "настройки уведомлений"
        verbose_name_plural = "настройки уведомлений"

    def clean(self) -> None:
        if not isinstance(self.disabled_events, list):
            raise ValidationError({"disabled_events": "Ожидается список событий."})
        invalid = set(self.disabled_events) - set(Notification.Event.values)
        if invalid:
            raise ValidationError(
                {"disabled_events": "Найдены недопустимые типы событий."}
            )

    def save(self, *args: Any, **kwargs: Any) -> None:
        self.disabled_events = sorted(set(self.disabled_events))
        self.full_clean()
        super().save(*args, **kwargs)
