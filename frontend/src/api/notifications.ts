import { z } from "zod";

import { getJson, mutateJson, postJson } from "./client";

export const notificationEventSchema = z.enum([
  "APPLICATION_EXPIRED", "BOOKING_CREATED", "APPLICATION_CANCELLED",
  "BOOKING_CANCELLED", "BOOKING_EXPIRED", "HANDOVER_STARTED",
  "RENTAL_STARTED", "RENTAL_OVERDUE", "RETURN_STARTED",
  "RENTAL_COMPLETED", "NEW_APPLICATION", "MODERATION_RESULT",
  "PRODUCT_SUBMITTED",
]);

export const notificationSchema = z.object({
  id: z.number(),
  event_type: notificationEventSchema,
  level: z.enum(["INFO", "WARNING"]),
  title: z.string(),
  message: z.string(),
  target_url: z.string(),
  target_label: z.string(),
  is_read: z.boolean(),
  created_at: z.string(),
});

const notificationListSchema = z.object({
  unread_count: z.number().int().nonnegative(),
  results: z.array(notificationSchema),
});

const notificationSettingsSchema = z.object({
  sound_enabled: z.boolean(),
  enabled_events: z.array(notificationEventSchema),
  available_events: z.array(notificationEventSchema),
});

export const notificationCardSchema = z.object({
  id: z.union([z.number(), z.string()]),
  notification_ids: z.array(z.number()),
  event_type: notificationEventSchema,
  level: z.enum(["INFO", "WARNING"]),
  title: z.string(),
  message: z.string(),
  target_url: z.string(),
  target_label: z.string(),
  created_at: z.string(),
  is_aggregate: z.boolean(),
});

export const notificationSocketMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("notifications.backlog"),
    cards: z.array(notificationCardSchema),
  }),
  z.object({
    type: z.literal("notification.created"),
    card: notificationCardSchema,
  }),
]);

export type NotificationEvent = z.infer<typeof notificationEventSchema>;
export type NotificationItem = z.infer<typeof notificationSchema>;
export type NotificationList = z.infer<typeof notificationListSchema>;
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;
export type NotificationCard = z.infer<typeof notificationCardSchema>;

export const NOTIFICATIONS_QUERY_KEY = ["notifications"] as const;
export const NOTIFICATION_SETTINGS_QUERY_KEY = [
  "notifications",
  "settings",
] as const;

export async function getNotifications(): Promise<NotificationList> {
  return notificationListSchema.parse(await getJson("/api/v1/notifications/"));
}

export async function deleteNotification(id: number): Promise<void> {
  await mutateJson(`/api/v1/notifications/${id}/`, "DELETE");
}

export async function markAllNotificationsRead(): Promise<void> {
  await postJson("/api/v1/notifications/read-all/");
}

export async function markNotificationsRead(ids: number[]): Promise<void> {
  await postJson("/api/v1/notifications/read/", JSON.stringify({ ids }));
}

export async function getNotificationSettings(): Promise<NotificationSettings> {
  return notificationSettingsSchema.parse(
    await getJson("/api/v1/notifications/settings/"),
  );
}

export async function updateNotificationSettings(
  settings: Pick<NotificationSettings, "sound_enabled" | "enabled_events">,
): Promise<NotificationSettings> {
  return notificationSettingsSchema.parse(
    await mutateJson(
      "/api/v1/notifications/settings/",
      "PATCH",
      JSON.stringify(settings),
    ),
  );
}
