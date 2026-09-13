"""Custom user model used from the first project migration."""

from typing import Any

from django.contrib.auth.base_user import AbstractBaseUser
from django.contrib.auth.models import PermissionsMixin
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models.functions import Lower
from django.utils import timezone

from users.managers import UserManager


class User(AbstractBaseUser, PermissionsMixin):
    class Role(models.TextChoices):
        RENTER = "RENTER", "Арендатор"
        MANAGER = "MANAGER", "Менеджер"

    email = models.EmailField("email", unique=True)
    name = models.CharField("имя", max_length=150)
    avatar = models.ImageField("аватар", upload_to="avatars/", blank=True)
    role = models.CharField("роль", max_length=16, choices=Role.choices)
    is_staff = models.BooleanField("статус персонала", default=False)
    is_active = models.BooleanField("активен", default=True)
    date_joined = models.DateTimeField("дата регистрации", default=timezone.now)

    objects = UserManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["name", "role"]

    class Meta:
        verbose_name = "пользователь"
        verbose_name_plural = "пользователи"
        constraints = [
            models.CheckConstraint(
                condition=models.Q(role__in=["RENTER", "MANAGER"]),
                name="users_user_valid_role",
            ),
            models.UniqueConstraint(
                Lower("email"),
                name="users_user_email_ci_unique",
            ),
        ]

    def save(self, *args: Any, **kwargs: Any) -> None:
        self.email = self.__class__.objects.normalize_email(self.email).lower()
        if self.role not in self.Role.values:
            raise ValidationError({"role": "Недопустимая роль пользователя."})

        if self.pk:
            original = self.__class__.objects.only("email", "role").get(pk=self.pk)
            errors: dict[str, str] = {}
            if self.email != original.email:
                errors["email"] = "Email нельзя изменить в первой версии."
            if self.role != original.role:
                errors["role"] = "Роль нельзя изменить в первой версии."
            if errors:
                raise ValidationError(errors)

        super().save(*args, **kwargs)

    def __str__(self) -> str:
        return self.email
