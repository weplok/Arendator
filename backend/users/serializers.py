"""Serialization and validation for user authentication."""

from typing import Any, cast

from django.contrib.auth import authenticate, password_validation
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from rest_framework import serializers, status
from rest_framework.exceptions import APIException

from users.models import User


class CurrentUserSerializer(serializers.ModelSerializer[User]):
    """Expose the signed-in user's editable account data."""

    avatar = serializers.SerializerMethodField()
    role = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ("email", "name", "role", "avatar")

    def get_avatar(self, user: User) -> str | None:
        if not user.avatar:
            return None
        return user.avatar.url

    def get_role(self, user: User) -> str:
        if user.is_superuser:
            return "ADMIN"
        return user.role


class RegistrationSerializer(serializers.ModelSerializer[User]):
    """Validate and create an ordinary renter or manager account."""

    password = serializers.CharField(
        write_only=True,
        trim_whitespace=False,
        style={"input_type": "password"},
    )

    class Meta:
        model = User
        fields = ("email", "password", "name", "role", "avatar")
        extra_kwargs = {"avatar": {"required": False}}

    def validate_email(self, value: str) -> str:
        normalized_email = User.objects.normalize_email(value).lower()
        if User.objects.filter(email__iexact=normalized_email).exists():
            raise serializers.ValidationError(
                "Пользователь с таким email уже зарегистрирован."
            )
        return normalized_email

    def validate_avatar(self, value: Any) -> Any:
        if value.size > 15 * 1024 * 1024:
            raise serializers.ValidationError(
                "Размер изображения не должен превышать 15 МБ."
            )
        image_format = getattr(getattr(value, "image", None), "format", "")
        if image_format.upper() not in {"JPEG", "PNG", "WEBP"}:
            raise serializers.ValidationError(
                "Поддерживаются только изображения JPEG, PNG и WebP."
            )
        return value

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        candidate = User(
            email=attrs.get("email", ""),
            name=attrs.get("name", ""),
            role=attrs.get("role", ""),
        )
        password = cast(str, attrs["password"])
        try:
            password_validation.validate_password(password, candidate)
        except DjangoValidationError as exc:
            raise serializers.ValidationError({"password": exc.messages}) from exc
        return attrs

    def create(self, validated_data: dict[str, Any]) -> User:
        password = validated_data.pop("password")
        try:
            with transaction.atomic():
                return User.objects.create_user(password=password, **validated_data)
        except IntegrityError as exc:
            raise serializers.ValidationError(
                {"email": "Пользователь с таким email уже зарегистрирован."}
            ) from exc


class LoginSerializer(serializers.Serializer[dict[str, Any]]):
    """Validate credentials without revealing which value was incorrect."""

    email = serializers.EmailField()
    password = serializers.CharField(
        write_only=True,
        trim_whitespace=False,
        style={"input_type": "password"},
    )

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        request = self.context.get("request")
        user = authenticate(
            request=request,
            username=attrs.get("email", ""),
            password=attrs.get("password", ""),
        )
        if user is None:
            raise InvalidCredentialsError()
        attrs["user"] = user
        return attrs


class InvalidCredentialsError(APIException):
    status_code = status.HTTP_400_BAD_REQUEST
    default_code = "invalid_credentials"
    default_detail = "Неверный email или пароль."
