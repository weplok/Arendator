"""Rental application and booking endpoints for renters and managers."""

from datetime import timedelta
import mimetypes
from typing import Any

from applications.models import (
    HandoverPhoto,
    ManagerQueuePreference,
    Rental,
    RentalApplication,
    RentalBooking,
    ReturnPhoto,
)
from applications.serializers import (
    ApplicationCreateSerializer,
    BookingCreateSerializer,
    CancellationSerializer,
    HandoverCommentSerializer,
    HandoverPhotoInputSerializer,
    HandoverPhotoSerializer,
    ManagerQueuePreferenceSerializer,
    ManagerRentalApplicationSerializer,
    RentalApplicationSerializer,
    RentalBookingSerializer,
    RentalSerializer,
    ReturnDamageDecisionSerializer,
    ReturnFinancialSerializer,
    ReturnFinishSerializer,
    ReturnPhotoSerializer,
)
from applications.services import (
    add_handover_photo,
    add_return_photo,
    cancel_application,
    cancel_booking,
    complete_handover_materials,
    complete_return_materials,
    confirm_booking_arrival,
    confirm_handover,
    confirm_return,
    create_application,
    create_booking,
    decide_return_damage,
    delete_handover_photo,
    delete_return_photo,
    expire_due_bookings,
    expire_waiting_applications,
    finish_return,
    handover_actor_role,
    receive_return,
    refresh_overdue_rentals,
    request_handover_changes,
    request_return_changes,
    return_actor_role,
    update_handover_comment,
    update_return_comment,
    update_return_financials,
)
from django.db.models import Case, Count, IntegerField, Prefetch, Q, QuerySet, When
from django.http import FileResponse
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
            "handover",
            "rental",
        )
        .prefetch_related(
            "history",
            "handover__photos",
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


def participant_booking(request: Request, booking_id: int) -> RentalBooking:
    if request.user.role == User.Role.RENTER:
        query = RentalBooking.objects.filter(application__renter=request.user)
    elif request.user.role == User.Role.MANAGER:
        query = RentalBooking.objects.filter(application__product__manager=request.user)
    else:
        raise PermissionDenied("Доступно только участникам выдачи.")
    return get_object_or_404(query, pk=booking_id)


def rental_queryset() -> QuerySet[Rental]:
    return Rental.objects.select_related(
        "booking",
        "booking__instance",
        "booking__application",
        "booking__application__renter",
        "booking__application__product",
        "booking__application__product__manager",
        "booking__application__product__pickup_point",
        "return_act",
    ).prefetch_related(
        "history",
        "return_act__photos",
        Prefetch(
            "booking__application__product__photos",
            queryset=ProductPhoto.objects.order_by("display_order", "id"),
            to_attr="application_photos",
        ),
    )


def participant_rentals(request: Request) -> QuerySet[Rental]:
    if request.user.role == User.Role.RENTER:
        return rental_queryset().filter(booking__application__renter=request.user)
    if request.user.role == User.Role.MANAGER:
        return rental_queryset().filter(
            booking__application__product__manager=request.user
        )
    raise PermissionDenied("Доступно только участникам аренды.")


def serialize_rental(rental_id: int, request: Request) -> dict[str, Any]:
    rental = rental_queryset().get(pk=rental_id)
    return dict(RentalSerializer(rental, context={"request": request}).data)


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


class HandoverPhotoListView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request: Request, pk: int) -> Response:
        participant_booking(request, pk)
        serializer = HandoverPhotoInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        photo = add_handover_photo(
            booking_id=pk,
            user=request.user,
            role=handover_actor_role(request.user),
            image=serializer.validated_data["image"],
        )
        return Response(HandoverPhotoSerializer(photo).data, status=201)


class HandoverMaterialsView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request: Request, pk: int) -> Response:
        participant_booking(request, pk)
        serializer = HandoverCommentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        update_handover_comment(
            booking_id=pk,
            role=handover_actor_role(request.user),
            comment=serializer.validated_data.get("comment", ""),
        )
        return Response(serialize_booking(pk, request))


class HandoverPhotoView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request: Request, photo_id: int) -> FileResponse:
        photo = get_object_or_404(
            HandoverPhoto.objects.select_related(
                "handover__booking__application__product"
            ),
            pk=photo_id,
        )
        booking = photo.handover.booking
        is_renter = booking.application.renter_id == request.user.id
        is_manager = booking.application.product.manager_id == request.user.id
        if not (is_renter or is_manager or request.user.is_staff):
            raise PermissionDenied("Нет доступа к фотографии фотоакта.")
        content_type = mimetypes.guess_type(photo.image.name or "")[0] or "image/jpeg"
        return FileResponse(photo.image.open("rb"), content_type=content_type)

    def delete(self, request: Request, pk: int, photo_id: int) -> Response:
        participant_booking(request, pk)
        photo = get_object_or_404(HandoverPhoto, pk=photo_id, handover__booking_id=pk)
        if photo.author_id != request.user.id:
            raise PermissionDenied("Можно удалить только собственную фотографию.")
        delete_handover_photo(photo=photo, role=handover_actor_role(request.user))
        return Response(status=status.HTTP_204_NO_CONTENT)


class HandoverCompleteView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request: Request, pk: int) -> Response:
        participant_booking(request, pk)
        complete_handover_materials(
            booking_id=pk,
            role=handover_actor_role(request.user),
        )
        return Response(serialize_booking(pk, request))


class HandoverConfirmView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request: Request, pk: int) -> Response:
        participant_booking(request, pk)
        confirm_handover(booking_id=pk, role=handover_actor_role(request.user))
        return Response(serialize_booking(pk, request))


class HandoverRequestChangesView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request: Request, pk: int) -> Response:
        participant_booking(request, pk)
        request_handover_changes(
            booking_id=pk,
            requester_role=handover_actor_role(request.user),
        )
        return Response(serialize_booking(pk, request))


class RentalListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        refresh_overdue_rentals()
        rentals = participant_rentals(request).order_by("-rental_started_at", "-id")
        return Response(
            RentalSerializer(rentals, many=True, context={"request": request}).data
        )


class RentalDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request: Request, pk: int) -> Response:
        refresh_overdue_rentals()
        rental = get_object_or_404(participant_rentals(request), pk=pk)
        return Response(RentalSerializer(rental, context={"request": request}).data)


class ManagerReturnReceiveView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request: Request, pk: int) -> Response:
        require_role(request, User.Role.MANAGER)
        get_object_or_404(
            participant_rentals(request),
            pk=pk,
            booking__application__product__manager=request.user,
        )
        receive_return(rental_id=pk)
        return Response(serialize_rental(pk, request))


class ReturnPhotoListView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request: Request, pk: int) -> Response:
        get_object_or_404(participant_rentals(request), pk=pk)
        serializer = HandoverPhotoInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        photo = add_return_photo(
            rental_id=pk,
            user=request.user,
            role=return_actor_role(request.user),
            image=serializer.validated_data["image"],
        )
        return Response(ReturnPhotoSerializer(photo).data, status=201)


class ReturnMaterialsView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request: Request, pk: int) -> Response:
        get_object_or_404(participant_rentals(request), pk=pk)
        serializer = HandoverCommentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        update_return_comment(
            rental_id=pk,
            role=return_actor_role(request.user),
            comment=serializer.validated_data.get("comment", ""),
        )
        return Response(serialize_rental(pk, request))


class ReturnPhotoView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request: Request, photo_id: int) -> FileResponse:
        photo = get_object_or_404(
            ReturnPhoto.objects.select_related(
                "return_act__rental__booking__application__product"
            ),
            pk=photo_id,
        )
        application = photo.return_act.rental.booking.application
        is_renter = application.renter_id == request.user.id
        is_manager = application.product.manager_id == request.user.id
        if not (is_renter or is_manager or request.user.is_staff):
            raise PermissionDenied("Нет доступа к фотографии фотоакта.")
        content_type = mimetypes.guess_type(photo.image.name or "")[0] or "image/jpeg"
        return FileResponse(photo.image.open("rb"), content_type=content_type)

    def delete(self, request: Request, pk: int, photo_id: int) -> Response:
        get_object_or_404(participant_rentals(request), pk=pk)
        photo = get_object_or_404(
            ReturnPhoto,
            pk=photo_id,
            return_act__rental_id=pk,
        )
        if photo.author_id != request.user.id:
            raise PermissionDenied("Можно удалить только собственную фотографию.")
        delete_return_photo(photo=photo, role=return_actor_role(request.user))
        return Response(status=status.HTTP_204_NO_CONTENT)


class ReturnFinancialsView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request: Request, pk: int) -> Response:
        require_role(request, User.Role.MANAGER)
        get_object_or_404(participant_rentals(request), pk=pk)
        serializer = ReturnFinancialSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        update_return_financials(
            rental_id=pk,
            values=dict(serializer.validated_data),
        )
        return Response(serialize_rental(pk, request))


class ReturnCompleteView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request: Request, pk: int) -> Response:
        get_object_or_404(participant_rentals(request), pk=pk)
        complete_return_materials(
            rental_id=pk,
            role=return_actor_role(request.user),
        )
        return Response(serialize_rental(pk, request))


class ReturnRequestChangesView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request: Request, pk: int) -> Response:
        get_object_or_404(participant_rentals(request), pk=pk)
        request_return_changes(
            rental_id=pk,
            requester_role=return_actor_role(request.user),
        )
        return Response(serialize_rental(pk, request))


class ReturnDamageDecisionView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request: Request, pk: int) -> Response:
        require_role(request, User.Role.RENTER)
        get_object_or_404(participant_rentals(request), pk=pk)
        serializer = ReturnDamageDecisionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        decide_return_damage(
            rental_id=pk,
            accepted=serializer.validated_data["accepted"],
        )
        return Response(serialize_rental(pk, request))


class ReturnConfirmView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request: Request, pk: int) -> Response:
        get_object_or_404(participant_rentals(request), pk=pk)
        confirm_return(rental_id=pk, role=return_actor_role(request.user))
        return Response(serialize_rental(pk, request))


class ReturnFinishView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request: Request, pk: int) -> Response:
        require_role(request, User.Role.MANAGER)
        get_object_or_404(participant_rentals(request), pk=pk)
        serializer = ReturnFinishSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        finish_return(
            rental_id=pk,
            next_instance_status=serializer.validated_data["next_instance_status"],
        )
        return Response(serialize_rental(pk, request))


class RenterActivityView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        require_role(request, User.Role.RENTER)
        refresh_overdue_rentals()
        rental = (
            participant_rentals(request)
            .filter(
                status__in=(
                    Rental.Status.ACTIVE,
                    Rental.Status.OVERDUE,
                    Rental.Status.RETURN_INSPECTION,
                )
            )
            .order_by("rental_started_at", "id")
            .first()
        )
        handover = (
            booking_queryset()
            .filter(
                application__renter=request.user,
                status=RentalBooking.Status.ARRIVED,
            )
            .first()
        )
        return Response(
            {
                "handover": (
                    RentalBookingSerializer(handover, context={"request": request}).data
                    if handover
                    else None
                ),
                "rental": (
                    RentalSerializer(rental, context={"request": request}).data
                    if rental
                    else None
                ),
            }
        )


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
