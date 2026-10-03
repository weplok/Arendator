"""Manager-owned catalog mutations for the product editor."""

from decimal import Decimal
import mimetypes
from typing import Any
from uuid import UUID

from applications.models import Rental, ReturnAct
from applications.services import (
    cancel_excess_applications,
    cancel_waiting_for_product,
)
from django.core.exceptions import ValidationError as ModelValidationError
from django.db import IntegrityError, transaction
from django.db.models import Count, Prefetch, Q
from django.http import FileResponse
from django.shortcuts import get_object_or_404
from rest_framework import serializers, status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from catalog.maintenance import complete_maintenance, start_maintenance
from catalog.models import (
    Maintenance,
    MaintenancePhoto,
    PickupPoint,
    Product,
    ProductInstance,
    ProductPhoto,
)
from catalog.moderation import submit_product_for_moderation
from catalog.serializers import ProductPhotoSerializer
from categories.models import Category
from users.models import User


def require_manager(request: Request) -> None:
    if request.user.role != User.Role.MANAGER:
        raise PermissionDenied("Доступно только менеджеру.")


def owned_product(request: Request, pk: int) -> Product:
    require_manager(request)
    return get_object_or_404(
        Product.objects.select_related("category", "pickup_point")
        .annotate(
            available_instances_count=Count(
                "instances",
                filter=Q(instances__status=ProductInstance.Status.AVAILABLE),
            )
        )
        .prefetch_related(
            Prefetch(
                "photos", queryset=ProductPhoto.objects.order_by("display_order", "id")
            ),
            Prefetch(
                "instances",
                queryset=ProductInstance.objects.order_by("instance_number"),
            ),
        ),
        pk=pk,
        manager=request.user,
    )


def model_error(exc: ModelValidationError) -> ValidationError:
    return ValidationError(
        exc.message_dict if hasattr(exc, "message_dict") else exc.messages
    )


class ProductInputSerializer(serializers.Serializer):
    category = serializers.PrimaryKeyRelatedField(
        queryset=Category.objects.all(), required=False
    )
    name = serializers.CharField(max_length=200)
    description = serializers.CharField()
    minute_rate = serializers.DecimalField(
        max_digits=12, decimal_places=2, min_value=Decimal("0.01")
    )


class PickupInputSerializer(serializers.Serializer):
    city = serializers.CharField(max_length=150)
    district = serializers.CharField(max_length=150)
    full_address = serializers.CharField(max_length=300)
    latitude = serializers.DecimalField(max_digits=9, decimal_places=6)
    longitude = serializers.DecimalField(max_digits=9, decimal_places=6)


class PhotoInputSerializer(serializers.Serializer):
    image = serializers.ImageField()


class PhotoOrderInputSerializer(serializers.Serializer):
    photo_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        allow_empty=False,
    )


class InstanceInputSerializer(serializers.Serializer):
    inventory_number = serializers.CharField(
        max_length=100, required=False, allow_blank=True
    )


class InstanceSearchSerializer(serializers.Serializer):
    inventory_number = serializers.CharField(max_length=100, trim_whitespace=True)


class MaintenanceStartSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=2000, trim_whitespace=True)


class MaintenanceCompleteSerializer(serializers.Serializer):
    repair_cost = serializers.DecimalField(
        max_digits=12,
        decimal_places=2,
        min_value=Decimal("0"),
    )
    damage_description = serializers.CharField(
        max_length=4000,
        required=False,
        allow_blank=True,
        trim_whitespace=True,
    )
    images = serializers.ListField(
        child=serializers.ImageField(),
        required=False,
        allow_empty=True,
    )


def product_data(product: Product) -> dict[str, Any]:
    instances = [item for item in product.instances.all() if not item.is_deleted]
    photos = list(product.photos.all())
    return {
        "id": product.pk,
        "catalog_number": product.catalog_number,
        "category": product.category_id,
        "category_name": product.category.name,
        "name": product.name,
        "description": product.description,
        "minute_rate": str(product.minute_rate),
        "status": product.status,
        "rejection_reason": product.rejection_reason,
        "published_at": product.published_at,
        "pickup_point": manager_pickup_data(product.pickup_point),
        "photos": ProductPhotoSerializer(photos, many=True).data,
        "instances": [manager_instance_data(item) for item in instances],
        "available_instances_count": sum(
            item.status == ProductInstance.Status.AVAILABLE for item in instances
        ),
    }


def maintenance_data(maintenance: Maintenance) -> dict[str, Any]:
    return {
        "id": maintenance.pk,
        "reason": maintenance.reason,
        "damage_description": (maintenance.damage_description or maintenance.reason),
        "repair_cost": (
            str(maintenance.repair_cost)
            if maintenance.repair_cost is not None
            else None
        ),
        "started_at": maintenance.started_at,
        "completed_at": maintenance.completed_at,
        "source_return_id": maintenance.source_return_act_id,
        "photos": [
            {
                "id": photo.pk,
                "url": f"/api/v1/maintenance-photos/{photo.pk}/",
                "created_at": photo.created_at,
            }
            for photo in maintenance.photos.all()
        ],
    }


def manager_instance_data(instance: ProductInstance) -> dict[str, Any]:
    maintenances = list(
        instance.maintenances.prefetch_related("photos").order_by("-started_at", "-id")
    )
    damage_returns = list(
        ReturnAct.objects.filter(
            rental__booking__instance=instance,
            rental__status=Rental.Status.COMPLETED,
            damage_enabled=True,
        )
        .select_related("rental")
        .order_by("-rental__ended_at", "-id")
    )
    history = [
        {
            "kind": "MAINTENANCE",
            **maintenance_data(maintenance),
            "occurred_at": maintenance.completed_at or maintenance.started_at,
        }
        for maintenance in maintenances
    ]
    history.extend(
        {
            "id": return_act.pk,
            "kind": "DAMAGE",
            "occurred_at": return_act.rental.ended_at,
            "damage_description": return_act.damage_description,
            "damage_amount": str(return_act.damage_amount),
            "rental_id": return_act.rental_id,
            "photos": [],
        }
        for return_act in damage_returns
    )
    history.sort(
        key=lambda item: item["occurred_at"],
        reverse=True,
    )
    repair_total = sum(
        (
            maintenance.repair_cost or Decimal("0")
            for maintenance in maintenances
            if maintenance.completed_at is not None
        ),
        Decimal("0"),
    )
    active_maintenance = next(
        (
            maintenance
            for maintenance in maintenances
            if maintenance.completed_at is None
        ),
        None,
    )
    return {
        "id": str(instance.pk),
        "inventory_number": instance.inventory_number,
        "status": instance.status,
        "created_at": instance.created_at,
        "repair_total": str(repair_total),
        "history_count": len(history),
        "history": history,
        "active_maintenance": (
            maintenance_data(active_maintenance)
            if active_maintenance is not None
            else None
        ),
    }


def manager_pickup_data(point: PickupPoint | None) -> dict[str, str] | None:
    if point is None:
        return None
    return {
        "city": point.city,
        "district": point.district,
        "full_address": point.full_address,
        "latitude": str(point.latitude),
        "longitude": str(point.longitude),
        "yandex_maps_url": (
            "https://yandex.ru/maps/?pt="
            f"{point.longitude},{point.latitude}&z=16&l=map"
        ),
    }


def editable_product(product: Product) -> None:
    if product.status not in (
        Product.Status.DRAFT,
        Product.Status.PUBLISHED,
        Product.Status.REJECTED,
    ):
        raise ValidationError({"status": "Товар в этом статусе нельзя изменять."})


class ManagerProductsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        require_manager(request)
        products = (
            Product.objects.filter(manager=request.user)
            .select_related("category", "pickup_point")
            .prefetch_related("photos", "instances")
            .order_by("-created_at", "-pk")
        )
        return Response([product_data(product) for product in products])

    def post(self, request: Request) -> Response:
        require_manager(request)
        serializer = ProductInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if "category" not in serializer.validated_data:
            raise ValidationError({"category": "Укажите категорию."})
        try:
            product = Product.objects.create(
                manager=request.user, **serializer.validated_data
            )
        except ModelValidationError as exc:
            raise model_error(exc) from exc
        return Response(product_data(product), status=status.HTTP_201_CREATED)


class ManagerProductView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request: Request, pk: int) -> Response:
        return Response(product_data(owned_product(request, pk)))

    def patch(self, request: Request, pk: int) -> Response:
        product = owned_product(request, pk)
        editable_product(product)
        serializer = ProductInputSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        if "category" in serializer.validated_data and product.published_at is not None:
            raise ValidationError(
                {"category": "Категорию нельзя менять после первой публикации."}
            )
        for field, value in serializer.validated_data.items():
            setattr(product, field, value)
        try:
            product.save()
        except ModelValidationError as exc:
            raise model_error(exc) from exc
        return Response(product_data(product))

    def delete(self, request: Request, pk: int) -> Response:
        product = owned_product(request, pk)
        if product.published_at is not None or product.status not in (
            Product.Status.DRAFT,
            Product.Status.REJECTED,
        ):
            raise ValidationError(
                {
                    "status": (
                        "Удалить можно только неопубликованный черновик "
                        "или отклонённый товар."
                    )
                }
            )
        stored_images: list[tuple[Any, str]] = []
        for photo in product.photos.all():
            if photo.image.name:
                stored_images.append((photo.image.storage, photo.image.name))
        with transaction.atomic():
            product.instances.all().delete()
            product.delete()
            transaction.on_commit(lambda: _delete_stored_images(stored_images))
        return Response(status=status.HTTP_204_NO_CONTENT)


def _delete_stored_images(stored_images: list[tuple[Any, str]]) -> None:
    for storage, name in stored_images:
        storage.delete(name)


class ManagerPickupView(APIView):
    permission_classes = [IsAuthenticated]

    def put(self, request: Request, pk: int) -> Response:
        product = owned_product(request, pk)
        if (
            product.status
            not in (
                Product.Status.DRAFT,
                Product.Status.REJECTED,
            )
            or product.published_at
        ):
            raise ValidationError(
                {"pickup_point": "Точка после публикации не изменяется."}
            )
        serializer = PickupInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            with transaction.atomic():
                point = product.pickup_point or PickupPoint(manager=request.user)
                for field, value in serializer.validated_data.items():
                    setattr(point, field, value)
                point.save()
                product.pickup_point = point
                product.save()
        except ModelValidationError as exc:
            raise model_error(exc) from exc
        return Response(product_data(product))


class ManagerPhotosView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request: Request, pk: int) -> Response:
        product = owned_product(request, pk)
        editable_product(product)
        serializer = PhotoInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        photo = ProductPhoto(
            product=product,
            image=serializer.validated_data["image"],
            display_order=product.photos.count(),
            is_primary=not product.photos.exists(),
        )
        try:
            photo.save()
        except ModelValidationError as exc:
            raise model_error(exc) from exc
        return Response(ProductPhotoSerializer(photo).data, status=201)


class ManagerPhotoView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request: Request, pk: int, photo_id: int) -> Response:
        product = owned_product(request, pk)
        editable_product(product)
        photo = get_object_or_404(ProductPhoto, pk=photo_id, product=product)
        if product.status == Product.Status.PUBLISHED and product.photos.count() == 1:
            raise ValidationError(
                {"photos": "У опубликованного товара должно быть фото."}
            )
        was_primary = photo.is_primary
        photo.delete()
        photo.image.delete(save=False)
        if was_primary:
            replacement = product.photos.order_by("display_order", "id").first()
            if replacement:
                replacement.is_primary = True
                replacement.save()
        return Response(status=204)

    def put(self, request: Request, pk: int, photo_id: int) -> Response:
        product = owned_product(request, pk)
        editable_product(product)
        photo = get_object_or_404(ProductPhoto, pk=photo_id, product=product)
        ordered_ids = [
            photo.pk,
            *product.photos.exclude(pk=photo.pk).values_list("pk", flat=True),
        ]
        reorder_product_photos(product, ordered_ids)
        return Response(status=204)


class ManagerPhotoOrderView(APIView):
    permission_classes = [IsAuthenticated]

    def put(self, request: Request, pk: int) -> Response:
        product = owned_product(request, pk)
        editable_product(product)
        serializer = PhotoOrderInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        photo_ids = serializer.validated_data["photo_ids"]
        existing_ids = list(product.photos.values_list("pk", flat=True))
        if len(photo_ids) != len(set(photo_ids)) or set(photo_ids) != set(existing_ids):
            raise ValidationError(
                {"photo_ids": "Передайте все фотографии товара без повторов."}
            )
        reorder_product_photos(product, photo_ids)
        return Response(status=204)


def reorder_product_photos(product: Product, photo_ids: list[int]) -> None:
    with transaction.atomic():
        photos = {
            photo.pk: photo
            for photo in ProductPhoto.objects.select_for_update().filter(
                product=product
            )
        }
        ProductPhoto.objects.filter(product=product, is_primary=True).update(
            is_primary=False
        )
        for display_order, photo_id in enumerate(photo_ids):
            photo = photos[photo_id]
            photo.display_order = display_order
            photo.is_primary = display_order == 0
            photo.save(update_fields=("display_order", "is_primary"))


class ManagerInstancesView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request: Request, pk: int) -> Response:
        product = owned_product(request, pk)
        editable_product(product)
        serializer = InstanceInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            instance = ProductInstance.objects.create(
                product=product, **serializer.validated_data
            )
        except (ModelValidationError, IntegrityError) as exc:
            if isinstance(exc, ModelValidationError):
                raise model_error(exc) from exc
            raise ValidationError(
                {"inventory_number": "Номер уже используется."}
            ) from exc
        return Response(
            {
                "id": str(instance.pk),
                "inventory_number": instance.inventory_number,
                "status": instance.status,
            },
            status=201,
        )


class ManagerInstanceView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def delete(self, request: Request, pk: int, instance_id: UUID) -> Response:
        product = owned_product(request, pk)
        editable_product(product)
        instance = get_object_or_404(
            ProductInstance, pk=instance_id, product=product, is_deleted=False
        )
        if instance.status != ProductInstance.Status.AVAILABLE:
            raise ValidationError(
                {"status": "Удалить можно только свободный экземпляр."}
            )
        instance.status = ProductInstance.Status.DELETED
        instance.is_deleted = True
        instance.save()
        cancel_excess_applications(product)
        return Response(status=204)


class ManagerInstanceSearchView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        require_manager(request)
        serializer = InstanceSearchSerializer(data=request.query_params)
        serializer.is_valid(raise_exception=True)
        instance = get_object_or_404(
            ProductInstance.objects.select_related("product"),
            manager=request.user,
            inventory_number=serializer.validated_data["inventory_number"],
            is_deleted=False,
        )
        return Response(
            {
                **manager_instance_data(instance),
                "product": {
                    "id": instance.product_id,
                    "name": instance.product.name,
                },
            }
        )


class ManagerMaintenanceStartView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request: Request, instance_id: UUID) -> Response:
        require_manager(request)
        get_object_or_404(
            ProductInstance,
            pk=instance_id,
            manager=request.user,
            is_deleted=False,
        )
        serializer = MaintenanceStartSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            maintenance = start_maintenance(
                instance_id=instance_id,
                manager=request.user,
                reason=serializer.validated_data["reason"],
            )
        except ModelValidationError as exc:
            raise model_error(exc) from exc
        return Response(maintenance_data(maintenance), status=201)


class ManagerMaintenanceCompleteView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request: Request, maintenance_id: int) -> Response:
        require_manager(request)
        get_object_or_404(
            Maintenance,
            pk=maintenance_id,
            instance__manager=request.user,
        )
        serializer = MaintenanceCompleteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            maintenance = complete_maintenance(
                maintenance_id=maintenance_id,
                manager=request.user,
                repair_cost=serializer.validated_data["repair_cost"],
                damage_description=serializer.validated_data.get(
                    "damage_description", ""
                ),
                images=serializer.validated_data.get("images", []),
            )
        except ModelValidationError as exc:
            raise model_error(exc) from exc
        return Response(maintenance_data(maintenance))


class MaintenancePhotoView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request: Request, photo_id: int) -> FileResponse:
        photo = get_object_or_404(
            MaintenancePhoto.objects.select_related("maintenance__instance"),
            pk=photo_id,
        )
        if (
            photo.maintenance.instance.manager_id != request.user.id
            and not request.user.is_staff
        ):
            raise PermissionDenied("Нет доступа к фотографии фотоакта.")
        content_type = mimetypes.guess_type(photo.image.name or "")[0]
        return FileResponse(
            photo.image.open("rb"),
            content_type=content_type or "image/jpeg",
        )


class ManagerSubmitView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request: Request, pk: int) -> Response:
        product = owned_product(request, pk)
        try:
            product = submit_product_for_moderation(product.pk)
        except ModelValidationError as exc:
            raise model_error(exc) from exc
        product = owned_product(request, product.pk)
        return Response(product_data(product))


class ManagerFreezeView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request: Request, pk: int) -> Response:
        product = owned_product(request, pk)
        if product.status != Product.Status.PUBLISHED:
            raise ValidationError({"status": "Заморозить можно опубликованный товар."})
        product.status = Product.Status.FROZEN
        try:
            product.save()
        except ModelValidationError as exc:
            raise model_error(exc) from exc
        cancel_waiting_for_product(
            product,
            "Товар заморожен менеджером и больше не принимает заявки.",
        )
        return Response(product_data(product))
