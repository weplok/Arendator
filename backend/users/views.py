"""Cookie-session authentication API views."""

from typing import cast

from django.contrib.auth import login, logout
from django.middleware.csrf import get_token
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from users.models import User
from users.serializers import (
    CurrentUserSerializer,
    LoginSerializer,
    RegistrationSerializer,
)


@method_decorator(ensure_csrf_cookie, name="dispatch")
class CsrfTokenView(APIView):
    """Initialize the CSRF cookie before a state-changing request."""

    authentication_classes: list[type] = []
    permission_classes = [AllowAny]

    @extend_schema(responses={204: None})
    def get(self, request: Request) -> Response:
        get_token(request)
        return Response(status=status.HTTP_204_NO_CONTENT)


@method_decorator(csrf_protect, name="dispatch")
class RegistrationView(APIView):
    """Create an account and start its Django session."""

    authentication_classes: list[type] = []
    permission_classes = [AllowAny]
    parser_classes = [JSONParser, FormParser, MultiPartParser]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth_register"

    @extend_schema(
        request=RegistrationSerializer,
        responses={201: CurrentUserSerializer},
    )
    def post(self, request: Request) -> Response:
        serializer = RegistrationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        login(request, user, backend="django.contrib.auth.backends.ModelBackend")
        response_data = CurrentUserSerializer(user, context={"request": request}).data
        return Response(response_data, status=status.HTTP_201_CREATED)


@method_decorator(csrf_protect, name="dispatch")
class LoginView(APIView):
    """Authenticate credentials and rotate the Django session key."""

    authentication_classes: list[type] = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth_login"

    @extend_schema(request=LoginSerializer, responses={200: CurrentUserSerializer})
    def post(self, request: Request) -> Response:
        serializer = LoginSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        user = cast(User, serializer.validated_data["user"])
        login(request, user)
        response_data = CurrentUserSerializer(user, context={"request": request}).data
        return Response(response_data)


class CurrentUserView(APIView):
    """Return the account attached to the current session."""

    permission_classes = [IsAuthenticated]

    @extend_schema(responses={200: CurrentUserSerializer})
    def get(self, request: Request) -> Response:
        user = cast(User, request.user)
        return Response(CurrentUserSerializer(user, context={"request": request}).data)


@method_decorator(csrf_protect, name="dispatch")
class LogoutView(APIView):
    """Destroy the active server-side session."""

    permission_classes = [IsAuthenticated]

    @extend_schema(request=None, responses={204: None})
    def post(self, request: Request) -> Response:
        logout(request)
        return Response(status=status.HTTP_204_NO_CONTENT)
