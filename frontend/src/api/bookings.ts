import { z } from "zod";

import { getJson, mutateJson, postJson } from "./client";

const bookingStatusSchema = z.enum([
  "ACTIVE",
  "ARRIVED",
  "RENTED",
  "CANCELLED",
  "EXPIRED",
]);
const bookingEventSchema = z.object({
  event: z.enum([
    "CREATED",
    "ARRIVAL_CONFIRMED",
    "MATERIALS_COMPLETED",
    "CHANGES_REQUESTED",
    "HANDOVER_CONFIRMED",
    "RENTAL_STARTED",
    "CANCELLED",
    "EXPIRED",
  ]),
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

const handoverPhotoSchema = z.object({
  id: z.number().int(),
  url: z.string(),
  created_at: z.string(),
});
const handoverPartySchema = z.object({
  role: z.enum(["RENTER", "MANAGER"]),
  name: z.string(),
  avatar: z.string().nullable(),
  comment: z.string(),
  photos: z.array(handoverPhotoSchema),
  is_completed: z.boolean(),
  completed_at: z.string().nullable(),
  is_confirmed: z.boolean(),
  confirmed_at: z.string().nullable(),
});
const handoverActSchema = z.object({
  id: z.number().int(),
  renter: handoverPartySchema,
  manager: handoverPartySchema,
  can_review: z.boolean(),
  updated_at: z.string(),
});
const returnActSchema = z.object({
  id: z.number().int(),
  renter: handoverPartySchema,
  manager: handoverPartySchema,
  can_review: z.boolean(),
  manager_amount_only: z.boolean(),
  late_surcharge_waived: z.boolean(),
  late_surcharge_waiver_reason: z.string(),
  late_surcharge_waived_at: z.string().nullable(),
  damage_enabled: z.boolean(),
  damage_description: z.string(),
  damage_amount: z.string(),
  damage_decision: z.enum(["NONE", "PENDING", "ACCEPTED", "REJECTED"]),
  next_instance_status: z.enum(["AVAILABLE", "MAINTENANCE", ""]),
  maintenance_reason: z.string().default(""),
  updated_at: z.string(),
});
const rentalEventSchema = z.object({
  event: z.string(),
  actor: z.enum(["RENTER", "MANAGER", "SYSTEM"]),
  created_at: z.string(),
  note: z.string(),
});
export const rentalSchema = z.object({
  id: z.number().int(),
  booking_id: z.number().int(),
  status: z.enum(["ACTIVE", "OVERDUE", "RETURN_INSPECTION", "COMPLETED"]),
  minute_rate_snapshot: z.string(),
  starting_price_snapshot: z.string(),
  planned_return_at: z.string(),
  rental_started_at: z.string(),
  return_received_at: z.string().nullable(),
  ended_at: z.string().nullable(),
  calculated_at: z.string(),
  duration_minutes: z.number().int().nonnegative(),
  timely_minutes: z.number().int().nonnegative(),
  late_minutes: z.number().int().nonnegative(),
  timely_cost: z.string(),
  late_base_cost: z.string(),
  late_surcharge: z.string(),
  late_surcharge_waived: z.boolean(),
  late_cost: z.string(),
  damage_amount: z.string(),
  current_cost: z.string(),
  return_act: returnActSchema.nullable(),
  history: z.array(rentalEventSchema),
  waiting_applications: z.array(z.object({
    id: z.number().int(),
    renter_name: z.string(),
    pickup_deadline_at: z.string(),
  })),
  product: bookingProductSchema,
  renter: bookingPersonSchema,
  manager: bookingPersonSchema,
  instance: bookingInstanceSchema.nullable(),
});

export const rentalBookingSchema = z.object({
  id: z.number().int(),
  application_id: z.number().int(),
  application_created_at: z.string().optional(),
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
  handover: handoverActSchema.nullish().default(null),
  rental: rentalSchema.nullish().default(null),
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
export type HandoverParty = z.infer<typeof handoverPartySchema>;
export type Rental = z.infer<typeof rentalSchema>;
export type ReturnAct = z.infer<typeof returnActSchema>;
export type ReturnParty = z.infer<typeof handoverPartySchema>;
export type BookingPeriod = z.infer<typeof bookingPeriodSchema>;

export const RENTER_BOOKINGS_KEY = ["bookings", "renter"] as const;
export const MANAGER_BOOKINGS_KEY = ["bookings", "manager"] as const;
export const RENTER_ACTIVITY_KEY = ["activity", "renter"] as const;
export const RENTALS_KEY = ["rentals"] as const;

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

export async function uploadHandoverPhoto(
  bookingId: number,
  file: File,
): Promise<z.infer<typeof handoverPhotoSchema>> {
  const body = new FormData();
  body.append("image", file);
  return handoverPhotoSchema.parse(await postJson(
    `/api/v1/bookings/${bookingId}/handover/photos/`,
    body,
  ));
}

export async function deleteHandoverPhoto(
  bookingId: number,
  photoId: number,
): Promise<void> {
  await mutateJson(
    `/api/v1/bookings/${bookingId}/handover/photos/${photoId}/`,
    "DELETE",
  );
}

export async function saveHandoverComment(
  bookingId: number,
  comment: string,
): Promise<RentalBooking> {
  return rentalBookingSchema.parse(await mutateJson(
    `/api/v1/bookings/${bookingId}/handover/materials/`,
    "PATCH",
    JSON.stringify({ comment }),
  ));
}

export async function completeHandover(bookingId: number): Promise<RentalBooking> {
  return rentalBookingSchema.parse(await postJson(
    `/api/v1/bookings/${bookingId}/handover/complete/`,
  ));
}

export async function confirmHandover(bookingId: number): Promise<RentalBooking> {
  return rentalBookingSchema.parse(await postJson(
    `/api/v1/bookings/${bookingId}/handover/confirm/`,
  ));
}

export async function requestHandoverChanges(
  bookingId: number,
): Promise<RentalBooking> {
  return rentalBookingSchema.parse(await postJson(
    `/api/v1/bookings/${bookingId}/handover/request-changes/`,
  ));
}

const activitySchema = z.object({
  handover: rentalBookingSchema.nullable(),
  rental: rentalSchema.nullable(),
});

export async function getRenterActivity() {
  return activitySchema.parse(await getJson("/api/v1/activity/"));
}

export async function getRentals(): Promise<Rental[]> {
  return z.array(rentalSchema).parse(await getJson("/api/v1/rentals/"));
}

export async function getRental(rentalId: number): Promise<Rental> {
  return rentalSchema.parse(await getJson(`/api/v1/rentals/${rentalId}/`));
}

export async function receiveRentalReturn(rentalId: number): Promise<Rental> {
  return rentalSchema.parse(await postJson(
    `/api/v1/manager/rentals/${rentalId}/return/receive/`,
  ));
}

export async function uploadReturnPhoto(
  rentalId: number,
  file: File,
): Promise<z.infer<typeof handoverPhotoSchema>> {
  const body = new FormData();
  body.append("image", file);
  return handoverPhotoSchema.parse(await postJson(
    `/api/v1/rentals/${rentalId}/return/photos/`,
    body,
  ));
}

export async function deleteReturnPhoto(
  rentalId: number,
  photoId: number,
): Promise<void> {
  await mutateJson(
    `/api/v1/rentals/${rentalId}/return/photos/${photoId}/`,
    "DELETE",
  );
}

export async function saveReturnComment(
  rentalId: number,
  comment: string,
): Promise<Rental> {
  return rentalSchema.parse(await mutateJson(
    `/api/v1/rentals/${rentalId}/return/materials/`,
    "PATCH",
    JSON.stringify({ comment }),
  ));
}

export interface ReturnFinancials {
  late_surcharge_waived?: boolean;
  late_surcharge_waiver_reason?: string;
  damage_enabled?: boolean;
  damage_description?: string;
  damage_amount?: string;
}

export async function saveReturnFinancials(
  rentalId: number,
  financials: ReturnFinancials,
): Promise<Rental> {
  return rentalSchema.parse(await mutateJson(
    `/api/v1/rentals/${rentalId}/return/financials/`,
    "PATCH",
    JSON.stringify(financials),
  ));
}

export async function completeReturnMaterials(rentalId: number): Promise<Rental> {
  return rentalSchema.parse(await postJson(
    `/api/v1/rentals/${rentalId}/return/complete/`,
  ));
}

export async function requestReturnChanges(rentalId: number): Promise<Rental> {
  return rentalSchema.parse(await postJson(
    `/api/v1/rentals/${rentalId}/return/request-changes/`,
  ));
}

export async function decideReturnDamage(
  rentalId: number,
  accepted: boolean,
): Promise<Rental> {
  return rentalSchema.parse(await postJson(
    `/api/v1/rentals/${rentalId}/return/damage-decision/`,
    JSON.stringify({ accepted }),
  ));
}

export async function confirmReturn(rentalId: number): Promise<Rental> {
  return rentalSchema.parse(await postJson(
    `/api/v1/rentals/${rentalId}/return/confirm/`,
  ));
}

export async function finishReturn(
  rentalId: number,
  nextInstanceStatus: "AVAILABLE" | "MAINTENANCE",
  maintenanceReason = "",
): Promise<Rental> {
  return rentalSchema.parse(await postJson(
    `/api/v1/rentals/${rentalId}/return/finish/`,
    JSON.stringify({ next_instance_status: nextInstanceStatus, maintenance_reason: maintenanceReason }),
  ));
}
