"""Infrastructure API views."""

from typing import Any

from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView


class HealthCheckView(APIView):
    """Return liveness status without requiring authentication."""

    authentication_classes: list[Any] = []
    permission_classes = [AllowAny]

    @extend_schema(
        responses={
            200: inline_serializer(
                name="HealthCheckResponse",
                fields={"status": serializers.CharField()},
            )
        }
    )
    def get(self, request: Request) -> Response:
        return Response({"status": "ok"})
