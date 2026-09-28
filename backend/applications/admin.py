"""Administrative inspection of bookings, rentals, and photo acts."""

from applications.models import (
    HandoverAct,
    HandoverPhoto,
    Rental,
    RentalBooking,
    ReturnAct,
    ReturnPhoto,
)
from django.contrib import admin


@admin.register(RentalBooking)
class RentalBookingAdmin(admin.ModelAdmin):
    list_display = ("id", "application", "instance", "status", "created_at")
    list_filter = ("status",)
    readonly_fields = ("created_at", "updated_at")


class HandoverPhotoInline(admin.TabularInline):
    model = HandoverPhoto
    extra = 0
    readonly_fields = ("author", "author_role", "image", "created_at")


@admin.register(HandoverAct)
class HandoverActAdmin(admin.ModelAdmin):
    list_display = (
        "booking",
        "renter_completed_at",
        "manager_completed_at",
        "renter_confirmed_at",
        "manager_confirmed_at",
    )
    readonly_fields = ("created_at", "updated_at")
    inlines = (HandoverPhotoInline,)


@admin.register(Rental)
class RentalAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "booking",
        "status",
        "rental_started_at",
        "planned_return_at",
        "ended_at",
    )
    list_filter = ("status",)
    readonly_fields = ("created_at", "updated_at")


class ReturnPhotoInline(admin.TabularInline):
    model = ReturnPhoto
    extra = 0
    readonly_fields = ("author", "author_role", "image", "created_at")


@admin.register(ReturnAct)
class ReturnActAdmin(admin.ModelAdmin):
    list_display = (
        "rental",
        "renter_completed_at",
        "manager_completed_at",
        "damage_decision",
        "next_instance_status",
    )
    readonly_fields = ("created_at", "updated_at")
    inlines = (ReturnPhotoInline,)
