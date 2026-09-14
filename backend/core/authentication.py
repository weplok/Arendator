"""Authentication policies shared by the REST API."""

from drf_spectacular.extensions import OpenApiAuthenticationExtension
from rest_framework.authentication import SessionAuthentication


class CookieSessionAuthentication(SessionAuthentication):
    """Use Django sessions while returning HTTP 401 for anonymous requests."""

    def authenticate_header(self, request: object) -> str:
        return "Session"


class CookieSessionAuthenticationScheme(OpenApiAuthenticationExtension):
    target_class = "core.authentication.CookieSessionAuthentication"
    name = "cookieAuth"

    def get_security_definition(self, auto_schema: object) -> dict[str, str]:
        return {"type": "apiKey", "in": "cookie", "name": "sessionid"}
