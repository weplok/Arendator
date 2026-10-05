"""Small presentation-only filters for analytics templates."""

from decimal import Decimal, InvalidOperation
from typing import Any

from django import template

register = template.Library()


@register.filter
def get_item(mapping: dict[str, Any], key: str) -> Any:
    return mapping.get(key, 0)


@register.filter
def sum_counts(items: list[dict[str, Any]]) -> int:
    return sum(int(item.get("count", 0)) for item in items)


@register.filter
def rubles(value: object) -> str:
    try:
        formatted = f"{Decimal(str(value)):,.2f}".replace(",", " ").replace(".", ",")
    except InvalidOperation, ValueError:
        return str(value)
    return formatted.removesuffix(",00")
