"""Manager-owned catalog mutations for the stage-four editor."""

from decimal import Decimal
from typing import Any
from uuid import UUID

from django.core.exceptions import ValidationError as ModelValidationError
from django.db import IntegrityError, transaction
from django.db.models import Count, Prefetch, Q
from django.shortcuts import get_object_or_404
from rest_framework import serializers, status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from catalog.models import PickupPoint, Product, ProductInstance, ProductPhoto
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
        "published_at": product.published_at,
        "pickup_point": manager_pickup_data(product.pickup_point),
        "photos": ProductPhotoSerializer(photos, many=True).data,
        "instances": [
            {
                "id": str(item.pk),
                "inventory_number": item.inventory_number,
                "status": item.status,
            }
            for item in instances
        ],
        "available_instances_count": sum(
            item.status == ProductInstance.Status.AVAILABLE for item in instances
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
    if product.status not in (Product.Status.DRAFT, Product.Status.PUBLISHED):
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
        if "category" in serializer.validated_data:
            raise ValidationError({"category": "Категорию менять нельзя."})
        for field, value in serializer.validated_data.items():
            setattr(product, field, value)
        try:
            product.save()
        except ModelValidationError as exc:
            raise model_error(exc) from exc
        return Response(product_data(product))


class ManagerPickupView(APIView):
    permission_classes = [IsAuthenticated]

    def put(self, request: Request, pk: int) -> Response:
        product = owned_product(request, pk)
        if product.status != Product.Status.DRAFT or product.published_at:
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
        return Response(status=204)


class ManagerPublishView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request: Request, pk: int) -> Response:
        with transaction.atomic():
            product = owned_product(request, pk)
            Product.objects.select_for_update().get(pk=product.pk)
            if product.status != Product.Status.DRAFT:
                raise ValidationError({"status": "Опубликовать можно только черновик."})
            if not product.pickup_point_id:
                raise ValidationError({"pickup_point": "Укажите точку самовывоза."})
            try:
                product.status = Product.Status.ON_MODERATION
                product.save()
                product.status = Product.Status.PUBLISHED
                product.save()
            except ModelValidationError as exc:
                raise model_error(exc) from exc
        return Response(product_data(product))


class ManagerFreezeView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request: Request, pk: int) -> Response:
        product = owned_product(request, pk)
        if product.status != Product.Status.PUBLISHED:
            raise ValidationError({"status": "Заморозить можно опубликованный товар."})
        product.status = Product.Status.FROZEN
        try:
            product.save()
        except ModelValidationError as exc:
            raise model_error(exc) from exc
        return Response(product_data(product))
