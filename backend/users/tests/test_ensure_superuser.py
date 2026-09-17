"""Tests for automatic initial administrator creation."""

from django.core.management import call_command
from django.core.management.base import CommandError
import pytest

from users.models import User

pytestmark = pytest.mark.django_db


def test_ensure_superuser_creates_once_without_resetting_password(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("DJANGO_SUPERUSER_EMAIL", "Admin@Example.com")
    monkeypatch.setenv("DJANGO_SUPERUSER_NAME", "Главный администратор")
    monkeypatch.setenv("DJANGO_SUPERUSER_PASSWORD", "a-strong-initial-password-74")

    call_command("ensure_superuser")

    user = User.objects.get(email="admin@example.com")
    assert user.name == "Главный администратор"
    assert user.role == User.Role.MANAGER
    assert user.is_staff and user.is_superuser
    assert user.check_password("a-strong-initial-password-74")

    monkeypatch.setenv("DJANGO_SUPERUSER_PASSWORD", "another-strong-password-86")
    call_command("ensure_superuser")

    assert User.objects.count() == 1
    user.refresh_from_db()
    assert user.check_password("a-strong-initial-password-74")


def test_ensure_superuser_rejects_existing_regular_user(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    User.objects.create_user(
        email="admin@example.com", name="Другой", password="existing-password-74"
    )
    monkeypatch.setenv("DJANGO_SUPERUSER_EMAIL", "admin@example.com")
    monkeypatch.setenv("DJANGO_SUPERUSER_PASSWORD", "a-strong-initial-password-74")

    with pytest.raises(CommandError, match="без прав суперпользователя"):
        call_command("ensure_superuser")

    assert User.objects.get(email="admin@example.com").is_superuser is False


def test_ensure_superuser_requires_credentials(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("DJANGO_SUPERUSER_EMAIL", raising=False)
    monkeypatch.delenv("DJANGO_SUPERUSER_PASSWORD", raising=False)

    with pytest.raises(CommandError, match="DJANGO_SUPERUSER_EMAIL"):
        call_command("ensure_superuser")

    assert not User.objects.exists()
