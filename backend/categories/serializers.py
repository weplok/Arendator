"""Read serializers for the public category taxonomy."""

from typing import Any, cast

from rest_framework import serializers

from categories.models import Category, Characteristic, CharacteristicOption


class CharacteristicOptionSerializer(serializers.ModelSerializer):
    class Meta:
        model = CharacteristicOption
        fields = ("id", "value", "display_order")


class CharacteristicSerializer(serializers.ModelSerializer):
    category_id = serializers.IntegerField(read_only=True)
    options = CharacteristicOptionSerializer(many=True, read_only=True)

    class Meta:
        model = Characteristic
        fields = (
            "id",
            "category_id",
            "name",
            "type",
            "is_required",
            "unit",
            "display_order",
            "options",
        )


class CategorySerializer(serializers.ModelSerializer):
    parent_id = serializers.IntegerField(allow_null=True, read_only=True)
    characteristics = serializers.SerializerMethodField()

    class Meta:
        model = Category
        fields = ("id", "name", "parent_id", "characteristics")

    def get_characteristics(self, category: Category) -> list[dict[str, Any]]:
        definitions = self.context["applicable_characteristics"][category.pk]
        return cast(
            list[dict[str, Any]],
            CharacteristicSerializer(definitions, many=True).data,
        )
