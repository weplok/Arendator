import { z } from "zod";

import { getJson } from "./client";

const periodSchema = z.object({
  key: z.enum(["week", "month", "year", "custom"]),
  date_from: z.iso.date(),
  date_to: z.iso.date(),
  label: z.string(),
  days: z.number(),
  timezone: z.literal("Europe/Moscow"),
});

export const managerAnalyticsSchema = z.object({
  period: periodSchema,
  snapshot_at: z.iso.datetime({ offset: true }),
  snapshot_label: z.string(),
  financials: z.object({
    rental_income: z.string(),
    overdue_income: z.string(),
    damage_income: z.string(),
    income: z.string(),
    completed_rentals: z.number(),
    expenses: z.string(),
    completed_maintenances: z.number(),
    net: z.string(),
  }),
  utilization: z.object({
    average_percent: z.number(),
    daily: z.array(z.object({
      date: z.iso.date(), label: z.string(), percent: z.number(),
    })),
  }),
  active_overdues: z.object({ rentals: z.number(), products: z.number() }),
  park: z.object({
    total: z.number(),
    in_work: z.number(),
    items: z.array(z.object({ key: z.string(), label: z.string(), count: z.number() })),
  }),
  categories: z.array(z.object({
    id: z.number(), name: z.string(), income: z.string(), completed_rentals: z.number(),
  })),
});

export type ManagerAnalytics = z.infer<typeof managerAnalyticsSchema>;
export type AnalyticsPeriodKey = ManagerAnalytics["period"]["key"];

export const MANAGER_ANALYTICS_QUERY_KEY = ["manager", "analytics"] as const;

export async function getManagerAnalytics(query: string): Promise<ManagerAnalytics> {
  const data = await getJson(`/api/v1/manager/analytics/${query}`);
  return managerAnalyticsSchema.parse(data);
}
