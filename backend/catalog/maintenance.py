"""Transactional operations for manager-owned instance maintenance."""

from decimal import Decimal
from typing import Any

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from catalog.models import Maintenance, MaintenancePhoto, ProductInstance
from users.models import User


@transaction.atomic
def start_maintenance(
    *,
    instance_id: Any,
    manager: User,
    reason: str,
) -> Maintenance:
    instance = (
        ProductInstance.objects.select_for_update()
        .select_related("product")
        .get(pk=instance_id, manager=manager, is_deleted=False)
    )
    if instance.status != ProductInstance.Status.AVAILABLE:
        raise ValidationError(
            {"status": "На обслуживание можно отправить только свободный экземпляр."}
        )
    normalized_reason = reason.strip()
    if not normalized_reason:
        raise ValidationError({"reason": "Укажите причину обслуживания."})
    maintenance = Maintenance.objects.create(
        instance=instance,
        started_by=manager,
        reason=normalized_reason,
    )
    instance.status = ProductInstance.Status.MAINTENANCE
    instance.save(update_fields=("status",))
    return maintenance


@transaction.atomic
def complete_maintenance(
    *,
    maintenance_id: int,
    manager: User,
    repair_cost: Decimal,
    damage_description: str,
    images: list[Any],
) -> Maintenance:
    maintenance = (
        Maintenance.objects.select_for_update()
        .select_related("instance", "instance__product")
        .get(pk=maintenance_id, instance__manager=manager)
    )
    if maintenance.completed_at is not None:
        raise ValidationError({"status": "Обслуживание уже завершено."})
    if maintenance.instance.status != ProductInstance.Status.MAINTENANCE:
        raise ValidationError({"status": "Экземпляр не находится на обслуживании."})
    maintenance.repair_cost = repair_cost
    maintenance.damage_description = damage_description.strip() or maintenance.reason
    maintenance.completed_at = timezone.now()
    maintenance.save()
    for image in images:
        MaintenancePhoto.objects.create(maintenance=maintenance, image=image)
    maintenance.instance.status = ProductInstance.Status.AVAILABLE
    maintenance.instance.save(update_fields=("status",))
    return maintenance
