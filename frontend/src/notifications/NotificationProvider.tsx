import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { CurrentUser } from "../api/auth";
import {
  deleteNotification,
  getNotifications,
  getNotificationSettings,
  markAllNotificationsRead,
  markNotificationsRead,
  NOTIFICATIONS_QUERY_KEY,
  NOTIFICATION_SETTINGS_QUERY_KEY,
  notificationSocketMessageSchema,
  type NotificationCard,
  type NotificationList,
  updateNotificationSettings,
} from "../api/notifications";
import { NotificationToasts } from "./NotificationToasts";
import {
  NotificationContext,
  type NotificationActions,
  type NotificationContextValue,
} from "./NotificationContext";

interface NotificationProviderProps {
  children: ReactNode;
  createSocket?: (url: string) => WebSocket | null;
  user: CurrentUser;
}

const DELIVERY_ACK_DELAY_MS = 3_000;

function defaultCreateSocket(url: string): WebSocket | null {
  return typeof WebSocket === "undefined" ? null : new WebSocket(url);
}

export function NotificationProvider({
  children,
  createSocket = defaultCreateSocket,
  user,
}: NotificationProviderProps) {
  const queryClient = useQueryClient();
  const [cards, setCards] = useState<NotificationCard[]>([]);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [connectionVersion, setConnectionVersion] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);
  const cardsRef = useRef<NotificationCard[]>([]);
  const acknowledgedIdsRef = useRef(new Set<number>());
  const soundedCardIdsRef = useRef(new Set<string>());
  const notificationsQuery = useQuery({
    queryKey: NOTIFICATIONS_QUERY_KEY,
    queryFn: getNotifications,
  });
  const settingsQuery = useQuery({
    queryKey: NOTIFICATION_SETTINGS_QUERY_KEY,
    queryFn: getNotificationSettings,
  });
  const readMutation = useMutation({ mutationFn: markNotificationsRead });
  const readAllMutation = useMutation({ mutationFn: markAllNotificationsRead });
  const deleteMutation = useMutation({ mutationFn: deleteNotification });
  const settingsMutation = useMutation({
    mutationFn: updateNotificationSettings,
    onSuccess: (settings) => {
      queryClient.setQueryData(NOTIFICATION_SETTINGS_QUERY_KEY, settings);
    },
  });
  useEffect(() => {
    cardsRef.current = cards;
  }, [cards]);

  const acknowledgeCards = useCallback((cardsToAcknowledge: NotificationCard[]) => {
    const notificationIds = cardsToAcknowledge
      .flatMap((card) => card.notification_ids)
      .filter((id) => !acknowledgedIdsRef.current.has(id));
    if (!acknowledgeDelivery(socketRef.current, notificationIds)) return;
    notificationIds.forEach((id) => acknowledgedIdsRef.current.add(id));
  }, []);

  const closeCard = useCallback(
    (id: NotificationCard["id"]) => {
      const card = cardsRef.current.find((candidate) => candidate.id === id);
      if (card) acknowledgeCards([card]);
      setCards((current) => current.filter((candidate) => candidate.id !== id));
    },
    [acknowledgeCards],
  );

  const closeAllCards = useCallback(() => {
    acknowledgeCards(cardsRef.current);
    setCards([]);
  }, [acknowledgeCards]);

  const markIdsReadLocally = useCallback(
    (ids: number[]) => {
      const idSet = new Set(ids);
      queryClient.setQueryData<NotificationList>(
        NOTIFICATIONS_QUERY_KEY,
        (current) => {
          if (!current) return current;
          const newlyRead = current.results.filter(
            (item) => idSet.has(item.id) && !item.is_read,
          ).length;
          return {
            unread_count: Math.max(0, current.unread_count - newlyRead),
            results: current.results.map((item) =>
              idSet.has(item.id) ? { ...item, is_read: true } : item,
            ),
          };
        },
      );
    },
    [queryClient],
  );

  const markCardsRead = useCallback(
    (card: NotificationCard) => {
      setCards((current) => current.filter((item) => item.id !== card.id));
      markIdsReadLocally(card.notification_ids);
      readMutation.mutate(card.notification_ids, {
        onError: () => {
          void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY });
        },
      });
    },
    [markIdsReadLocally, queryClient, readMutation],
  );

  const openCardTarget = useCallback(
    (card: NotificationCard) => {
      markCardsRead(card);
      if (card.target_url.startsWith("/admin/")) {
        window.location.assign(card.target_url);
      }
    },
    [markCardsRead],
  );

  const openItemTarget = useCallback(
    (id: number, targetUrl: string) => {
      markIdsReadLocally([id]);
      readMutation.mutate([id], {
        onError: () => {
          void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY });
        },
      });
      if (targetUrl.startsWith("/admin/")) window.location.assign(targetUrl);
    },
    [markIdsReadLocally, queryClient, readMutation],
  );

  useEffect(() => {
    let stopped = false;
    let reconnectTimer: number | undefined;
    let socket: WebSocket | null = null;
    let reconnectAttempt = 0;

    function connect(): void {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = createSocket(`${protocol}//${window.location.host}/ws/notifications/`);
      if (!socket) return;
      socketRef.current = socket;
      socket.onopen = () => {
        reconnectAttempt = 0;
        acknowledgedIdsRef.current.clear();
        setConnectionVersion((current) => current + 1);
        setIsReconnecting(false);
      };
      socket.onmessage = (event) => {
        const parsed = parseSocketMessage(event.data);
        if (!parsed.success) return;
        const incoming =
          parsed.data.type === "notifications.backlog"
            ? parsed.data.cards
            : [parsed.data.card];
        setCards((current) => appendUniqueCards(current, incoming));
        if (parsed.data.type === "notification.created") {
          addLiveNotificationToCache(queryClient, parsed.data.card);
        }
      };
      socket.onclose = () => {
        if (stopped) return;
        setIsReconnecting(true);
        const delay = Math.min(30_000, 1_000 * 2 ** reconnectAttempt);
        reconnectAttempt += 1;
        reconnectTimer = window.setTimeout(connect, delay);
      };
      socket.onerror = () => socket?.close();
    }

    connect();
    return () => {
      stopped = true;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      socket?.close();
      socketRef.current = null;
    };
  }, [createSocket, queryClient, user.email]);

  useEffect(() => {
    const visibleCards = cards.slice(0, 3);
    const notificationIds = visibleCards
      .flatMap((card) => card.notification_ids)
      .filter((id) => !acknowledgedIdsRef.current.has(id));
    const deliveryTimer = window.setTimeout(() => {
      if (!acknowledgeDelivery(socketRef.current, notificationIds)) return;
      notificationIds.forEach((id) => acknowledgedIdsRef.current.add(id));
    }, DELIVERY_ACK_DELAY_MS);

    if (!settingsQuery.isPending) {
      const unsoundedCards = visibleCards.filter(
        (card) => !soundedCardIdsRef.current.has(String(card.id)),
      );
      unsoundedCards.forEach((card) => soundedCardIdsRef.current.add(String(card.id)));
      if (settingsQuery.data?.sound_enabled && unsoundedCards.length > 0) {
        playBell(unsoundedCards.length);
      }
    }

    return () => window.clearTimeout(deliveryTimer);
  }, [
    cards,
    connectionVersion,
    settingsQuery.data?.sound_enabled,
    settingsQuery.isPending,
  ]);

  const actions = useMemo<NotificationActions>(
    () => ({
      closeCard,
      closeAllCards,
      deleteItem: async (id) => {
        await deleteMutation.mutateAsync(id);
        queryClient.setQueryData<NotificationList>(
          NOTIFICATIONS_QUERY_KEY,
          (current) => removeNotification(current, id),
        );
      },
      markAllRead: async () => {
        const current = queryClient.getQueryData<NotificationList>(
          NOTIFICATIONS_QUERY_KEY,
        );
        if (!current || current.unread_count === 0) return;
        const existingIds = new Set(current.results.map((item) => item.id));
        await readAllMutation.mutateAsync();
        setCards((currentCards) =>
          currentCards.filter((card) =>
            card.notification_ids.some((id) => !existingIds.has(id)),
          ),
        );
        queryClient.setQueryData<NotificationList>(NOTIFICATIONS_QUERY_KEY, {
          unread_count: 0,
          results: current.results.map((item) => ({ ...item, is_read: true })),
        });
      },
      markCardsRead,
      openCardTarget,
      openItemTarget,
      refetchNotifications: () => {
        void notificationsQuery.refetch();
      },
      refetchSettings: () => {
        void settingsQuery.refetch();
      },
      saveSettings: async (settings) => {
        await settingsMutation.mutateAsync(settings);
      },
    }),
    [
      deleteMutation,
      closeAllCards,
      closeCard,
      markCardsRead,
      notificationsQuery,
      openCardTarget,
      openItemTarget,
      queryClient,
      readAllMutation,
      settingsMutation,
      settingsQuery,
    ],
  );

  const value = useMemo<NotificationContextValue>(
    () => ({
      state: {
        cards,
        isReconnecting,
        isSavingSettings: settingsMutation.isPending,
        notifications: notificationsQuery.data,
        notificationsError: notificationsQuery.isError,
        notificationsPending: notificationsQuery.isPending,
        settings: settingsQuery.data,
        settingsError: settingsQuery.isError,
        settingsPending: settingsQuery.isPending,
      },
      actions,
    }),
    [
      actions,
      cards,
      isReconnecting,
      notificationsQuery.data,
      notificationsQuery.isError,
      notificationsQuery.isPending,
      settingsMutation.isPending,
      settingsQuery.data,
      settingsQuery.isError,
      settingsQuery.isPending,
    ],
  );

  return (
    <NotificationContext value={value}>
      {children}
      <NotificationToasts
        cards={cards}
        onClose={actions.closeCard}
        onCloseAll={actions.closeAllCards}
        onRead={actions.markCardsRead}
        onTarget={actions.openCardTarget}
      />
    </NotificationContext>
  );
}

function appendUniqueCards(
  current: NotificationCard[],
  incoming: NotificationCard[],
): NotificationCard[] {
  const currentIds = new Set(current.map((card) => String(card.id)));
  return [
    ...current,
    ...incoming.filter((card) => !currentIds.has(String(card.id))),
  ];
}

function acknowledgeDelivery(
  socket: WebSocket | null,
  notificationIds: number[],
): boolean {
  if (
    !socket ||
    socket.readyState !== WebSocket.OPEN ||
    notificationIds.length === 0
  ) return false;
  socket.send(
    JSON.stringify({
      type: "notifications.delivered",
      notification_ids: notificationIds,
    }),
  );
  return true;
}

function parseSocketMessage(data: unknown) {
  try {
    return notificationSocketMessageSchema.safeParse(JSON.parse(String(data)));
  } catch {
    return notificationSocketMessageSchema.safeParse({});
  }
}

function addLiveNotificationToCache(
  queryClient: ReturnType<typeof useQueryClient>,
  card: NotificationCard,
): void {
  if (typeof card.id !== "number") return;
  queryClient.setQueryData<NotificationList>(NOTIFICATIONS_QUERY_KEY, (current) => {
    if (!current || current.results.some((item) => item.id === card.id)) return current;
    return {
      unread_count: current.unread_count + 1,
      results: [{ ...card, id: card.id as number, is_read: false }, ...current.results],
    };
  });
}

function removeNotification(
  current: NotificationList | undefined,
  id: number,
): NotificationList | undefined {
  if (!current) return current;
  const removed = current.results.find((item) => item.id === id);
  return {
    unread_count: Math.max(
      0,
      current.unread_count - (removed && !removed.is_read ? 1 : 0),
    ),
    results: current.results.filter((item) => item.id !== id),
  };
}

function playBell(repetitions: number): void {
  const AudioContextClass = window.AudioContext;
  if (!AudioContextClass) return;
  try {
    const context = new AudioContextClass();
    const count = Math.min(repetitions, 3);
    for (let index = 0; index < count; index += 1) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const startsAt = context.currentTime + index * 0.18;
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(880, startsAt);
      oscillator.frequency.exponentialRampToValueAtTime(660, startsAt + 0.16);
      gain.gain.setValueAtTime(0.0001, startsAt);
      gain.gain.exponentialRampToValueAtTime(0.12, startsAt + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, startsAt + 0.28);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(startsAt);
      oscillator.stop(startsAt + 0.3);
    }
  } catch {
    // Browsers may block audio before the first user interaction.
  }
}
