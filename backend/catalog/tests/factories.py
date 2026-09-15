"""Small test-data helpers for catalog tests."""

from decimal import Decimal
from io import BytesIO
from typing import Any

from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image

from catalog.models import PickupPoint, Product, ProductInstance, ProductPhoto
from categories.models import Category
from users.models import User

TEST_PASSWORD = "Strong-test-pass-937!"


def make_png() -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (1, 1), color="white").save(buffer, format="PNG")
    return buffer.getvalue()


def create_manager(email: str = "manager@example.com") -> User:
    return User.objects.create_user(
        email=email,
        password=TEST_PASSWORD,
        name="Иван Петров",
        role=User.Role.MANAGER,
    )


def create_product(
    *,
    manager: User | None = None,
    status: str = Product.Status.DRAFT,
    name: str = "Перфоратор",
    **overrides: Any,
) -> Product:
    manager = manager or create_manager()
    category = overrides.pop("category", None) or Category.objects.create(
        name="Инструменты"
    )
    pickup_point = overrides.pop("pickup_point", None) or PickupPoint.objects.create(
        manager=manager,
        latitude=Decimal("55.751244"),
        longitude=Decimal("37.618423"),
        city="Москва",
        district="Тверской",
        full_address="Тверская улица, 1",
    )
    target_status = status
    product = Product.objects.create(
        manager=manager,
        category=category,
        pickup_point=pickup_point,
        name=name,
        description="Профессиональный инструмент для ремонта.",
        minute_rate=Decimal("1.25"),
        status=Product.Status.DRAFT,
        **overrides,
    )
    ProductInstance.objects.create(product=product, inventory_number="")
    ProductPhoto.objects.create(
        product=product,
        image=SimpleUploadedFile(
            f"{product.pk}.png",
            make_png(),
            content_type="image/png",
        ),
        is_primary=True,
    )
    if target_status != Product.Status.DRAFT:
        if target_status == Product.Status.REJECTED:
            product.status = Product.Status.ON_MODERATION
            product.save()
            product.status = Product.Status.REJECTED
            product.rejection_reason = "Причина отклонения"
            product.save()
        elif target_status == Product.Status.ON_MODERATION:
            product.status = Product.Status.ON_MODERATION
            product.save()
        else:
            product.status = Product.Status.ON_MODERATION
            product.save()
            product.status = Product.Status.PUBLISHED
            product.save()
            if target_status != Product.Status.PUBLISHED:
                product.status = target_status
                product.save()
    return product
