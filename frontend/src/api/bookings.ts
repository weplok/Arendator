import { z } from "zod";

import { getJson, postJson } from "./client";

const bookingStatusSchema = z.enum([
  "ACTIVE",
  "ARRIVED",
  "CANCELLED",
  "EXPIRED",
]);
const bookingEventSchema = z.object({
  event: z.enum(["CREATED", "ARRIVAL_CONFIRMED", "CANCELLED", "EXPIRED"]),
  actor: z.enum(["RENTER", "MANAGER", "SYSTEM"]),
  created_at: z.string(),
  note: z.string(),
});
const bookingPersonSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  avatar: z.string().nullable(),
});
const bookingProductSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  description: z.string(),
  minute_rate: z.string(),
  primary_photo: z.object({
    id: z.number().int(),
    url: z.string(),
    display_order: z.number().int(),
    is_primary: z.boolean(),
  }).nullable(),
  pickup_point: z.object({
    city: z.string(),
    district: z.string(),
    full_address: z.string().optional(),
    latitude: z.string().optional(),
    longitude: z.string().optional(),
    yandex_maps_url: z.string().url().optional(),
  }).nullable(),
  available_instances_count: z.number().int().nonnegative(),
  total_instances_count: z.number().int().nonnegative(),
});
const bookingInstanceSchema = z.object({
  id: z.string().uuid(),
  inventory_number: z.string(),
  instance_number: z.number().int().positive(),
  status: z.string(),
  status_label: z.string(),
});

export const rentalBookingSchema = z.object({
  id: z.number().int(),
  application_id: z.number().int(),
  status: bookingStatusSchema,
  pickup_deadline_at: z.string(),
  planned_return_at: z.string(),
  minute_rate_snapshot: z.string(),
  starting_price_snapshot: z.string(),
  arrival_confirmed_at: z.string().nullable(),
  cancellation_reason: z.string(),
  ended_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  product: bookingProductSchema,
  renter: bookingPersonSchema,
  manager: bookingPersonSchema,
  instance: bookingInstanceSchema.nullable(),
  history: z.array(bookingEventSchema),
});
const bookingPeriodSchema = z.enum(["today", "three", "all"]);
const managerBookingListSchema = z.object({
  period: bookingPeriodSchema,
  summary: z.object({
    today: z.number().int().nonnegative(),
    urgent: z.number().int().nonnegative(),
    three_days: z.number().int().nonnegative(),
  }),
  results: z.array(rentalBookingSchema),
});

export type RentalBooking = z.infer<typeof rentalBookingSchema>;
export type BookingPeriod = z.infer<typeof bookingPeriodSchema>;

export const RENTER_BOOKINGS_KEY = ["bookings", "renter"] as const;
export const MANAGER_BOOKINGS_KEY = ["bookings", "manager"] as const;

export async function getRenterBookings(): Promise<RentalBooking[]> {
  return z.array(rentalBookingSchema).parse(await getJson("/api/v1/bookings/"));
}

export async function getRenterBooking(bookingId: number): Promise<RentalBooking> {
  return rentalBookingSchema.parse(await getJson(`/api/v1/bookings/${bookingId}/`));
}

export async function cancelRenterBooking(
  bookingId: number,
  reason: string,
): Promise<RentalBooking> {
  return rentalBookingSchema.parse(await postJson(
    `/api/v1/bookings/${bookingId}/cancel/`,
    JSON.stringify({ reason }),
  ));
}

export async function getManagerBookings(period: BookingPeriod) {
  return managerBookingListSchema.parse(
    await getJson(`/api/v1/manager/bookings/?period=${period}`),
  );
}

export async function getManagerBooking(bookingId: number): Promise<RentalBooking> {
  return rentalBookingSchema.parse(
    await getJson(`/api/v1/manager/bookings/${bookingId}/`),
  );
}

export async function cancelManagerBooking(
  bookingId: number,
  reason: string,
): Promise<RentalBooking> {
  return rentalBookingSchema.parse(await postJson(
    `/api/v1/manager/bookings/${bookingId}/cancel/`,
    JSON.stringify({ reason }),
  ));
}

export async function confirmBookingArrival(
  bookingId: number,
): Promise<RentalBooking> {
  return rentalBookingSchema.parse(await postJson(
    `/api/v1/manager/bookings/${bookingId}/arrival/`,
  ));
}

export function parseCreatedBooking(payload: unknown): RentalBooking {
  return rentalBookingSchema.parse(payload);
}
