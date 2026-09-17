"""Public category API views."""

from django.db.models import F, Prefetch, QuerySet
from rest_framework.generics import ListAPIView
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from categories.models import Category, Characteristic, CharacteristicOption
from categories.serializers import CategorySerializer


class CategoryListView(ListAPIView):
    """Return the complete taxonomy for client-side tree rendering."""

    authentication_classes: list[type] = []
    permission_classes = [AllowAny]
    pagination_class = None
    serializer_class = CategorySerializer

    def list(self, request: object, *args: object, **kwargs: object) -> Response:
        categories = list(self.get_queryset())
        by_id = {category.pk: category for category in categories}
        applicable: dict[int, list[Characteristic]] = {}
        for category in categories:
            definitions: list[Characteristic] = []
            current: Category | None = category
            seen: set[int] = set()
            while current is not None and current.pk not in seen:
                seen.add(current.pk)
                definitions.extend(current.characteristics.all())
                current = by_id.get(current.parent_id) if current.parent_id else None
            applicable[category.pk] = sorted(
                definitions, key=lambda item: (item.display_order, item.pk)
            )
        context = self.get_serializer_context()
        context["applicable_characteristics"] = applicable
        return Response(
            self.get_serializer(categories, many=True, context=context).data
        )

    def get_queryset(self) -> QuerySet[Category]:
        option_queryset = CharacteristicOption.objects.order_by(
            "display_order",
            "id",
        )
        characteristic_queryset = Characteristic.objects.order_by(
            "display_order",
            "id",
        ).prefetch_related(
            Prefetch("options", queryset=option_queryset),
        )
        return Category.objects.order_by(
            F("parent_id").asc(nulls_first=True),
            "name",
            "id",
        ).prefetch_related(
            Prefetch("characteristics", queryset=characteristic_queryset),
        )
