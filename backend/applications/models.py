"""Waiting applications and manager queue preferences."""

from typing import Any

from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import F, Q

from catalog.models import Product, ProductInstance
from users.models import User


class RentalApplication(models.Model):
    class Status(models.TextChoices):
        WAITING = "WAITING", "Ожидает решения"
        BOOKED = "BOOKED", "Преобразована в бронь"
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
                condition=Q(status__in=("WAITING", "BOOKED", "CANCELLED", "EXPIRED")),
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
        BOOKED = "BOOKED", "Создана бронь"
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


class RentalBooking(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "ACTIVE", "Ждёт арендатора"
        ARRIVED = "ARRIVED", "Арендатор прибыл"
        CANCELLED = "CANCELLED", "Отменена"
        EXPIRED = "EXPIRED", "Истекла автоматически"

    application = models.OneToOneField(
        RentalApplication,
        verbose_name="заявка",
        on_delete=models.PROTECT,
        related_name="booking",
    )
    instance = models.ForeignKey(
        ProductInstance,
        verbose_name="экземпляр",
        on_delete=models.PROTECT,
        related_name="bookings",
    )
    status = models.CharField(
        "статус",
        max_length=16,
        choices=Status.choices,
        default=Status.ACTIVE,
    )
    minute_rate_snapshot = models.DecimalField(
        "зафиксированная ставка",
        max_digits=12,
        decimal_places=2,
    )
    starting_price_snapshot = models.DecimalField(
        "зафиксированная стартовая стоимость",
        max_digits=12,
        decimal_places=2,
    )
    arrival_confirmed_at = models.DateTimeField(
        "прибытие подтверждено",
        null=True,
        blank=True,
    )
    cancellation_reason = models.TextField("причина отмены", blank=True)
    ended_at = models.DateTimeField("дата завершения", null=True, blank=True)
    created_at = models.DateTimeField("дата создания", auto_now_add=True)
    updated_at = models.DateTimeField("дата изменения", auto_now=True)

    class Meta:
        verbose_name = "бронь"
        verbose_name_plural = "брони"
        constraints = [
            models.CheckConstraint(
                condition=Q(status__in=("ACTIVE", "ARRIVED", "CANCELLED", "EXPIRED")),
                name="booking_valid_status",
            ),
            models.UniqueConstraint(
                fields=("instance",),
                condition=Q(status__in=("ACTIVE", "ARRIVED")),
                name="booking_one_current_per_instance",
            ),
        ]
        indexes = [
            models.Index(
                fields=("status", "application"),
                name="booking_status_application_idx",
            ),
            models.Index(
                fields=("status", "created_at"),
                name="booking_status_created_idx",
            ),
        ]

    def clean(self) -> None:
        errors: dict[str, str] = {}
        if (
            self.application_id
            and self.instance_id
            and self.application.product_id != self.instance.product_id
        ):
            errors["instance"] = "Экземпляр относится к другому товару."
        if self.status == self.Status.ARRIVED and self.arrival_confirmed_at is None:
            errors["arrival_confirmed_at"] = "Укажите время подтверждения прибытия."
        if errors:
            raise ValidationError(errors)

    def save(self, *args: Any, **kwargs: Any) -> None:
        self.cancellation_reason = self.cancellation_reason.strip()
        self.full_clean()
        super().save(*args, **kwargs)

    def __str__(self) -> str:
        return f"Бронь {self.pk or 'новая'}: {self.application.product}"


class BookingEvent(models.Model):
    class Event(models.TextChoices):
        CREATED = "CREATED", "Бронь создана"
        ARRIVAL_CONFIRMED = "ARRIVAL_CONFIRMED", "Прибытие подтверждено"
        CANCELLED = "CANCELLED", "Бронь отменена"
        EXPIRED = "EXPIRED", "Бронь истекла автоматически"

    class Actor(models.TextChoices):
        RENTER = "RENTER", "Арендатор"
        MANAGER = "MANAGER", "Менеджер"
        SYSTEM = "SYSTEM", "Система"

    booking = models.ForeignKey(
        RentalBooking,
        verbose_name="бронь",
        on_delete=models.CASCADE,
        related_name="history",
    )
    event = models.CharField("событие", max_length=24, choices=Event.choices)
    actor = models.CharField("инициатор", max_length=16, choices=Actor.choices)
    created_at = models.DateTimeField("дата события", auto_now_add=True)
    note = models.TextField("комментарий", blank=True)

    class Meta:
        verbose_name = "событие брони"
        verbose_name_plural = "события брони"
        ordering = ("created_at", "id")
