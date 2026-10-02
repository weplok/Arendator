import { z } from "zod";

import { getJson, mutateJson, postJson } from "./client";

const photoSchema = z.object({
  id: z.number(), url: z.string(), display_order: z.number(), is_primary: z.boolean(),
});
const instanceStatusSchema = z.enum([
  "AVAILABLE", "RESERVED", "PICKUP_IN_PROGRESS", "RENTED",
  "RETURN_INSPECTION", "MAINTENANCE", "DELETED",
]);
const maintenancePhotoSchema = z.object({
  id: z.number(), url: z.string(), created_at: z.string(),
});
const maintenanceSchema = z.object({
  id: z.number(), reason: z.string(), damage_description: z.string(),
  repair_cost: z.string().nullable(), started_at: z.string(),
  completed_at: z.string().nullable(), source_return_id: z.number().nullable(),
  photos: z.array(maintenancePhotoSchema),
});
const instanceHistorySchema = z.object({
  id: z.number(),
  kind: z.enum(["MAINTENANCE", "DAMAGE"]),
  occurred_at: z.string(),
  reason: z.string().optional(),
  damage_description: z.string(),
  repair_cost: z.string().nullable().optional(),
  damage_amount: z.string().optional(),
  rental_id: z.number().optional(),
  source_return_id: z.number().nullable().optional(),
  started_at: z.string().optional(),
  completed_at: z.string().nullable().optional(),
  photos: z.array(maintenancePhotoSchema),
});
const instanceSchema = z.object({
  id: z.string(), inventory_number: z.string(), status: instanceStatusSchema,
  created_at: z.string().default(""),
  repair_total: z.string().default("0.00"),
  history_count: z.number().default(0),
  history: z.array(instanceHistorySchema).default([]),
  active_maintenance: maintenanceSchema.nullable().default(null),
});
const instanceSearchResultSchema = instanceSchema.extend({
  product: z.object({ id: z.number(), name: z.string() }),
});
const pickupSchema = z.object({
  city: z.string(), district: z.string(), full_address: z.string(),
  latitude: z.string(), longitude: z.string(), yandex_maps_url: z.string(),
});
const managerProductSchema = z.object({
  id: z.number(), catalog_number: z.number(), category: z.number(),
  category_name: z.string(), name: z.string(), description: z.string(),
  minute_rate: z.string(), status: z.enum(["DRAFT", "PUBLISHED", "FROZEN", "ON_MODERATION", "REJECTED", "HIDDEN_BY_ADMIN"]),
  rejection_reason: z.string(), published_at: z.string().nullable(), pickup_point: pickupSchema.nullable(),
  photos: z.array(photoSchema), instances: z.array(instanceSchema),
  available_instances_count: z.number(),
});
const characteristicValueSchema = z.object({
  characteristic_id: z.number(), option_id: z.number().nullable(),
  number_value: z.string().nullable(), boolean_value: z.boolean().nullable(),
});

export type ManagerProduct = z.infer<typeof managerProductSchema>;
export type CharacteristicValue = z.infer<typeof characteristicValueSchema>;
export type ManagerInstance = z.infer<typeof instanceSchema>;
export type InstanceHistory = z.infer<typeof instanceHistorySchema>;
export type Maintenance = z.infer<typeof maintenanceSchema>;
export type InstanceSearchResult = z.infer<typeof instanceSearchResultSchema>;
export interface ProductFields {
  name: string;
  description: string;
  minute_rate: string;
  category?: number;
}
export interface PickupFields {
  city: string;
  district: string;
  full_address: string;
  latitude: string;
  longitude: string;
}

const root = "/api/v1/manager/products/";
export const OWN_PRODUCTS_KEY = ["manager", "products"] as const;
const path = (id: number) => `${root}${id}/`;

export async function getOwnProducts(): Promise<ManagerProduct[]> {
  return z.array(managerProductSchema).parse(await getJson(root));
}

export async function getOwnProduct(id: number): Promise<ManagerProduct> {
  return managerProductSchema.parse(await getJson(path(id)));
}

export async function deleteProduct(id: number): Promise<void> {
  await mutateJson(path(id), "DELETE");
}

export async function saveBasic(fields: ProductFields, id?: number): Promise<ManagerProduct> {
  const body = JSON.stringify(fields);
  return managerProductSchema.parse(id
    ? await mutateJson(path(id), "PATCH", body)
    : await postJson(root, body));
}

export async function savePickup(id: number, fields: PickupFields): Promise<ManagerProduct> {
  return managerProductSchema.parse(await mutateJson(`${path(id)}pickup/`, "PUT", JSON.stringify(fields)));
}

export async function addPhoto(id: number, file: File): Promise<void> {
  const body = new FormData();
  body.set("image", file);
  await postJson(`${path(id)}photos/`, body);
}

export async function removePhoto(id: number, photoId: number): Promise<void> {
  await mutateJson(`${path(id)}photos/${photoId}/`, "DELETE");
}

export async function makePrimaryPhoto(id: number, photoId: number): Promise<void> {
  await mutateJson(`${path(id)}photos/${photoId}/`, "PUT");
}

export async function reorderPhotos(id: number, photoIds: number[]): Promise<void> {
  await mutateJson(
    `${path(id)}photos/order/`,
    "PUT",
    JSON.stringify({ photo_ids: photoIds }),
  );
}

export async function addInstance(id: number, inventoryNumber: string): Promise<void> {
  await postJson(`${path(id)}instances/`, JSON.stringify({ inventory_number: inventoryNumber }));
}

export async function removeInstance(id: number, instanceId: string): Promise<void> {
  await mutateJson(`${path(id)}instances/${instanceId}/`, "DELETE");
}

export async function submitProduct(id: number): Promise<ManagerProduct> {
  return managerProductSchema.parse(await postJson(`${path(id)}submit/`));
}

export async function freezeProduct(id: number): Promise<ManagerProduct> {
  return managerProductSchema.parse(await postJson(`${path(id)}freeze/`));
}

export async function getCharacteristicValues(id: number): Promise<CharacteristicValue[]> {
  return z.array(characteristicValueSchema).parse(await getJson(`/api/v1/products/${id}/characteristics/`));
}

export async function saveCharacteristicValues(id: number, values: CharacteristicValue[]): Promise<CharacteristicValue[]> {
  return z.array(characteristicValueSchema).parse(await mutateJson(
    `/api/v1/products/${id}/characteristics/`, "PUT", JSON.stringify({ values }),
  ));
}

export async function searchOwnInstance(
  inventoryNumber: string,
): Promise<InstanceSearchResult> {
  const query = new URLSearchParams({ inventory_number: inventoryNumber });
  return instanceSearchResultSchema.parse(await getJson(
    `/api/v1/manager/instances/search/?${query.toString()}`,
  ));
}

export async function startMaintenance(
  instanceId: string,
  reason: string,
): Promise<Maintenance> {
  return maintenanceSchema.parse(await postJson(
    `/api/v1/manager/instances/${instanceId}/maintenance/`,
    JSON.stringify({ reason }),
  ));
}

export interface MaintenanceCompletion {
  repairCost: string;
  damageDescription: string;
  images: File[];
}

export async function completeMaintenance(
  maintenanceId: number,
  completion: MaintenanceCompletion,
): Promise<Maintenance> {
  const body = new FormData();
  body.set("repair_cost", completion.repairCost);
  body.set("damage_description", completion.damageDescription);
  completion.images.forEach((image) => body.append("images", image));
  return maintenanceSchema.parse(await postJson(
    `/api/v1/manager/maintenances/${maintenanceId}/complete/`,
    body,
  ));
}
