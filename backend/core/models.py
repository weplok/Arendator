"""Append-only cross-domain audit trail required by SPEC.md section 18."""

from typing import Any

from django.core.exceptions import ValidationError
from django.db import models


class AuditEvent(models.Model):
    """A safe immutable event with denormalized entity scopes for filtering."""

    entity_type = models.CharField(max_length=32)
    entity_id = models.CharField(max_length=64)
    event_type = models.CharField(max_length=64)
    created_at = models.DateTimeField(auto_now_add=True)
    actor = models.ForeignKey(
        "users.User",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="audit_events",
    )
    actor_role = models.CharField(max_length=16)
    actor_name = models.CharField(max_length=150, blank=True)
    description = models.TextField()
    old_state = models.CharField(max_length=64, blank=True)
    new_state = models.CharField(max_length=64, blank=True)
    application_id = models.PositiveBigIntegerField(null=True, blank=True)
    booking_id = models.PositiveBigIntegerField(null=True, blank=True)
    rental_id = models.PositiveBigIntegerField(null=True, blank=True)
    product_id = models.PositiveBigIntegerField(null=True, blank=True)
    instance_id = models.CharField(max_length=64, blank=True)
    maintenance_id = models.PositiveBigIntegerField(null=True, blank=True)

    class Meta:
        ordering = ("created_at", "id")
        indexes = [
            models.Index(fields=("entity_type", "entity_id", "created_at")),
            models.Index(fields=("rental_id", "created_at")),
            models.Index(fields=("instance_id", "created_at")),
        ]

    def save(self, *args: Any, **kwargs: Any) -> None:
        if self.pk is not None:
            raise ValidationError("События аудита нельзя изменять.")
        super().save(*args, **kwargs)

    def delete(self, *args: Any, **kwargs: Any) -> tuple[int, dict[str, int]]:
        raise ValidationError("События аудита нельзя удалять.")


def record_audit_event(**values: Any) -> AuditEvent:
    """Create one append-only audit event from a domain transition."""
    return AuditEvent.objects.create(**values)
