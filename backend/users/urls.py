"""Authentication API routes."""

from django.urls import path

from users.views import CsrfTokenView, CurrentUserView, LoginView, LogoutView
from users.views import RegistrationView

app_name = "users"

urlpatterns = [
    path("csrf/", CsrfTokenView.as_view(), name="csrf"),
    path("register/", RegistrationView.as_view(), name="register"),
    path("login/", LoginView.as_view(), name="login"),
    path("logout/", LogoutView.as_view(), name="logout"),
    path("me/", CurrentUserView.as_view(), name="current-user"),
]
