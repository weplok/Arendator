import {
  Alert,
  Button,
  CircularProgress,
  IconButton,
  Paper,
  Skeleton,
  Switch,
  Typography,
} from "@mui/material";
import { useEffect, useEffectEvent, useState } from "react";
import { Link as RouterLink } from "react-router-dom";

import type {
  NotificationEvent,
  NotificationItem,
  NotificationSettings,
} from "../api/notifications";
import type { CurrentUser } from "../api/auth";
import { formatMoscowDateTime } from "../applications/formatting";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BellIcon,
  CloseIcon,
  SettingsIcon,
} from "../ui/Icons";
import { NotificationType } from "./NotificationToasts";
import { useNotifications } from "./NotificationContext";
import "./notifications.css";

export function NotificationCenterPage() {
  const { state, actions } = useNotifications();
  const markAllRead = useEffectEvent(actions.markAllRead);
  const [deletingId, setDeletingId] = useState<number>();
  const isReady = !state.notificationsPending && !state.notificationsError;

  useEffect(() => {
    if (!isReady) return undefined;
    const timer = window.setTimeout(() => {
      void markAllRead();
    }, 3_000);
    return () => window.clearTimeout(timer);
  }, [isReady]);

  async function handleDelete(id: number): Promise<void> {
    setDeletingId(id);
    try {
      await actions.deleteItem(id);
    } finally {
      setDeletingId(undefined);
    }
  }

  const unreadCount = state.notifications?.unread_count ?? 0;
  return (
    <section className="notification-center" aria-labelledby="notification-title">
      <header className="notification-page-head">
        <div>
          <span className="notification-eyebrow">Центр событий</span>
          <Typography component="h1" id="notification-title" variant="h3">
            Уведомления
          </Typography>
          <Typography color="text.secondary">
            Все важные изменения по заявкам, броням и арендам
          </Typography>
        </div>
        <div className="notification-page-head__actions">
          <span aria-live="polite" className="notification-unread-count">
            Непрочитанных: {unreadCount}
          </span>
          <Button
            component={RouterLink}
            startIcon={<SettingsIcon />}
            to="settings"
            variant="outlined"
          >
            Настройки
          </Button>
        </div>
      </header>
      {state.isReconnecting ? (
        <Alert severity="info" className="notification-connection-alert">
          Восстанавливаем доставку в реальном времени. Сохранённая лента доступна.
        </Alert>
      ) : null}
      {state.notificationsPending ? <NotificationSkeletons /> : null}
      {state.notificationsError ? (
        <Alert
          severity="error"
          action={<Button onClick={actions.refetchNotifications}>Повторить</Button>}
        >
          Не удалось загрузить уведомления
        </Alert>
      ) : null}
      {state.notifications && state.notifications.results.length === 0 ? (
        <Paper variant="outlined" className="notification-empty">
          <span aria-hidden="true"><BellIcon /></span>
          <Typography component="h2" variant="h6">Уведомлений пока нет</Typography>
        </Paper>
      ) : null}
      {state.notifications && state.notifications.results.length > 0 ? (
        <div className="notification-list">
          {state.notifications.results.map((item) => (
            <NotificationRow
              deleting={deletingId === item.id}
              item={item}
              key={item.id}
              onDelete={handleDelete}
              onTarget={actions.openItemTarget}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

interface NotificationRowProps {
  deleting: boolean;
  item: NotificationItem;
  onDelete: (id: number) => Promise<void>;
  onTarget: (id: number, targetUrl: string) => void;
}

function NotificationRow({
  deleting,
  item,
  onDelete,
  onTarget,
}: NotificationRowProps) {
  return (
    <article
      className={`notification-row${item.is_read ? "" : " notification-row--unread"}`}
    >
      <NotificationType level={item.level} />
      <div className="notification-row__body">
        <div className="notification-row__heading">
          <Typography component="h2" variant="h6">
            {item.title}
            {!item.is_read ? <><span className="notification-new-dot" aria-hidden="true" /><span className="sr-only">Непрочитанное</span></> : null}
          </Typography>
          <time dateTime={item.created_at}>{formatMoscowDateTime(item.created_at)} МСК</time>
        </div>
        <Typography>{item.message}</Typography>
        <Button
          component={RouterLink}
          endIcon={<ArrowRightIcon />}
          onClick={() => onTarget(item.id, item.target_url)}
          to={item.target_url}
          variant="text"
        >
          {item.target_label}
        </Button>
      </div>
      <IconButton
        aria-label={`Удалить уведомление «${item.title}»`}
        disabled={deleting}
        onClick={() => void onDelete(item.id)}
      >
        {deleting ? <CircularProgress size={20} /> : <CloseIcon />}
      </IconButton>
    </article>
  );
}

function NotificationSkeletons() {
  return (
    <div aria-label="Загрузка уведомлений" className="notification-list" role="status">
      {[1, 2, 3].map((item) => (
        <Paper className="notification-skeleton" key={item} variant="outlined">
          <Skeleton variant="circular" width={40} height={40} />
          <div>
            <Skeleton width="42%" height={28} />
            <Skeleton width="92%" />
            <Skeleton width="68%" />
          </div>
        </Paper>
      ))}
    </div>
  );
}

export function NotificationSettingsPage({ user }: { user: CurrentUser }) {
  const { state, actions } = useNotifications();
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "error">("idle");
  const settings = state.settings;
  const descriptors = eventDescriptors[user.role] ?? {};

  async function save(next: Pick<NotificationSettings, "sound_enabled" | "enabled_events">) {
    setSaveStatus("idle");
    try {
      await actions.saveSettings(next);
      setSaveStatus("saved");
    } catch {
      setSaveStatus("error");
    }
  }

  if (state.settingsPending) {
    return <div className="notification-settings-state" role="status"><CircularProgress /> Загрузка настроек…</div>;
  }
  if (state.settingsError || !settings) {
    return (
      <Alert severity="error" action={<Button onClick={actions.refetchSettings}>Повторить</Button>}>
        Не удалось загрузить настройки уведомлений
      </Alert>
    );
  }
  const backUrl = user.role === "MANAGER" ? "/manager/notifications" : "/account/notifications";
  const enabled = new Set(settings.enabled_events);
  return (
    <section className="notification-center" aria-labelledby="notification-settings-title">
      <header className="notification-page-head">
        <div>
          <span className="notification-eyebrow">Настройки доставки</span>
          <Typography component="h1" id="notification-settings-title" variant="h3">
            Настройки уведомлений
          </Typography>
          <Typography color="text.secondary">
            Выберите события, о которых хотите получать уведомления
          </Typography>
        </div>
        <Button component={RouterLink} startIcon={<ArrowLeftIcon />} to={backUrl} variant="outlined">
          Назад к уведомлениям
        </Button>
      </header>
      {saveStatus === "saved" ? <Alert severity="success">Настройки сохранены</Alert> : null}
      {saveStatus === "error" ? <Alert severity="error">Не удалось сохранить настройки</Alert> : null}
      <Paper className="notification-settings-card notification-sound-card" variant="outlined">
        <div className="notification-setting-copy">
          <span className="notification-setting-icon" aria-hidden="true"><BellIcon /></span>
          <div>
            <Typography component="h2" variant="h6">Уведомления со звуком</Typography>
            <Typography color="text.secondary">Глобальная настройка звука.</Typography>
          </div>
        </div>
        <Switch
          checked={settings.sound_enabled}
          disabled={state.isSavingSettings}
          slotProps={{ input: { "aria-label": "Уведомления со звуком" } }}
          onChange={(_, checked) => void save({
            sound_enabled: checked,
            enabled_events: settings.enabled_events,
          })}
        />
      </Paper>
      <Paper className="notification-settings-card" variant="outlined">
        <div className="notification-settings-heading">
          <div>
            <Typography component="h2" variant="h6">
              Типы событий
            </Typography>
          </div>
          <span>{settings.enabled_events.length} включено</span>
        </div>
        <div className="notification-settings-list">
          {settings.available_events.map((event) => {
            const descriptor = descriptors[event] ?? { title: event, description: "" };
            return (
              <div className="notification-setting-row" key={event}>
                <div>
                  <strong>{descriptor.title}</strong>
                  <small>{descriptor.description}</small>
                </div>
                <Switch
                  checked={enabled.has(event)}
                  disabled={state.isSavingSettings}
                  slotProps={{ input: { "aria-label": descriptor.title } }}
                  onChange={(_, checked) => {
                    const nextEnabled = checked
                      ? [...settings.enabled_events, event]
                      : settings.enabled_events.filter((item) => item !== event);
                    void save({
                      sound_enabled: settings.sound_enabled,
                      enabled_events: nextEnabled,
                    });
                  }}
                />
              </div>
            );
          })}
        </div>
      </Paper>
    </section>
  );
}

interface EventDescriptor {
  title: string;
  description: string;
}

const sharedDescriptors: Partial<Record<NotificationEvent, EventDescriptor>> = {
  BOOKING_CREATED: { title: "Бронь подтверждена", description: "Экземпляр назначен на заявку" },
  BOOKING_EXPIRED: { title: "Истёк срок получения", description: "Автоматическое завершение брони" },
  HANDOVER_STARTED: { title: "Началась приёмка товара", description: "Прибытие подтверждено, началась выдача" },
  RENTAL_STARTED: { title: "Аренда началась", description: "Фотоакт выдачи подтверждён обеими сторонами" },
  RENTAL_OVERDUE: { title: "Истёк плановый срок возврата", description: "Предупреждение о начале просрочки" },
  RENTAL_COMPLETED: { title: "Аренда завершена", description: "Возврат подтверждён и расчёт зафиксирован" },
};

const eventDescriptors: Partial<Record<CurrentUser["role"], Partial<Record<NotificationEvent, EventDescriptor>>>> = {
  RENTER: {
    ...sharedDescriptors,
    APPLICATION_EXPIRED: { title: "Истёк срок заявки", description: "Заявка завершилась без назначенного экземпляра" },
    APPLICATION_CANCELLED: { title: "Заявка отменена", description: "Отмена вами, менеджером или системой" },
    BOOKING_CANCELLED: { title: "Бронь отменена", description: "Назначенный экземпляр больше не удерживается" },
    RETURN_STARTED: { title: "Началась приёмка возврата", description: "Менеджер принял товар и остановил начисление" },
  },
  MANAGER: {
    ...sharedDescriptors,
    NEW_APPLICATION: { title: "Новая заявка", description: "Заявка на товар из вашего каталога" },
    APPLICATION_CANCELLED: { title: "Арендатор отменил заявку", description: "Заявка на ваш товар отменена" },
    BOOKING_CANCELLED: { title: "Арендатор отменил бронь", description: "Назначенный экземпляр освобождён" },
    MODERATION_RESULT: { title: "Результат модерации", description: "Одобрение или отклонение карточки товара" },
  },
};
