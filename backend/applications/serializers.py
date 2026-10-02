"""API representations and input validation for rental applications."""

from decimal import Decimal, ROUND_CEILING
from typing import Any, cast

from applications.models import (
    ApplicationEvent,
    BookingEvent,
    HandoverAct,
    HandoverPhoto,
    ManagerQueuePreference,
    Rental,
    RentalApplication,
    RentalBooking,
    RentalEvent,
    ReturnAct,
    ReturnPhoto,
)
from applications.services import rental_calculation
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


class HandoverPhotoSerializer(serializers.ModelSerializer[HandoverPhoto]):
    url = serializers.SerializerMethodField()

    class Meta:
        model = HandoverPhoto
        fields = ("id", "url", "created_at")

    def get_url(self, photo: HandoverPhoto) -> str:
        return f"/api/v1/handover-photos/{photo.pk}/"


class HandoverPhotoInputSerializer(serializers.Serializer):
    image = serializers.ImageField()


class HandoverCommentSerializer(serializers.Serializer):
    comment = serializers.CharField(
        required=False,
        allow_blank=True,
        max_length=2000,
        trim_whitespace=False,
    )


class ReturnFinancialSerializer(serializers.Serializer):
    late_surcharge_waived = serializers.BooleanField(required=False)
    late_surcharge_waiver_reason = serializers.CharField(
        required=False,
        allow_blank=True,
        max_length=1000,
        trim_whitespace=True,
    )
    damage_enabled = serializers.BooleanField(required=False)
    damage_description = serializers.CharField(
        required=False,
        allow_blank=True,
        max_length=2000,
        trim_whitespace=True,
    )
    damage_amount = serializers.DecimalField(
        required=False,
        max_digits=12,
        decimal_places=2,
        min_value=Decimal("0"),
    )


class ReturnDamageDecisionSerializer(serializers.Serializer):
    accepted = serializers.BooleanField()


class ReturnFinishSerializer(serializers.Serializer):
    next_instance_status = serializers.ChoiceField(
        choices=(
            ProductInstance.Status.AVAILABLE,
            ProductInstance.Status.MAINTENANCE,
        )
    )
    maintenance_reason = serializers.CharField(
        required=False,
        allow_blank=True,
    )


class HandoverActSerializer(serializers.ModelSerializer[HandoverAct]):
    renter = serializers.SerializerMethodField()
    manager = serializers.SerializerMethodField()
    can_review = serializers.SerializerMethodField()

    class Meta:
        model = HandoverAct
        fields = ("id", "renter", "manager", "can_review", "updated_at")

    def get_renter(self, handover: HandoverAct) -> dict[str, Any]:
        return self._party_data(handover, HandoverPhoto.AuthorRole.RENTER)

    def get_manager(self, handover: HandoverAct) -> dict[str, Any]:
        return self._party_data(handover, HandoverPhoto.AuthorRole.MANAGER)

    def get_can_review(self, handover: HandoverAct) -> bool:
        return bool(handover.renter_completed_at and handover.manager_completed_at)

    def _party_data(self, handover: HandoverAct, role: str) -> dict[str, Any]:
        is_renter = role == HandoverPhoto.AuthorRole.RENTER
        user = (
            handover.booking.application.renter
            if is_renter
            else handover.booking.application.product.manager
        )
        prefix = "renter" if is_renter else "manager"
        photos = [photo for photo in handover.photos.all() if photo.author_role == role]
        return {
            "role": role,
            "name": user.name,
            "avatar": user.avatar.url if user.avatar else None,
            "comment": getattr(handover, f"{prefix}_comment"),
            "photos": HandoverPhotoSerializer(photos, many=True).data,
            "is_completed": getattr(handover, f"{prefix}_completed_at") is not None,
            "completed_at": getattr(handover, f"{prefix}_completed_at"),
            "is_confirmed": getattr(handover, f"{prefix}_confirmed_at") is not None,
            "confirmed_at": getattr(handover, f"{prefix}_confirmed_at"),
        }


class ReturnPhotoSerializer(serializers.ModelSerializer[ReturnPhoto]):
    url = serializers.SerializerMethodField()

    class Meta:
        model = ReturnPhoto
        fields = ("id", "url", "created_at")

    def get_url(self, photo: ReturnPhoto) -> str:
        return f"/api/v1/return-photos/{photo.pk}/"


class ReturnActSerializer(serializers.ModelSerializer[ReturnAct]):
    renter = serializers.SerializerMethodField()
    manager = serializers.SerializerMethodField()
    can_review = serializers.SerializerMethodField()
    manager_amount_only = serializers.SerializerMethodField()

    class Meta:
        model = ReturnAct
        fields = (
            "id",
            "renter",
            "manager",
            "can_review",
            "manager_amount_only",
            "late_surcharge_waived",
            "late_surcharge_waiver_reason",
            "late_surcharge_waived_at",
            "damage_enabled",
            "damage_description",
            "damage_amount",
            "damage_decision",
            "next_instance_status",
            "maintenance_reason",
            "updated_at",
        )

    def get_renter(self, return_act: ReturnAct) -> dict[str, Any]:
        return self._party_data(return_act, ReturnPhoto.AuthorRole.RENTER)

    def get_manager(self, return_act: ReturnAct) -> dict[str, Any]:
        return self._party_data(return_act, ReturnPhoto.AuthorRole.MANAGER)

    def get_can_review(self, return_act: ReturnAct) -> bool:
        return bool(return_act.renter_completed_at and return_act.manager_completed_at)

    def get_manager_amount_only(self, return_act: ReturnAct) -> bool:
        return return_act.damage_decision == ReturnAct.DamageDecision.REJECTED

    def _party_data(self, return_act: ReturnAct, role: str) -> dict[str, Any]:
        is_renter = role == ReturnPhoto.AuthorRole.RENTER
        user = (
            return_act.rental.booking.application.renter
            if is_renter
            else return_act.rental.booking.application.product.manager
        )
        prefix = "renter" if is_renter else "manager"
        photos = [
            photo for photo in return_act.photos.all() if photo.author_role == role
        ]
        return {
            "role": role,
            "name": user.name,
            "avatar": user.avatar.url if user.avatar else None,
            "comment": getattr(return_act, f"{prefix}_comment"),
            "photos": ReturnPhotoSerializer(photos, many=True).data,
            "is_completed": getattr(return_act, f"{prefix}_completed_at") is not None,
            "completed_at": getattr(return_act, f"{prefix}_completed_at"),
            "is_confirmed": getattr(return_act, f"{prefix}_confirmed_at") is not None,
            "confirmed_at": getattr(return_act, f"{prefix}_confirmed_at"),
        }


class RentalEventSerializer(serializers.ModelSerializer[RentalEvent]):
    class Meta:
        model = RentalEvent
        fields = ("event", "actor", "created_at", "note")


class RentalSerializer(serializers.ModelSerializer[Rental]):
    booking_id = serializers.IntegerField(read_only=True)
    product = ApplicationProductSerializer(source="booking.application.product")
    renter = ApplicationRenterSerializer(source="booking.application.renter")
    manager = serializers.SerializerMethodField()
    instance = serializers.SerializerMethodField()
    calculated_at = serializers.SerializerMethodField()
    duration_minutes = serializers.SerializerMethodField()
    timely_minutes = serializers.SerializerMethodField()
    late_minutes = serializers.SerializerMethodField()
    timely_cost = serializers.SerializerMethodField()
    late_cost = serializers.SerializerMethodField()
    late_base_cost = serializers.SerializerMethodField()
    late_surcharge = serializers.SerializerMethodField()
    late_surcharge_waived = serializers.SerializerMethodField()
    damage_amount = serializers.SerializerMethodField()
    current_cost = serializers.SerializerMethodField()
    return_act = serializers.SerializerMethodField()
    history = RentalEventSerializer(many=True, read_only=True)
    waiting_applications = serializers.SerializerMethodField()

    class Meta:
        model = Rental
        fields = (
            "id",
            "booking_id",
            "status",
            "minute_rate_snapshot",
            "starting_price_snapshot",
            "planned_return_at",
            "rental_started_at",
            "return_received_at",
            "ended_at",
            "calculated_at",
            "duration_minutes",
            "timely_minutes",
            "late_minutes",
            "timely_cost",
            "late_cost",
            "late_base_cost",
            "late_surcharge",
            "late_surcharge_waived",
            "damage_amount",
            "current_cost",
            "return_act",
            "history",
            "waiting_applications",
            "product",
            "renter",
            "manager",
            "instance",
        )

    def get_manager(self, rental: Rental) -> dict[str, Any]:
        manager = rental.booking.application.product.manager
        return {
            "id": manager.id,
            "name": manager.name,
            "avatar": manager.avatar.url if manager.avatar else None,
        }

    def get_instance(self, rental: Rental) -> dict[str, Any] | None:
        request = self.context.get("request")
        if request is None or request.user.role != "MANAGER":
            return None
        return cast(
            dict[str, Any], BookingInstanceSerializer(rental.booking.instance).data
        )

    def get_calculated_at(self, rental: Rental) -> Any:
        return self._calculation(rental)["calculated_at"]

    def get_duration_minutes(self, rental: Rental) -> int:
        return int(self._calculation(rental)["duration_minutes"])

    def get_timely_minutes(self, rental: Rental) -> int:
        return int(self._calculation(rental)["timely_minutes"])

    def get_late_minutes(self, rental: Rental) -> int:
        return int(self._calculation(rental)["late_minutes"])

    def get_timely_cost(self, rental: Rental) -> str:
        return str(self._calculation(rental)["timely_cost"])

    def get_late_cost(self, rental: Rental) -> str:
        return str(self._calculation(rental)["late_cost"])

    def get_late_base_cost(self, rental: Rental) -> str:
        return str(self._calculation(rental)["late_base_cost"])

    def get_late_surcharge(self, rental: Rental) -> str:
        return str(self._calculation(rental)["late_surcharge"])

    def get_late_surcharge_waived(self, rental: Rental) -> bool:
        return bool(self._calculation(rental)["late_surcharge_waived"])

    def get_damage_amount(self, rental: Rental) -> str:
        return str(self._calculation(rental)["damage_amount"])

    def get_current_cost(self, rental: Rental) -> str:
        return str(self._calculation(rental)["current_cost"])

    @extend_schema_field(ReturnActSerializer(allow_null=True))
    def get_return_act(self, rental: Rental) -> dict[str, Any] | None:
        try:
            return_act = rental.return_act
        except ReturnAct.DoesNotExist:
            return None
        return cast(dict[str, Any], ReturnActSerializer(return_act).data)

    def get_waiting_applications(self, rental: Rental) -> list[dict[str, Any]]:
        request = self.context.get("request")
        if (
            request is None
            or request.user.role != "MANAGER"
            or rental.status != Rental.Status.COMPLETED
        ):
            return []
        applications = (
            RentalApplication.objects.filter(
                product=rental.booking.application.product,
                status=RentalApplication.Status.WAITING,
            )
            .select_related("renter")
            .order_by("pickup_deadline_at", "id")
        )
        return [
            {
                "id": application.id,
                "renter_name": application.renter.name,
                "pickup_deadline_at": application.pickup_deadline_at,
            }
            for application in applications
        ]

    def _calculation(self, rental: Rental) -> dict[str, Any]:
        cache = self.context.setdefault("rental_calculations", {})
        if rental.pk not in cache:
            cache[rental.pk] = rental_calculation(rental, timezone.now())
        return cast(dict[str, Any], cache[rental.pk])


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
    handover = serializers.SerializerMethodField()
    rental = serializers.SerializerMethodField()

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
            "handover",
            "rental",
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

    @extend_schema_field(HandoverActSerializer(allow_null=True))
    def get_handover(self, booking: RentalBooking) -> dict[str, Any] | None:
        try:
            handover = booking.handover
        except HandoverAct.DoesNotExist:
            return None
        return cast(dict[str, Any], HandoverActSerializer(handover).data)

    @extend_schema_field(RentalSerializer(allow_null=True))
    def get_rental(self, booking: RentalBooking) -> dict[str, Any] | None:
        try:
            rental = booking.rental
        except Rental.DoesNotExist:
            return None
        return cast(
            dict[str, Any],
            RentalSerializer(rental, context=self.context).data,
        )


class BookingCreateSerializer(serializers.Serializer):
    instance_id = serializers.UUIDField()


class ManagerQueuePreferenceSerializer(
    serializers.ModelSerializer[ManagerQueuePreference]
):
    class Meta:
        model = ManagerQueuePreference
        fields = ("ordering", "hide_unavailable")
