"""Authenticated notification REST endpoints."""

from django.shortcuts import get_object_or_404
from django.utils import timezone
from notifications.models import Notification, NotificationSettings
from notifications.serializers import (
    NotificationIdsSerializer,
    NotificationSerializer,
    NotificationSettingsSerializer,
)
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView


def unread_count(user_id: int) -> int:
    return Notification.objects.filter(
        recipient_id=user_id,
        read_at__isnull=True,
    ).count()


class NotificationListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        notifications = Notification.objects.filter(recipient=request.user)
        return Response(
            {
                "unread_count": unread_count(request.user.pk),
                "results": NotificationSerializer(notifications, many=True).data,
            }
        )


class NotificationDeleteView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request: Request, pk: int) -> Response:
        notification = get_object_or_404(
            Notification,
            pk=pk,
            recipient=request.user,
        )
        notification.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class NotificationReadAllView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request: Request) -> Response:
        updated = Notification.objects.filter(
            recipient=request.user,
            read_at__isnull=True,
        ).update(read_at=timezone.now())
        return Response({"updated": updated, "unread_count": 0})


class NotificationReadView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request: Request) -> Response:
        serializer = NotificationIdsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        updated = Notification.objects.filter(
            recipient=request.user,
            pk__in=serializer.validated_data["ids"],
            read_at__isnull=True,
        ).update(read_at=timezone.now())
        return Response(
            {
                "updated": updated,
                "unread_count": unread_count(request.user.pk),
            }
        )


class NotificationSettingsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        settings, _ = NotificationSettings.objects.get_or_create(user=request.user)
        return Response(
            NotificationSettingsSerializer(settings, context={"request": request}).data
        )

    def patch(self, request: Request) -> Response:
        settings, _ = NotificationSettings.objects.get_or_create(user=request.user)
        serializer = NotificationSettingsSerializer(
            settings,
            data=request.data,
            partial=True,
            context={"request": request},
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)
