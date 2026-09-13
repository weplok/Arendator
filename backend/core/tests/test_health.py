"""Health-check endpoint tests."""

from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient


def test_health_check_is_public() -> None:
    response = APIClient().get(reverse("health-check"))

    assert response.status_code == status.HTTP_200_OK
    assert response.json() == {"status": "ok"}
