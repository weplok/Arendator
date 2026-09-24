"""Periodic expiry for waiting applications and active bookings."""

from applications.services import expire_due_bookings, expire_waiting_applications
from celery import shared_task


@shared_task
def expire_due_applications_and_bookings() -> dict[str, int]:
    expire_waiting_applications()
    return {"expired_bookings": expire_due_bookings()}
