# Generated manually for the append-only cross-domain audit trail.

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True

    dependencies = [("users", "0002_user_moderation_label")]

    operations = [
        migrations.CreateModel(
            name="AuditEvent",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("entity_type", models.CharField(max_length=32)),
                ("entity_id", models.CharField(max_length=64)),
                ("event_type", models.CharField(max_length=64)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("actor_role", models.CharField(max_length=16)),
                ("actor_name", models.CharField(blank=True, max_length=150)),
                ("description", models.TextField()),
                ("old_state", models.CharField(blank=True, max_length=64)),
                ("new_state", models.CharField(blank=True, max_length=64)),
                ("application_id", models.PositiveBigIntegerField(blank=True, null=True)),
                ("booking_id", models.PositiveBigIntegerField(blank=True, null=True)),
                ("rental_id", models.PositiveBigIntegerField(blank=True, null=True)),
                ("product_id", models.PositiveBigIntegerField(blank=True, null=True)),
                ("instance_id", models.CharField(blank=True, max_length=64)),
                ("maintenance_id", models.PositiveBigIntegerField(blank=True, null=True)),
                ("actor", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="audit_events", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ("created_at", "id")},
        ),
        migrations.AddIndex(
            model_name="auditevent",
            index=models.Index(fields=["entity_type", "entity_id", "created_at"], name="core_audite_entity__2e1839_idx"),
        ),
        migrations.AddIndex(
            model_name="auditevent",
            index=models.Index(fields=["rental_id", "created_at"], name="core_audite_rental__235b17_idx"),
        ),
        migrations.AddIndex(
            model_name="auditevent",
            index=models.Index(fields=["instance_id", "created_at"], name="core_audite_instanc_66a1a7_idx"),
        ),
    ]
