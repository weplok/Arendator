import { z } from "zod";

import { getJson } from "./client";

const characteristicOptionSchema = z.object({
  id: z.number(),
  value: z.string(),
  display_order: z.number(),
});

export const characteristicSchema = z.object({
  id: z.number(),
  name: z.string(),
  type: z.enum(["LIST", "NUMBER", "BOOLEAN"]),
  is_required: z.boolean(),
  unit: z.string(),
  display_order: z.number(),
  options: z.array(characteristicOptionSchema),
});

const categorySchema = z.object({
  id: z.number(),
  name: z.string(),
  parent_id: z.number().nullable(),
  characteristics: z.array(characteristicSchema),
});

export type Category = z.infer<typeof categorySchema>;
export type CategoryNode = Category & { children: CategoryNode[] };
export type Characteristic = z.infer<typeof characteristicSchema>;

export async function getCategories(): Promise<Category[]> {
  return z.array(categorySchema).parse(await getJson("/api/v1/categories/"));
}

export function buildCategoryTree(categories: Category[]): CategoryNode[] {
  const nodes: CategoryNode[] = categories.map((category) => ({
    ...category,
    children: [],
  }));
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const roots: CategoryNode[] = [];

  for (const node of nodes) {
    const parent =
      node.parent_id === null ? undefined : nodesById.get(node.parent_id);
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}
