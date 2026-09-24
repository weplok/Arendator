"""Rental application and booking endpoints for renters and managers."""

from datetime import timedelta
from typing import Any

from applications.models import (
    ManagerQueuePreference,
    RentalApplication,
    RentalBooking,
)
from applications.serializers import (
    ApplicationCreateSerializer,
    BookingCreateSerializer,
    CancellationSerializer,
    ManagerQueuePreferenceSerializer,
    ManagerRentalApplicationSerializer,
    RentalApplicationSerializer,
    RentalBookingSerializer,
)
from applications.services import (
    cancel_application,
    cancel_booking,
    confirm_booking_arrival,
    create_application,
    create_booking,
    expire_due_bookings,
    expire_waiting_applications,
)
from django.db.models import Case, Count, IntegerField, Prefetch, Q, QuerySet, When
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from catalog.models import Product, ProductInstance, ProductPhoto
from users.models import User


def require_role(request: Request, role: str) -> None:
    if request.user.role != role:
        label = "арендатору" if role == User.Role.RENTER else "менеджеру"
        raise PermissionDenied(f"Доступно только {label}.")


def application_queryset() -> QuerySet[RentalApplication]:
    photos = ProductPhoto.objects.order_by("display_order", "id")
    return (
        RentalApplication.objects.select_related(
            "renter", "product", "product__pickup_point", "product__manager"
        )
        .prefetch_related(
            "history",
            Prefetch(
                "product__photos",
                queryset=photos,
                to_attr="application_photos",
            ),
        )
        .annotate(
            total_instances_count=Count(
                "product__instances",
                filter=Q(product__instances__is_deleted=False),
                distinct=True,
            ),
            available_instances_count=Count(
                "product__instances",
                filter=Q(
                    product__instances__is_deleted=False,
                    product__instances__status=ProductInstance.Status.AVAILABLE,
                ),
                distinct=True,
            ),
        )
    )


def serialize_application(application_id: int, request: Request) -> dict[str, Any]:
    application = application_queryset().get(pk=application_id)
    return dict(
        RentalApplicationSerializer(application, context={"request": request}).data
    )


def booking_queryset() -> QuerySet[RentalBooking]:
    photos = ProductPhoto.objects.order_by("display_order", "id")
    return (
        RentalBooking.objects.select_related(
            "application",
            "application__renter",
            "application__product",
            "application__product__pickup_point",
            "application__product__manager",
            "instance",
        )
        .prefetch_related(
            "history",
            Prefetch(
                "application__product__photos",
                queryset=photos,
                to_attr="application_photos",
            ),
        )
        .order_by("application__pickup_deadline_at", "id")
    )


def serialize_booking(booking_id: int, request: Request) -> dict[str, Any]:
    booking = booking_queryset().get(pk=booking_id)
    return dict(RentalBookingSerializer(booking, context={"request": request}).data)


class ProductApplicationCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request: Request, pk: int) -> Response:
        require_role(request, User.Role.RENTER)
        expire_waiting_applications()
        get_object_or_404(Product, pk=pk)
        serializer = ApplicationCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        application = create_application(
            renter=request.user,
            product_id=pk,
            **serializer.validated_data,
        )
        return Response(
            serialize_application(application.pk, request),
            status=status.HTTP_201_CREATED,
        )


class RenterApplicationListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        require_role(request, User.Role.RENTER)
        expire_waiting_applications()
        applications = (
            application_queryset()
            .filter(renter=request.user)
            .order_by("-created_at", "-id")
        )
        serializer = RentalApplicationSerializer(
            applications, many=True, context={"request": request}
        )
        return Response(serializer.data)


class RenterApplicationDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request: Request, pk: int) -> Response:
        require_role(request, User.Role.RENTER)
        expire_waiting_applications()
        application = get_object_or_404(
            application_queryset(), pk=pk, renter=request.user
        )
        return Response(
            RentalApplicationSerializer(application, context={"request": request}).data
        )


class RenterApplicationCancelView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request: Request, pk: int) -> Response:
        require_role(request, User.Role.RENTER)
        expire_waiting_applications()
        application = get_object_or_404(RentalApplication, pk=pk, renter=request.user)
        serializer = CancellationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        cancelled = cancel_application(
            application=application,
            actor="RENTER",
            reason=serializer.validated_data.get("reason", ""),
        )
        return Response(serialize_application(cancelled.pk, request))


class ManagerApplicationBookView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request: Request, pk: int) -> Response:
        require_role(request, User.Role.MANAGER)
        expire_waiting_applications()
        expire_due_bookings()
        application = get_object_or_404(
            RentalApplication, pk=pk, product__manager=request.user
        )
        serializer = BookingCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        booking, created = create_booking(
            application_id=application.pk,
            instance_id=str(serializer.validated_data["instance_id"]),
            manager=request.user,
        )
        return Response(
            serialize_booking(booking.pk, request),
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class RenterBookingListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        require_role(request, User.Role.RENTER)
        expire_due_bookings()
        bookings = booking_queryset().filter(application__renter=request.user)
        return Response(
            RentalBookingSerializer(
                bookings, many=True, context={"request": request}
            ).data
        )


class RenterBookingDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request: Request, pk: int) -> Response:
        require_role(request, User.Role.RENTER)
        expire_due_bookings()
        booking = get_object_or_404(
            booking_queryset(), pk=pk, application__renter=request.user
        )
        return Response(
            RentalBookingSerializer(booking, context={"request": request}).data
        )


class RenterBookingCancelView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request: Request, pk: int) -> Response:
        require_role(request, User.Role.RENTER)
        expire_due_bookings()
        booking = get_object_or_404(
            RentalBooking, pk=pk, application__renter=request.user
        )
        serializer = CancellationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        cancelled = cancel_booking(
            booking=booking,
            actor="RENTER",
            reason=serializer.validated_data.get("reason", ""),
        )
        return Response(serialize_booking(cancelled.pk, request))


class ManagerBookingListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        require_role(request, User.Role.MANAGER)
        expire_due_bookings()
        period = request.query_params.get("period", "today")
        if period not in {"today", "three", "all"}:
            period = "today"
        current = booking_queryset().filter(
            application__product__manager=request.user,
            status__in=(RentalBooking.Status.ACTIVE, RentalBooking.Status.ARRIVED),
        )
        now = timezone.now()
        local_now = timezone.localtime(now)
        today_start = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
        tomorrow_start = today_start + timedelta(days=1)
        three_days_end = today_start + timedelta(days=3)
        summary = {
            "today": current.filter(
                application__pickup_deadline_at__gte=today_start,
                application__pickup_deadline_at__lt=tomorrow_start,
            ).count(),
            "urgent": current.filter(
                status=RentalBooking.Status.ACTIVE,
                application__pickup_deadline_at__gt=now,
                application__pickup_deadline_at__lte=now + timedelta(hours=4),
            ).count(),
            "three_days": current.filter(
                application__pickup_deadline_at__gte=today_start,
                application__pickup_deadline_at__lt=three_days_end,
            ).count(),
        }
        if period == "today":
            current = current.filter(
                application__pickup_deadline_at__gte=today_start,
                application__pickup_deadline_at__lt=tomorrow_start,
            )
        elif period == "three":
            current = current.filter(
                application__pickup_deadline_at__gte=today_start,
                application__pickup_deadline_at__lt=three_days_end,
            )
        return Response(
            {
                "period": period,
                "summary": summary,
                "results": RentalBookingSerializer(
                    current, many=True, context={"request": request}
                ).data,
            }
        )


class ManagerBookingDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request: Request, pk: int) -> Response:
        require_role(request, User.Role.MANAGER)
        expire_due_bookings()
        booking = get_object_or_404(
            booking_queryset(), pk=pk, application__product__manager=request.user
        )
        return Response(
            RentalBookingSerializer(booking, context={"request": request}).data
        )


class ManagerBookingCancelView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request: Request, pk: int) -> Response:
        require_role(request, User.Role.MANAGER)
        expire_due_bookings()
        booking = get_object_or_404(
            RentalBooking, pk=pk, application__product__manager=request.user
        )
        serializer = CancellationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        cancelled = cancel_booking(
            booking=booking,
            actor="MANAGER",
            reason=serializer.validated_data.get("reason", ""),
        )
        return Response(serialize_booking(cancelled.pk, request))


class ManagerBookingArrivalView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request: Request, pk: int) -> Response:
        require_role(request, User.Role.MANAGER)
        booking = get_object_or_404(
            RentalBooking, pk=pk, application__product__manager=request.user
        )
        confirmed = confirm_booking_arrival(booking=booking)
        return Response(serialize_booking(confirmed.pk, request))


class ManagerApplicationListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        require_role(request, User.Role.MANAGER)
        expire_waiting_applications()
        preference, _ = ManagerQueuePreference.objects.get_or_create(
            manager=request.user
        )
        applications = application_queryset().filter(
            product__manager=request.user,
            status=RentalApplication.Status.WAITING,
        )
        applications = applications.annotate(
            availability_group=Case(
                When(available_instances_count__gt=0, then=0),
                default=1,
                output_field=IntegerField(),
            )
        )
        if preference.hide_unavailable:
            applications = applications.filter(
                product__instances__status=ProductInstance.Status.AVAILABLE,
                product__instances__is_deleted=False,
            ).distinct()
        order_fields: dict[str, tuple[str, str]] = {
            ManagerQueuePreference.Ordering.EARLIEST: ("created_at", "id"),
            ManagerQueuePreference.Ordering.LATEST: ("-created_at", "-id"),
            ManagerQueuePreference.Ordering.NEAREST: (
                "pickup_deadline_at",
                "id",
            ),
        }
        applications = applications.order_by(
            "availability_group", *order_fields[preference.ordering]
        )
        return Response(
            {
                "preferences": ManagerQueuePreferenceSerializer(preference).data,
                "results": RentalApplicationSerializer(
                    applications, many=True, context={"request": request}
                ).data,
            }
        )


class ManagerQueuePreferenceView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request: Request) -> Response:
        require_role(request, User.Role.MANAGER)
        preference, _ = ManagerQueuePreference.objects.get_or_create(
            manager=request.user
        )
        serializer = ManagerQueuePreferenceSerializer(
            preference, data=request.data, partial=True
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class ManagerApplicationDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request: Request, pk: int) -> Response:
        require_role(request, User.Role.MANAGER)
        expire_waiting_applications()
        application = get_object_or_404(
            application_queryset(), pk=pk, product__manager=request.user
        )
        return Response(
            ManagerRentalApplicationSerializer(
                application, context={"request": request}
            ).data
        )


class ManagerApplicationCancelView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request: Request, pk: int) -> Response:
        require_role(request, User.Role.MANAGER)
        expire_waiting_applications()
        application = get_object_or_404(
            RentalApplication, pk=pk, product__manager=request.user
        )
        serializer = CancellationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        cancelled = cancel_application(
            application=application,
            actor="MANAGER",
            reason=serializer.validated_data.get("reason", ""),
        )
        return Response(serialize_application(cancelled.pk, request))
