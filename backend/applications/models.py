"""Waiting applications and manager queue preferences."""

from typing import Any

from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import F, Q

from catalog.models import Product
from users.models import User


class RentalApplication(models.Model):
    class Status(models.TextChoices):
        WAITING = "WAITING", "Ожидает решения"
        CANCELLED = "CANCELLED", "Отменена"
        EXPIRED = "EXPIRED", "Срок получения истёк"

    renter = models.ForeignKey(
        User,
        verbose_name="арендатор",
        on_delete=models.PROTECT,
        related_name="rental_applications",
    )
    product = models.ForeignKey(
        Product,
        verbose_name="товар",
        on_delete=models.PROTECT,
        related_name="rental_applications",
    )
    pickup_deadline_at = models.DateTimeField("крайний срок получения")
    planned_return_at = models.DateTimeField("плановый срок возврата")
    status = models.CharField(
        "статус",
        max_length=16,
        choices=Status.choices,
        default=Status.WAITING,
    )
    created_at = models.DateTimeField("дата подачи", auto_now_add=True)
    updated_at = models.DateTimeField("дата изменения", auto_now=True)
    cancellation_reason = models.TextField("причина отмены", blank=True)

    class Meta:
        verbose_name = "заявка"
        verbose_name_plural = "заявки"
        constraints = [
            models.CheckConstraint(
                condition=Q(planned_return_at__gte=F("pickup_deadline_at")),
                name="application_return_not_before_pickup",
            ),
            models.CheckConstraint(
                condition=Q(status__in=("WAITING", "CANCELLED", "EXPIRED")),
                name="application_valid_status",
            ),
        ]
        indexes = [
            models.Index(
                fields=("renter", "product", "status"),
                name="application_renter_product_idx",
            ),
            models.Index(
                fields=("product", "status", "pickup_deadline_at"),
                name="application_product_queue_idx",
            ),
        ]

    def clean(self) -> None:
        errors: dict[str, str] = {}
        if self.renter_id and self.renter.role != User.Role.RENTER:
            errors["renter"] = "Заявку может создать только арендатор."
        if self.planned_return_at < self.pickup_deadline_at:
            errors["planned_return_at"] = (
                "Плановый возврат не может быть раньше срока получения."
            )
        if errors:
            raise ValidationError(errors)

    def save(self, *args: Any, **kwargs: Any) -> None:
        self.cancellation_reason = self.cancellation_reason.strip()
        self.full_clean()
        super().save(*args, **kwargs)

    def __str__(self) -> str:
        return f"Заявка {self.pk or 'новая'}: {self.product}"


class ApplicationEvent(models.Model):
    class Event(models.TextChoices):
        CREATED = "CREATED", "Заявка создана"
        CANCELLED = "CANCELLED", "Заявка отменена"
        EXPIRED = "EXPIRED", "Срок получения истёк"

    class Actor(models.TextChoices):
        RENTER = "RENTER", "Арендатор"
        MANAGER = "MANAGER", "Менеджер"
        SYSTEM = "SYSTEM", "Система"

    application = models.ForeignKey(
        RentalApplication,
        verbose_name="заявка",
        on_delete=models.CASCADE,
        related_name="history",
    )
    event = models.CharField("событие", max_length=16, choices=Event.choices)
    actor = models.CharField("инициатор", max_length=16, choices=Actor.choices)
    created_at = models.DateTimeField("дата события", auto_now_add=True)
    note = models.TextField("комментарий", blank=True)

    class Meta:
        verbose_name = "событие заявки"
        verbose_name_plural = "события заявок"
        ordering = ("created_at", "id")


class ManagerQueuePreference(models.Model):
    class Ordering(models.TextChoices):
        EARLIEST = "EARLIEST", "Сначала ранние"
        LATEST = "LATEST", "Сначала поздние"
        NEAREST = "NEAREST", "Ближайшие"

    manager = models.OneToOneField(
        User,
        verbose_name="менеджер",
        on_delete=models.CASCADE,
        related_name="application_queue_preference",
    )
    ordering = models.CharField(
        "сортировка",
        max_length=16,
        choices=Ordering.choices,
        default=Ordering.EARLIEST,
    )
    hide_unavailable = models.BooleanField(
        "скрывать товары без свободных экземпляров",
        default=False,
    )

    class Meta:
        verbose_name = "настройка очереди заявок"
        verbose_name_plural = "настройки очереди заявок"

    def clean(self) -> None:
        if self.manager_id and self.manager.role != User.Role.MANAGER:
            raise ValidationError({"manager": "Настройка доступна только менеджеру."})

    def save(self, *args: Any, **kwargs: Any) -> None:
        self.full_clean()
        super().save(*args, **kwargs)
