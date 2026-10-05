"""Manager analytics API."""

from analytics.periods import parse_period
from analytics.services import build_manager_analytics
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from users.models import User


class ManagerAnalyticsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        if request.user.role != User.Role.MANAGER or request.user.is_superuser:
            raise PermissionDenied("Доступно только менеджеру.")
        now = timezone.now()
        period = parse_period(request.query_params, now=now)
        return Response(build_manager_analytics(request.user, period, now=now))
