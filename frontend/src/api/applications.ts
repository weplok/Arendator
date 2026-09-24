import { z } from "zod";

import { getJson, mutateJson, postJson } from "./client";

const applicationStatusSchema = z.enum([
  "WAITING",
  "BOOKED",
  "CANCELLED",
  "EXPIRED",
]);
const applicationPhotoSchema = z.object({
  id: z.number().int(),
  url: z.string(),
  display_order: z.number().int(),
  is_primary: z.boolean(),
});
const applicationProductSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  description: z.string(),
  minute_rate: z.string(),
  primary_photo: applicationPhotoSchema.nullable(),
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
const applicationEventSchema = z.object({
  event: z.enum(["CREATED", "BOOKED", "CANCELLED", "EXPIRED"]),
  actor: z.enum(["RENTER", "MANAGER", "SYSTEM"]),
  created_at: z.string(),
  note: z.string(),
});
export const rentalApplicationSchema = z.object({
  id: z.number().int(),
  status: applicationStatusSchema,
  pickup_deadline_at: z.string(),
  planned_return_at: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  cancellation_reason: z.string(),
  estimated_cost: z.string(),
  product: applicationProductSchema,
  renter: z.object({
    id: z.number().int(),
    name: z.string(),
    avatar: z.string().nullable(),
  }),
  history: z.array(applicationEventSchema),
  instances: z.array(z.object({
    id: z.string().uuid(),
    inventory_number: z.string(),
    instance_number: z.number().int().positive(),
    status: z.enum([
      "AVAILABLE",
      "RESERVED",
      "PICKUP_IN_PROGRESS",
      "RENTED",
      "RETURN_INSPECTION",
      "MAINTENANCE",
      "DELETED",
    ]),
    status_label: z.string(),
  })).optional(),
});
const managerOrderingSchema = z.enum(["EARLIEST", "LATEST", "NEAREST"]);
const managerPreferencesSchema = z.object({
  ordering: managerOrderingSchema,
  hide_unavailable: z.boolean(),
});
const managerQueueSchema = z.object({
  preferences: managerPreferencesSchema,
  results: z.array(rentalApplicationSchema),
});

export type RentalApplication = z.infer<typeof rentalApplicationSchema>;
export type ManagerApplicationOrdering = z.infer<typeof managerOrderingSchema>;
export type ManagerApplicationPreferences = z.infer<typeof managerPreferencesSchema>;

export interface ApplicationInput {
  pickup_deadline_at: string;
  planned_return_at: string;
}

export const RENTER_APPLICATIONS_KEY = ["applications", "renter"] as const;
export const MANAGER_APPLICATIONS_KEY = ["applications", "manager"] as const;

export async function createApplication(
  productId: number,
  input: ApplicationInput,
): Promise<RentalApplication> {
  return rentalApplicationSchema.parse(
    await postJson(
      `/api/v1/products/${productId}/applications/`,
      JSON.stringify(input),
    ),
  );
}

export async function getRenterApplications(): Promise<RentalApplication[]> {
  return z.array(rentalApplicationSchema).parse(
    await getJson("/api/v1/applications/"),
  );
}

export async function getRenterApplication(
  applicationId: number,
): Promise<RentalApplication> {
  return rentalApplicationSchema.parse(
    await getJson(`/api/v1/applications/${applicationId}/`),
  );
}

export async function cancelRenterApplication(
  applicationId: number,
  reason: string,
): Promise<RentalApplication> {
  return rentalApplicationSchema.parse(
    await postJson(
      `/api/v1/applications/${applicationId}/cancel/`,
      JSON.stringify({ reason }),
    ),
  );
}

export async function getManagerApplications(): Promise<
  z.infer<typeof managerQueueSchema>
> {
  return managerQueueSchema.parse(
    await getJson("/api/v1/manager/applications/"),
  );
}

export async function getManagerApplication(
  applicationId: number,
): Promise<RentalApplication> {
  return rentalApplicationSchema.parse(
    await getJson(`/api/v1/manager/applications/${applicationId}/`),
  );
}

export async function cancelManagerApplication(
  applicationId: number,
  reason: string,
): Promise<RentalApplication> {
  return rentalApplicationSchema.parse(
    await postJson(
      `/api/v1/manager/applications/${applicationId}/cancel/`,
      JSON.stringify({ reason }),
    ),
  );
}

export async function updateManagerApplicationPreferences(
  preferences: ManagerApplicationPreferences,
): Promise<ManagerApplicationPreferences> {
  return managerPreferencesSchema.parse(
    await mutateJson(
      "/api/v1/manager/application-preferences/",
      "PATCH",
      JSON.stringify(preferences),
    ),
  );
}

export async function createBookingFromApplication(
  applicationId: number,
  instanceId: string,
): Promise<unknown> {
  return postJson(
    `/api/v1/manager/applications/${applicationId}/book/`,
    JSON.stringify({ instance_id: instanceId }),
  );
}
