"""Read serializers for the public category taxonomy."""

from rest_framework import serializers

from categories.models import Category, Characteristic, CharacteristicOption


class CharacteristicOptionSerializer(serializers.ModelSerializer):
    class Meta:
        model = CharacteristicOption
        fields = ("id", "value", "display_order")


class CharacteristicSerializer(serializers.ModelSerializer):
    options = CharacteristicOptionSerializer(many=True, read_only=True)

    class Meta:
        model = Characteristic
        fields = (
            "id",
            "name",
            "type",
            "is_required",
            "unit",
            "display_order",
            "options",
        )


class CategorySerializer(serializers.ModelSerializer):
    parent_id = serializers.IntegerField(allow_null=True, read_only=True)
    characteristics = CharacteristicSerializer(many=True, read_only=True)

    class Meta:
        model = Category
        fields = ("id", "name", "parent_id", "characteristics")
