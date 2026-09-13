"""Custom user model tests."""

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
import pytest

from users.models import User

pytestmark = pytest.mark.django_db


def test_email_is_the_user_identifier() -> None:
    assert User.USERNAME_FIELD == "email"
    assert "username" not in {field.name for field in User._meta.get_fields()}


def test_manager_normalizes_email_and_finds_it_case_insensitively() -> None:
    created_user = User.objects.create_user(
        email="RENTER@Example.COM",
        password="safe-test-password",
        name="Арендатор",
        role=User.Role.RENTER,
    )

    found_user = User.objects.get_by_natural_key("renter@EXAMPLE.com")

    assert created_user.email == "renter@example.com"
    assert found_user == created_user


def test_role_cannot_be_changed() -> None:
    user = User.objects.create_user(
        email="renter@example.com",
        password="safe-test-password",
        name="Арендатор",
        role=User.Role.RENTER,
    )

    user.role = User.Role.MANAGER

    with pytest.raises(ValidationError, match="Роль нельзя изменить"):
        user.save()


def test_email_cannot_be_changed() -> None:
    user_model = get_user_model()
    user = user_model.objects.create_user(
        email="renter@example.com",
        password="safe-test-password",
        name="Арендатор",
        role=User.Role.RENTER,
    )

    user.email = "other@example.com"

    with pytest.raises(ValidationError, match="Email нельзя изменить"):
        user.save()
