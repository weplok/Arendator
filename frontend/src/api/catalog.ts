import { z } from "zod";

import { getJson } from "./client";

const productStatusSchema = z.enum(["PUBLISHED", "FROZEN"]);
const productPhotoSchema = z.object({
  id: z.number().int(),
  url: z.string(),
  display_order: z.number().int(),
  is_primary: z.boolean(),
});
const publicManagerSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  avatar: z.string().nullable(),
});
const pickupPointSchema = z.object({
  city: z.string(),
  district: z.string(),
  full_address: z.string().optional(),
  latitude: z.string().optional(),
  longitude: z.string().optional(),
  yandex_maps_url: z.string().url().optional(),
});
const characteristicValueSchema = z.object({
  characteristic_id: z.number().int(),
  option_id: z.number().int().nullable(),
  number_value: z.string().nullable(),
  boolean_value: z.boolean().nullable(),
});
const productSummarySchema = z.object({
  id: z.number().int(),
  name: z.string(),
  minute_rate: z.string(),
  status: productStatusSchema,
  category: z.object({ id: z.number().int(), name: z.string() }),
  manager: publicManagerSchema,
  pickup_point: pickupPointSchema,
  primary_photo: productPhotoSchema.nullable(),
  available_instances_count: z.number().int().nonnegative(),
  total_instances_count: z.number().int().nonnegative(),
});
const productDetailSchema = productSummarySchema.extend({
  description: z.string(),
  photos: z.array(productPhotoSchema),
  characteristics: z.array(characteristicValueSchema),
  created_at: z.string(),
  published_at: z.string().nullable(),
  current_user_pending_applications_count: z.number().int().nonnegative(),
});
const managerProfileSchema = publicManagerSchema.extend({
  active_products_count: z.number().int().nonnegative(),
  frozen_products_count: z.number().int().nonnegative(),
});
const paginatedProductsSchema = z.object({
  count: z.number().int().nonnegative(),
  next: z.string().nullable(),
  previous: z.string().nullable(),
  results: z.array(productSummarySchema),
});

export type ProductSummary = z.infer<typeof productSummarySchema>;
export type ProductDetail = z.infer<typeof productDetailSchema>;
export type ProductPhoto = z.infer<typeof productPhotoSchema>;
export type ManagerProfile = z.infer<typeof managerProfileSchema>;
export type PaginatedProducts = z.infer<typeof paginatedProductsSchema>;
export type ManagerProductSection = "active" | "frozen";
export type CatalogOrdering = "newest" | "oldest" | "rate_asc" | "rate_desc";

export const CATALOG_PAGE_SIZE = 12;

export async function getProducts(
  searchParams: URLSearchParams,
): Promise<PaginatedProducts> {
  return paginatedProductsSchema.parse(
    await getJson(`/api/v1/products/?${searchParams.toString()}`),
  );
}

export async function getProduct(productId: number): Promise<ProductDetail> {
  return productDetailSchema.parse(
    await getJson(`/api/v1/products/${productId}/`),
  );
}

export async function getManagerProfile(
  managerId: number,
): Promise<ManagerProfile> {
  return managerProfileSchema.parse(
    await getJson(`/api/v1/managers/${managerId}/`),
  );
}

export async function getManagerProducts(
  managerId: number,
  section: ManagerProductSection,
  page: number,
): Promise<PaginatedProducts> {
  return paginatedProductsSchema.parse(
    await getJson(
      `/api/v1/managers/${managerId}/products/${section}/?page=${page}`,
    ),
  );
}
