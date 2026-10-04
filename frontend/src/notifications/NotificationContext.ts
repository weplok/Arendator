import { createContext, use } from "react";

import type {
  NotificationCard,
  NotificationList,
  NotificationSettings,
} from "../api/notifications";

export interface NotificationState {
  cards: NotificationCard[];
  isReconnecting: boolean;
  isSavingSettings: boolean;
  notifications?: NotificationList;
  notificationsError: boolean;
  notificationsPending: boolean;
  settings?: NotificationSettings;
  settingsError: boolean;
  settingsPending: boolean;
}

export interface NotificationActions {
  closeCard: (id: NotificationCard["id"]) => void;
  closeAllCards: () => void;
  deleteItem: (id: number) => Promise<void>;
  markAllRead: () => Promise<void>;
  markCardsRead: (card: NotificationCard) => void;
  openCardTarget: (card: NotificationCard) => void;
  openItemTarget: (id: number, targetUrl: string) => void;
  refetchNotifications: () => void;
  refetchSettings: () => void;
  saveSettings: (
    settings: Pick<NotificationSettings, "sound_enabled" | "enabled_events">,
  ) => Promise<void>;
}

export interface NotificationContextValue {
  state: NotificationState;
  actions: NotificationActions;
}

export const NotificationContext = createContext<NotificationContextValue | null>(null);

export function useNotifications(): NotificationContextValue {
  const context = use(NotificationContext);
  if (!context) throw new Error("NotificationProvider is required.");
  return context;
}
