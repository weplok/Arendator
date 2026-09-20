import { z } from "zod";

import { getJson, mutateJson, postJson } from "./client";

const photoSchema = z.object({
  id: z.number(), url: z.string(), display_order: z.number(), is_primary: z.boolean(),
});
const instanceSchema = z.object({
  id: z.string(), inventory_number: z.string(), status: z.string(),
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
