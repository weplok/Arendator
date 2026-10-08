"""Translate domain history records into the cross-domain audit trail."""

from typing import Any

from applications.models import ApplicationEvent, BookingEvent, RentalEvent
from django.db.models.signals import post_save, pre_save
from django.dispatch import receiver

from catalog.models import Maintenance, ModerationDecision
from core.models import record_audit_event
from users.models import User


def actor_for(role: str, renter: User, manager: User) -> User | None:
    if role == "RENTER":
        return renter
    if role == "MANAGER":
        return manager
    return None


def transition_for(entity_type: str, event_type: str) -> tuple[str, str]:
    transitions = {
        ("APPLICATION", "CREATED"): ("", "WAITING"),
        ("APPLICATION", "BOOKED"): ("WAITING", "BOOKED"),
        ("APPLICATION", "CANCELLED"): ("WAITING", "CANCELLED"),
        ("APPLICATION", "EXPIRED"): ("WAITING", "EXPIRED"),
        ("BOOKING", "CREATED"): ("", "ACTIVE"),
        ("BOOKING", "ARRIVAL_CONFIRMED"): ("ACTIVE", "ARRIVED"),
        ("BOOKING", "RENTAL_STARTED"): ("ARRIVED", "RENTED"),
        ("BOOKING", "CANCELLED"): ("ACTIVE", "CANCELLED"),
        ("BOOKING", "EXPIRED"): ("ACTIVE", "EXPIRED"),
        ("RENTAL", "RETURN_RECEIVED"): ("ACTIVE", "RETURN_INSPECTION"),
        ("RENTAL", "RETURN_COMPLETED"): ("RETURN_INSPECTION", "COMPLETED"),
    }
    return transitions.get((entity_type, event_type), ("", ""))


@receiver(post_save, sender=ApplicationEvent)
def audit_application_event(
    sender: type[ApplicationEvent], instance: ApplicationEvent, created: bool, **_: Any
) -> None:
    if not created:
        return
    application = instance.application
    manager = application.product.manager
    actor = actor_for(instance.actor, application.renter, manager)
    old_state, new_state = transition_for("APPLICATION", instance.event)
    record_audit_event(
        entity_type="APPLICATION",
        entity_id=str(application.pk),
        event_type=instance.event,
        actor=actor,
        actor_role=instance.actor,
        actor_name=actor.name if actor else "Система",
        description=instance.get_event_display(),
        old_state=old_state,
        new_state=new_state,
        application_id=application.pk,
        product_id=application.product_id,
    )


@receiver(post_save, sender=BookingEvent)
def audit_booking_event(
    sender: type[BookingEvent], instance: BookingEvent, created: bool, **_: Any
) -> None:
    if not created:
        return
    booking = instance.booking
    application = booking.application
    manager = application.product.manager
    actor = actor_for(instance.actor, application.renter, manager)
    old_state, new_state = transition_for("BOOKING", instance.event)
    record_audit_event(
        entity_type="BOOKING",
        entity_id=str(booking.pk),
        event_type=instance.event,
        actor=actor,
        actor_role=instance.actor,
        actor_name=actor.name if actor else "Система",
        description=instance.get_event_display(),
        old_state=old_state,
        new_state=new_state,
        application_id=application.pk,
        booking_id=booking.pk,
        product_id=application.product_id,
        instance_id=str(booking.instance_id),
    )


@receiver(post_save, sender=RentalEvent)
def audit_rental_event(
    sender: type[RentalEvent], instance: RentalEvent, created: bool, **_: Any
) -> None:
    if not created:
        return
    rental = instance.rental
    booking = rental.booking
    application = booking.application
    manager = application.product.manager
    actor = actor_for(instance.actor, application.renter, manager)
    old_state, new_state = transition_for("RENTAL", instance.event)
    record_audit_event(
        entity_type="RENTAL",
        entity_id=str(rental.pk),
        event_type=instance.event,
        actor=actor,
        actor_role=instance.actor,
        actor_name=actor.name if actor else "Система",
        description=instance.get_event_display(),
        old_state=old_state,
        new_state=new_state,
        application_id=application.pk,
        booking_id=booking.pk,
        rental_id=rental.pk,
        product_id=application.product_id,
        instance_id=str(booking.instance_id),
    )


@receiver(post_save, sender=ModerationDecision)
def audit_moderation_decision(
    sender: type[ModerationDecision],
    instance: ModerationDecision,
    created: bool,
    **_: Any,
) -> None:
    if not created:
        return
    actor = instance.decided_by
    record_audit_event(
        entity_type="MODERATION",
        entity_id=str(instance.product_id or instance.pk),
        event_type=instance.decision,
        actor=actor,
        actor_role="ADMIN" if actor else "SYSTEM",
        actor_name=actor.name if actor else "Система",
        description=f"{instance.get_decision_display()}: {instance.product_name}",
        new_state=instance.decision,
        product_id=instance.product_id,
    )


@receiver(pre_save, sender=Maintenance)
def remember_maintenance_state(
    sender: type[Maintenance], instance: Maintenance, **_: Any
) -> None:
    instance._audit_was_completed = False
    if instance.pk:
        previous = (
            Maintenance.objects.filter(pk=instance.pk).only("completed_at").first()
        )
        instance._audit_was_completed = bool(previous and previous.completed_at)


@receiver(post_save, sender=Maintenance)
def audit_maintenance(
    sender: type[Maintenance], instance: Maintenance, created: bool, **_: Any
) -> None:
    completed_now = bool(instance.completed_at) and not getattr(
        instance, "_audit_was_completed", False
    )
    if not created and not completed_now:
        return
    event_type = "STARTED" if created else "COMPLETED"
    description = (
        "Обслуживание экземпляра начато"
        if created
        else "Обслуживание экземпляра завершено"
    )
    record_audit_event(
        entity_type="MAINTENANCE",
        entity_id=str(instance.pk),
        event_type=event_type,
        actor=instance.started_by,
        actor_role="MANAGER",
        actor_name=instance.started_by.name,
        description=description,
        old_state="AVAILABLE" if created else "MAINTENANCE",
        new_state="MAINTENANCE" if created else "AVAILABLE",
        product_id=instance.instance.product_id,
        instance_id=str(instance.instance_id),
        maintenance_id=instance.pk,
    )
