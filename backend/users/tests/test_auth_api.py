"""Acceptance tests for cookie-session authentication."""

import base64
from collections.abc import Iterator, Mapping
from typing import Any

from django.conf import settings
from django.contrib.auth.hashers import check_password
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.urls import reverse
import pytest
from rest_framework import status
from rest_framework.test import APIClient

from users.models import User

pytestmark = pytest.mark.django_db

TEST_PASSWORD = "Strong-test-pass-937!"
ONE_PIXEL_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8A"
    "AQUBAScY42YAAAAASUVORK5CYII="
)


@pytest.fixture(autouse=True)
def clear_throttle_cache() -> Iterator[None]:
    cache.clear()
    yield
    cache.clear()


def csrf_client() -> tuple[APIClient, str]:
    client = APIClient(enforce_csrf_checks=True)
    response = client.get(reverse("users:csrf"))
    return client, response.cookies["csrftoken"].value


def register_user(
    client: APIClient,
    csrf_token: str,
    **overrides: Any,
) -> Any:
    payload = {
        "email": "renter@example.com",
        "password": TEST_PASSWORD,
        "name": "Анна Смирнова",
        "role": User.Role.RENTER,
        **overrides,
    }
    return client.post(
        reverse("users:register"),
        payload,
        format="json",
        HTTP_X_CSRFTOKEN=csrf_token,
    )


def create_renter(email: str = "renter@example.com") -> User:
    return User.objects.create_user(
        email=email,
        password=TEST_PASSWORD,
        name="Анна Смирнова",
        role=User.Role.RENTER,
    )


def test_csrf_endpoint_sets_cookie() -> None:
    client = APIClient(enforce_csrf_checks=True)

    response = client.get(reverse("users:csrf"))

    assert response.status_code == status.HTTP_204_NO_CONTENT
    assert response.cookies["csrftoken"].value


def test_registration_requires_valid_csrf_token() -> None:
    client = APIClient(enforce_csrf_checks=True)

    response = client.post(
        reverse("users:register"),
        {
            "email": "renter@example.com",
            "password": TEST_PASSWORD,
            "name": "Анна Смирнова",
            "role": User.Role.RENTER,
        },
        format="json",
    )

    assert response.status_code == status.HTTP_403_FORBIDDEN
    assert response.json() == {
        "code": "csrf_failed",
        "message": "CSRF-токен отсутствует или недействителен.",
        "field_errors": {},
    }


def test_registration_hashes_password_and_starts_session() -> None:
    client, csrf_token = csrf_client()

    response = register_user(client, csrf_token)

    created_user = User.objects.get(email="renter@example.com")
    assert response.status_code == status.HTTP_201_CREATED
    assert response.json() == {
        "email": "renter@example.com",
        "name": "Анна Смирнова",
        "role": User.Role.RENTER,
        "avatar": None,
    }
    assert check_password(TEST_PASSWORD, created_user.password)
    assert client.session["_auth_user_id"] == str(created_user.pk)


@override_settings(SESSION_COOKIE_SECURE=True)
def test_session_cookie_uses_production_security_attributes() -> None:
    client, csrf_token = csrf_client()

    response = register_user(client, csrf_token)

    session_cookie = response.cookies[settings.SESSION_COOKIE_NAME]
    assert session_cookie["httponly"] is True
    assert session_cookie["secure"] is True
    assert session_cookie["samesite"] == "Lax"


def test_registration_accepts_an_optional_avatar(tmp_path: Any) -> None:
    client, csrf_token = csrf_client()
    avatar = SimpleUploadedFile("avatar.png", ONE_PIXEL_PNG, content_type="image/png")

    with override_settings(MEDIA_ROOT=tmp_path):
        response = client.post(
            reverse("users:register"),
            {
                "email": "renter@example.com",
                "password": TEST_PASSWORD,
                "name": "Анна Смирнова",
                "role": User.Role.RENTER,
                "avatar": avatar,
            },
            format="multipart",
            HTTP_X_CSRFTOKEN=csrf_token,
        )

    assert response.status_code == status.HTTP_201_CREATED
    assert response.json()["avatar"].startswith("/media/avatars/")


def test_registration_rejects_duplicate_email_case_insensitively() -> None:
    create_renter()
    client, csrf_token = csrf_client()

    response = register_user(client, csrf_token, email="RENTER@EXAMPLE.COM")

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert response.json()["code"] == "validation_error"
    assert "email" in response.json()["field_errors"]


def test_registration_rejects_invalid_role() -> None:
    client, csrf_token = csrf_client()

    response = register_user(client, csrf_token, role="ADMIN")

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "role" in response.json()["field_errors"]


def test_registration_applies_django_password_validation() -> None:
    client, csrf_token = csrf_client()

    response = register_user(client, csrf_token, password="123")

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "password" in response.json()["field_errors"]
    assert not User.objects.exists()


def test_login_is_case_insensitive_and_preserves_current_user() -> None:
    user = create_renter()
    client, csrf_token = csrf_client()

    login_response = client.post(
        reverse("users:login"),
        {"email": "RENTER@EXAMPLE.COM", "password": TEST_PASSWORD},
        format="json",
        HTTP_X_CSRFTOKEN=csrf_token,
    )
    current_user_response = client.get(reverse("users:current-user"))

    assert login_response.status_code == status.HTTP_200_OK
    assert current_user_response.status_code == status.HTTP_200_OK
    assert current_user_response.json()["email"] == user.email


def test_login_uses_generic_error_for_invalid_credentials() -> None:
    create_renter()
    client, csrf_token = csrf_client()

    response = client.post(
        reverse("users:login"),
        {"email": "renter@example.com", "password": "wrong-password"},
        format="json",
        HTTP_X_CSRFTOKEN=csrf_token,
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert response.json() == {
        "code": "invalid_credentials",
        "message": "Неверный email или пароль.",
        "field_errors": {},
    }


def test_current_user_rejects_missing_or_expired_session() -> None:
    response = APIClient().get(reverse("users:current-user"))

    assert response.status_code == status.HTTP_401_UNAUTHORIZED
    assert response.json()["code"] == "not_authenticated"


def test_current_user_reports_the_service_admin_role() -> None:
    admin = User.objects.create_superuser(
        email="admin@example.com",
        password=TEST_PASSWORD,
        name="Администратор",
    )
    client = APIClient()
    client.force_login(admin)

    response = client.get(reverse("users:current-user"))

    assert response.status_code == status.HTTP_200_OK
    assert response.json()["role"] == "ADMIN"


def test_logout_requires_csrf_token() -> None:
    user = create_renter()
    client = APIClient(enforce_csrf_checks=True)
    client.force_login(user)

    response = client.post(reverse("users:logout"))

    assert response.status_code == status.HTTP_403_FORBIDDEN
    assert response.json()["code"] == "csrf_failed"


def test_logout_ends_server_session() -> None:
    user = create_renter()
    client, csrf_token = csrf_client()
    client.force_login(user)

    logout_response = client.post(
        reverse("users:logout"),
        HTTP_X_CSRFTOKEN=csrf_token,
    )
    current_user_response = client.get(reverse("users:current-user"))

    assert logout_response.status_code == status.HTTP_204_NO_CONTENT
    assert current_user_response.status_code == status.HTTP_401_UNAUTHORIZED
    assert not _has_authenticated_user(client.session)


def _has_authenticated_user(session: Mapping[str, Any]) -> bool:
    return "_auth_user_id" in session
