from django.db import migrations


TRANSITIONS = {
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


def actor_values(role, renter, manager):
    if role == "RENTER":
        return renter.pk, renter.name
    if role == "MANAGER":
        return manager.pk, manager.name
    return None, "Система"


def backfill_audit_events(apps, schema_editor):
    ApplicationEvent = apps.get_model("applications", "ApplicationEvent")
    AuditEvent = apps.get_model("core", "AuditEvent")
    BookingEvent = apps.get_model("applications", "BookingEvent")
    Maintenance = apps.get_model("catalog", "Maintenance")
    ModerationDecision = apps.get_model("catalog", "ModerationDecision")
    RentalEvent = apps.get_model("applications", "RentalEvent")

    records = []
    timestamps = []

    application_events = ApplicationEvent.objects.select_related(
        "application__renter",
        "application__product__manager",
    )
    for event in application_events.iterator():
        application = event.application
        actor_id, actor_name = actor_values(
            event.actor,
            application.renter,
            application.product.manager,
        )
        old_state, new_state = TRANSITIONS.get(
            ("APPLICATION", event.event),
            ("", ""),
        )
        records.append(
            AuditEvent(
                entity_type="APPLICATION",
                entity_id=str(application.pk),
                event_type=event.event,
                actor_id=actor_id,
                actor_role=event.actor,
                actor_name=actor_name,
                description=event.get_event_display(),
                old_state=old_state,
                new_state=new_state,
                application_id=application.pk,
                product_id=application.product_id,
            )
        )
        timestamps.append(event.created_at)

    booking_events = BookingEvent.objects.select_related(
        "booking__application__renter",
        "booking__application__product__manager",
    )
    for event in booking_events.iterator():
        booking = event.booking
        application = booking.application
        actor_id, actor_name = actor_values(
            event.actor,
            application.renter,
            application.product.manager,
        )
        old_state, new_state = TRANSITIONS.get(
            ("BOOKING", event.event),
            ("", ""),
        )
        records.append(
            AuditEvent(
                entity_type="BOOKING",
                entity_id=str(booking.pk),
                event_type=event.event,
                actor_id=actor_id,
                actor_role=event.actor,
                actor_name=actor_name,
                description=event.get_event_display(),
                old_state=old_state,
                new_state=new_state,
                application_id=application.pk,
                booking_id=booking.pk,
                product_id=application.product_id,
                instance_id=str(booking.instance_id),
            )
        )
        timestamps.append(event.created_at)

    rental_events = RentalEvent.objects.select_related(
        "rental__booking__application__renter",
        "rental__booking__application__product__manager",
    )
    for event in rental_events.iterator():
        rental = event.rental
        booking = rental.booking
        application = booking.application
        actor_id, actor_name = actor_values(
            event.actor,
            application.renter,
            application.product.manager,
        )
        old_state, new_state = TRANSITIONS.get(
            ("RENTAL", event.event),
            ("", ""),
        )
        records.append(
            AuditEvent(
                entity_type="RENTAL",
                entity_id=str(rental.pk),
                event_type=event.event,
                actor_id=actor_id,
                actor_role=event.actor,
                actor_name=actor_name,
                description=event.get_event_display(),
                old_state=old_state,
                new_state=new_state,
                application_id=application.pk,
                booking_id=booking.pk,
                rental_id=rental.pk,
                product_id=application.product_id,
                instance_id=str(booking.instance_id),
            )
        )
        timestamps.append(event.created_at)

    decisions = ModerationDecision.objects.select_related("decided_by")
    for decision in decisions.iterator():
        actor = decision.decided_by
        records.append(
            AuditEvent(
                entity_type="MODERATION",
                entity_id=str(decision.product_id or decision.pk),
                event_type=decision.decision,
                actor_id=actor.pk if actor else None,
                actor_role="ADMIN" if actor else "SYSTEM",
                actor_name=actor.name if actor else "Система",
                description=(
                    f"{decision.get_decision_display()}: {decision.product_name}"
                ),
                new_state=decision.decision,
                product_id=decision.product_id,
            )
        )
        timestamps.append(decision.created_at)

    maintenances = Maintenance.objects.select_related(
        "started_by",
        "instance",
    )
    for maintenance in maintenances.iterator():
        common_values = {
            "entity_type": "MAINTENANCE",
            "entity_id": str(maintenance.pk),
            "actor_id": maintenance.started_by_id,
            "actor_role": "MANAGER",
            "actor_name": maintenance.started_by.name,
            "product_id": maintenance.instance.product_id,
            "instance_id": str(maintenance.instance_id),
            "maintenance_id": maintenance.pk,
        }
        records.append(
            AuditEvent(
                **common_values,
                event_type="STARTED",
                description="Обслуживание экземпляра начато",
                old_state="AVAILABLE",
                new_state="MAINTENANCE",
            )
        )
        timestamps.append(maintenance.started_at)
        if maintenance.completed_at:
            records.append(
                AuditEvent(
                    **common_values,
                    event_type="COMPLETED",
                    description="Обслуживание экземпляра завершено",
                    old_state="MAINTENANCE",
                    new_state="AVAILABLE",
                )
            )
            timestamps.append(maintenance.completed_at)

    if not records:
        return
    AuditEvent.objects.bulk_create(records, batch_size=500)
    for record, created_at in zip(records, timestamps, strict=True):
        record.created_at = created_at
    AuditEvent.objects.bulk_update(records, ["created_at"], batch_size=500)


class Migration(migrations.Migration):
    dependencies = [
        ("applications", "0005_returnact_maintenance_reason"),
        ("catalog", "0006_maintenance_maintenancephoto_and_more"),
        ("core", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(
            backfill_audit_events,
            reverse_code=migrations.RunPython.noop,
        )
    ]
