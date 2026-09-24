"""API representations and input validation for rental applications."""

from decimal import Decimal, ROUND_CEILING
from typing import Any, cast

from applications.models import (
    ApplicationEvent,
    BookingEvent,
    ManagerQueuePreference,
    RentalApplication,
    RentalBooking,
)
from django.utils import timezone
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from catalog.models import ProductInstance
from catalog.serializers import PickupPointSerializer, ProductPhotoSerializer


class ApplicationCreateSerializer(serializers.Serializer):
    pickup_deadline_at = serializers.DateTimeField()
    planned_return_at = serializers.DateTimeField()

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        pickup_deadline_at = attrs["pickup_deadline_at"]
        planned_return_at = attrs["planned_return_at"]
        errors: dict[str, str] = {}
        if pickup_deadline_at <= timezone.now():
            errors["pickup_deadline_at"] = "Срок получения должен быть в будущем."
        if planned_return_at < pickup_deadline_at:
            errors["planned_return_at"] = (
                "Плановый возврат не может быть раньше срока получения."
            )
        if errors:
            raise serializers.ValidationError(errors)
        return attrs


class CancellationSerializer(serializers.Serializer):
    reason = serializers.CharField(
        required=False,
        allow_blank=True,
        max_length=1000,
        trim_whitespace=True,
    )


class ApplicationEventSerializer(serializers.ModelSerializer[ApplicationEvent]):
    class Meta:
        model = ApplicationEvent
        fields = ("event", "actor", "created_at", "note")


class ApplicationProductSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    name = serializers.CharField()
    description = serializers.CharField()
    minute_rate = serializers.DecimalField(max_digits=12, decimal_places=2)
    primary_photo = serializers.SerializerMethodField()
    pickup_point = serializers.SerializerMethodField()
    available_instances_count = serializers.SerializerMethodField()
    total_instances_count = serializers.SerializerMethodField()

    @extend_schema_field(ProductPhotoSerializer(allow_null=True))
    def get_primary_photo(self, product: Any) -> dict[str, Any] | None:
        photos = getattr(product, "application_photos", ())
        if not photos:
            return None
        photo = next((item for item in photos if item.is_primary), photos[0])
        return cast(
            dict[str, Any],
            ProductPhotoSerializer(photo, context=self.context).data,
        )

    @extend_schema_field(PickupPointSerializer(allow_null=True))
    def get_pickup_point(self, product: Any) -> dict[str, Any] | None:
        if product.pickup_point is None:
            return None
        return cast(
            dict[str, Any],
            PickupPointSerializer(product.pickup_point, context=self.context).data,
        )

    def get_available_instances_count(self, product: Any) -> int:
        application = self.parent.instance
        return int(getattr(application, "available_instances_count", 0))

    def get_total_instances_count(self, product: Any) -> int:
        application = self.parent.instance
        return int(getattr(application, "total_instances_count", 0))


class ApplicationRenterSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    name = serializers.CharField()
    avatar = serializers.SerializerMethodField()

    def get_avatar(self, renter: Any) -> str | None:
        return renter.avatar.url if renter.avatar else None


class RentalApplicationSerializer(serializers.ModelSerializer[RentalApplication]):
    product = ApplicationProductSerializer(read_only=True)
    renter = ApplicationRenterSerializer(read_only=True)
    history = ApplicationEventSerializer(many=True, read_only=True)
    estimated_cost = serializers.SerializerMethodField()

    class Meta:
        model = RentalApplication
        fields = (
            "id",
            "status",
            "pickup_deadline_at",
            "planned_return_at",
            "created_at",
            "updated_at",
            "cancellation_reason",
            "estimated_cost",
            "product",
            "renter",
            "history",
        )

    def get_estimated_cost(self, application: RentalApplication) -> str:
        duration = application.planned_return_at - application.pickup_deadline_at
        minutes = (Decimal(str(duration.total_seconds())) / Decimal("60")).quantize(
            Decimal("1"), rounding=ROUND_CEILING
        )
        total = (minutes + Decimal("10")) * application.product.minute_rate
        return str(total.quantize(Decimal("0.01")))


class ProductInstanceChoiceSerializer(serializers.ModelSerializer[ProductInstance]):
    status_label = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = ProductInstance
        fields = (
            "id",
            "inventory_number",
            "instance_number",
            "status",
            "status_label",
        )


class ManagerRentalApplicationSerializer(RentalApplicationSerializer):
    instances = serializers.SerializerMethodField()

    class Meta:
        model = RentalApplication
        fields = (
            "id",
            "status",
            "pickup_deadline_at",
            "planned_return_at",
            "created_at",
            "updated_at",
            "cancellation_reason",
            "estimated_cost",
            "product",
            "renter",
            "history",
            "instances",
        )

    @extend_schema_field(ProductInstanceChoiceSerializer(many=True))
    def get_instances(self, application: RentalApplication) -> list[dict[str, Any]]:
        instances = application.product.instances.filter(is_deleted=False).order_by(
            "instance_number"
        )
        return list(ProductInstanceChoiceSerializer(instances, many=True).data)


class BookingEventSerializer(serializers.ModelSerializer[BookingEvent]):
    class Meta:
        model = BookingEvent
        fields = ("event", "actor", "created_at", "note")


class BookingInstanceSerializer(serializers.ModelSerializer[ProductInstance]):
    status_label = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = ProductInstance
        fields = ("id", "inventory_number", "instance_number", "status", "status_label")


class RentalBookingSerializer(serializers.ModelSerializer[RentalBooking]):
    application_id = serializers.IntegerField(read_only=True)
    pickup_deadline_at = serializers.DateTimeField(
        source="application.pickup_deadline_at", read_only=True
    )
    planned_return_at = serializers.DateTimeField(
        source="application.planned_return_at", read_only=True
    )
    product = ApplicationProductSerializer(source="application.product", read_only=True)
    renter = ApplicationRenterSerializer(source="application.renter", read_only=True)
    manager = serializers.SerializerMethodField()
    history = BookingEventSerializer(many=True, read_only=True)
    instance = serializers.SerializerMethodField()

    class Meta:
        model = RentalBooking
        fields = (
            "id",
            "application_id",
            "status",
            "pickup_deadline_at",
            "planned_return_at",
            "minute_rate_snapshot",
            "starting_price_snapshot",
            "arrival_confirmed_at",
            "cancellation_reason",
            "ended_at",
            "created_at",
            "updated_at",
            "product",
            "renter",
            "manager",
            "instance",
            "history",
        )

    def get_manager(self, booking: RentalBooking) -> dict[str, Any]:
        manager = booking.application.product.manager
        return {
            "id": manager.id,
            "name": manager.name,
            "avatar": manager.avatar.url if manager.avatar else None,
        }

    @extend_schema_field(BookingInstanceSerializer(allow_null=True))
    def get_instance(self, booking: RentalBooking) -> dict[str, Any] | None:
        request = self.context.get("request")
        if request is None or request.user.role != "MANAGER":
            return None
        return cast(dict[str, Any], BookingInstanceSerializer(booking.instance).data)


class BookingCreateSerializer(serializers.Serializer):
    instance_id = serializers.UUIDField()


class ManagerQueuePreferenceSerializer(
    serializers.ModelSerializer[ManagerQueuePreference]
):
    class Meta:
        model = ManagerQueuePreference
        fields = ("ordering", "hide_unavailable")
