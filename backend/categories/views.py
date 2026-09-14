"""Public category API views."""

from django.db.models import F, Prefetch, QuerySet
from rest_framework.generics import ListAPIView
from rest_framework.permissions import AllowAny

from categories.models import Category, Characteristic, CharacteristicOption
from categories.serializers import CategorySerializer


class CategoryListView(ListAPIView):
    """Return the complete taxonomy for client-side tree rendering."""

    authentication_classes: list[type] = []
    permission_classes = [AllowAny]
    pagination_class = None
    serializer_class = CategorySerializer

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
