"""Read serializers for the public product catalog."""

from typing import Any, cast

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from catalog.models import PickupPoint, Product, ProductPhoto
from categories.models import Category
from users.models import User


class PublicManagerSerializer(serializers.ModelSerializer[User]):
    avatar = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ("id", "name", "avatar")

    def get_avatar(self, manager: User) -> str | None:
        if not manager.avatar:
            return None
        return manager.avatar.url


class ManagerProfileSerializer(PublicManagerSerializer):
    active_products_count = serializers.IntegerField(read_only=True)
    frozen_products_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = User
        fields = (
            "id",
            "name",
            "avatar",
            "active_products_count",
            "frozen_products_count",
        )


class ProductCategorySerializer(serializers.ModelSerializer[Category]):
    class Meta:
        model = Category
        fields = ("id", "name")


class PickupPointSerializer(serializers.ModelSerializer[PickupPoint]):
    yandex_maps_url = serializers.SerializerMethodField()

    class Meta:
        model = PickupPoint
        fields = (
            "city",
            "district",
            "full_address",
            "latitude",
            "longitude",
            "yandex_maps_url",
        )

    def get_yandex_maps_url(self, pickup_point: PickupPoint) -> str:
        return (
            "https://yandex.ru/maps/?pt="
            f"{pickup_point.longitude},{pickup_point.latitude}&z=16&l=map"
        )

    def to_representation(self, instance: PickupPoint) -> dict[str, Any]:
        representation = cast(dict[str, Any], super().to_representation(instance))
        request = self.context.get("request")
        if request is None or not request.user.is_authenticated:
            for private_field in (
                "full_address",
                "latitude",
                "longitude",
                "yandex_maps_url",
            ):
                representation.pop(private_field, None)
        return representation


class ProductPhotoSerializer(serializers.ModelSerializer[ProductPhoto]):
    url = serializers.SerializerMethodField()

    class Meta:
        model = ProductPhoto
        fields = ("id", "url", "display_order", "is_primary")

    def get_url(self, photo: ProductPhoto) -> str:
        return photo.image.url


class ProductSummarySerializer(serializers.ModelSerializer[Product]):
    category = ProductCategorySerializer(read_only=True)
    manager = PublicManagerSerializer(read_only=True)
    pickup_point = PickupPointSerializer(read_only=True)
    primary_photo = serializers.SerializerMethodField()
    available_instances_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Product
        fields = (
            "id",
            "name",
            "minute_rate",
            "status",
            "category",
            "manager",
            "pickup_point",
            "primary_photo",
            "available_instances_count",
        )

    @extend_schema_field(ProductPhotoSerializer(allow_null=True))
    def get_primary_photo(self, product: Product) -> dict[str, Any] | None:
        photos = getattr(product, "catalog_photos", ())
        if not photos:
            return None
        primary_photo = next((photo for photo in photos if photo.is_primary), photos[0])
        return cast(
            dict[str, Any],
            ProductPhotoSerializer(primary_photo, context=self.context).data,
        )


class ProductDetailSerializer(ProductSummarySerializer):
    photos = serializers.SerializerMethodField()

    class Meta:
        model = Product
        fields = (
            "id",
            "name",
            "minute_rate",
            "status",
            "category",
            "manager",
            "pickup_point",
            "primary_photo",
            "available_instances_count",
            "description",
            "photos",
            "created_at",
            "published_at",
        )

    @extend_schema_field(ProductPhotoSerializer(many=True))
    def get_photos(self, product: Product) -> list[dict[str, Any]]:
        photos = getattr(product, "catalog_photos", ())
        return cast(
            list[dict[str, Any]],
            ProductPhotoSerializer(
                photos,
                many=True,
                context=self.context,
            ).data,
        )
