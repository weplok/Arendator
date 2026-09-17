"""Create the initial superuser once from environment variables."""

import os
from typing import Any

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.core.validators import validate_email

from users.models import User


class Command(BaseCommand):
    help = "Создать суперпользователя из переменных окружения, если его ещё нет."

    def handle(self, *args: Any, **options: Any) -> None:
        email = os.getenv("DJANGO_SUPERUSER_EMAIL", "").strip().lower()
        password = os.getenv("DJANGO_SUPERUSER_PASSWORD", "")
        name = os.getenv("DJANGO_SUPERUSER_NAME", "Администратор").strip()

        if not email or not password or not name:
            raise CommandError(
                "Укажите DJANGO_SUPERUSER_EMAIL, DJANGO_SUPERUSER_PASSWORD "
                "и непустое DJANGO_SUPERUSER_NAME."
            )
        try:
            validate_email(email)
        except ValidationError as exc:
            raise CommandError("DJANGO_SUPERUSER_EMAIL имеет неверный формат.") from exc

        existing = User.objects.filter(email__iexact=email).first()
        if existing is not None:
            if not existing.is_superuser or not existing.is_staff:
                raise CommandError(
                    "Пользователь с DJANGO_SUPERUSER_EMAIL уже существует "
                    "без прав суперпользователя."
                )
            self.stdout.write("Суперпользователь уже существует.")
            return

        try:
            validate_password(password)
        except ValidationError as exc:
            raise CommandError(
                "DJANGO_SUPERUSER_PASSWORD не соответствует требованиям "
                f"к паролю: {', '.join(exc.messages)}"
            ) from exc

        User.objects.create_superuser(
            email=email,
            password=password,
            name=name,
        )
        self.stdout.write(self.style.SUCCESS("Суперпользователь создан."))
