"""Rental application endpoints for renters and managers."""

from typing import Any

from applications.models import ManagerQueuePreference, RentalApplication
from applications.serializers import (
    ApplicationCreateSerializer,
    CancellationSerializer,
    ManagerQueuePreferenceSerializer,
    RentalApplicationSerializer,
)
from applications.services import (
    cancel_application,
    create_application,
    expire_waiting_applications,
)
from django.db.models import Case, Count, IntegerField, Prefetch, Q, QuerySet, When
from django.shortcuts import get_object_or_404
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
            RentalApplicationSerializer(application, context={"request": request}).data
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
