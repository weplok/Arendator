"""Transactional moderation commands shared by manager and Django admin flows."""

from django.core.exceptions import ValidationError as ModelValidationError
from django.db import transaction

from catalog.models import ModerationDecision, ModerationSettings, Product
from users.models import User


def submit_product_for_moderation(product_id: int) -> Product:
    """Submit a draft or rejected product and apply the current auto-mode."""
    with transaction.atomic():
        product = Product.objects.select_for_update().get(pk=product_id)
        if product.status == Product.Status.REJECTED:
            product.status = Product.Status.DRAFT
            product.rejection_reason = ""
            product.save()
        if product.status != Product.Status.DRAFT:
            raise ModelValidationError(
                {"status": "Отправить можно черновик или отклонённый товар."}
            )
        product.status = Product.Status.ON_MODERATION
        product.save()
        if ModerationSettings.load().auto_approve_new_submissions:
            return _approve_locked_product(product, decided_by=None, automatic=True)
        return product


def approve_product(product_id: int, decided_by: User) -> Product:
    """Approve one pending product and record the administrator decision."""
    with transaction.atomic():
        product = Product.objects.select_for_update().get(pk=product_id)
        return _approve_locked_product(
            product,
            decided_by=decided_by,
            automatic=False,
        )


def approve_all_pending_products(decided_by: User) -> int:
    """Approve the queue that exists when the confirmed command starts."""
    with transaction.atomic():
        products = list(
            Product.objects.select_for_update()
            .filter(status=Product.Status.ON_MODERATION)
            .order_by("pk")
        )
        for product in products:
            _approve_locked_product(
                product,
                decided_by=decided_by,
                automatic=False,
            )
        return len(products)


def reject_product(product_id: int, reason: str, decided_by: User) -> Product:
    """Reject one pending product with a required reason and audit record."""
    normalized_reason = reason.strip()
    if not normalized_reason:
        raise ModelValidationError({"reason": "Укажите причину отклонения."})
    with transaction.atomic():
        product = Product.objects.select_for_update().get(pk=product_id)
        _require_pending(product)
        product.status = Product.Status.REJECTED
        product.rejection_reason = normalized_reason
        product.save()
        _record_decision(
            product,
            ModerationDecision.Decision.REJECTED,
            decided_by=decided_by,
            reason=normalized_reason,
        )
        return product


def _approve_locked_product(
    product: Product,
    *,
    decided_by: User | None,
    automatic: bool,
) -> Product:
    _require_pending(product)
    product.status = Product.Status.PUBLISHED
    product.save()
    _record_decision(
        product,
        ModerationDecision.Decision.APPROVED,
        decided_by=decided_by,
        automatic=automatic,
    )
    return product


def _require_pending(product: Product) -> None:
    if product.status != Product.Status.ON_MODERATION:
        raise ModelValidationError(
            {"status": "Решение доступно только для товара на модерации."}
        )


def _record_decision(
    product: Product,
    decision: str,
    *,
    decided_by: User | None,
    reason: str = "",
    automatic: bool = False,
) -> None:
    ModerationDecision.objects.create(
        product=product,
        manager=product.manager,
        decided_by=decided_by,
        product_name=product.name,
        decision=decision,
        reason=reason,
        is_automatic=automatic,
    )
