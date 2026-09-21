"""Consistent error responses for the REST API."""

from collections.abc import Mapping, Sequence
from typing import Any

from django.http import HttpRequest, JsonResponse
from rest_framework.exceptions import ErrorDetail, ValidationError
from rest_framework.response import Response
from rest_framework.views import exception_handler

ERROR_CODES_BY_STATUS = {
    401: "not_authenticated",
    403: "permission_denied",
    404: "not_found",
    405: "method_not_allowed",
    429: "throttled",
}


def api_exception_handler(exc: Exception, context: dict[str, Any]) -> Response | None:
    """Wrap DRF errors in the public API error contract."""
    response = exception_handler(exc, context)
    if response is None:
        return None

    code = _get_error_code(exc, response.status_code)
    message = _get_error_message(response.data, response.status_code)
    field_errors = _get_field_errors(exc, response.data)
    response.data = {
        "code": code,
        "message": message,
        "field_errors": field_errors,
    }
    return response


def csrf_failure(request: HttpRequest, reason: str = "") -> JsonResponse:
    """Return the same JSON shape when Django rejects a CSRF token."""
    return JsonResponse(
        {
            "code": "csrf_failed",
            "message": "CSRF-токен отсутствует или недействителен.",
            "field_errors": {},
        },
        status=403,
    )


def _get_error_code(exc: Exception, status_code: int) -> str:
    if isinstance(exc, ValidationError):
        return "validation_error"
    default_code = getattr(exc, "default_code", None)
    if isinstance(default_code, str):
        return default_code
    return ERROR_CODES_BY_STATUS.get(status_code, "api_error")


def _get_error_message(data: Any, status_code: int) -> str:
    if isinstance(data, Mapping) and "detail" in data:
        return str(data["detail"])
    if status_code == 400:
        return "Проверьте введённые данные."
    return "Не удалось выполнить запрос."


def _get_field_errors(exc: Exception, data: Any) -> dict[str, list[str]]:
    if not isinstance(data, Mapping):
        return {}
    return {
        str(field): _stringify_error_messages(messages)
        for field, messages in data.items()
        if field != "detail"
    }


def _stringify_error_messages(messages: Any) -> list[str]:
    if isinstance(messages, (str, ErrorDetail)):
        return [str(messages)]
    if isinstance(messages, Mapping):
        return [str(message) for message in messages.values()]
    if isinstance(messages, Sequence):
        return [str(message) for message in messages]
    return [str(messages)]
