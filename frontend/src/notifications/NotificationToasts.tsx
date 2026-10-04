import { Button, IconButton, Tooltip } from "@mui/material";
import {
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Link as RouterLink } from "react-router-dom";

import type { NotificationCard } from "../api/notifications";
import { formatRelativeTime } from "../applications/formatting";
import { ArrowRightIcon, CloseIcon, EyeIcon } from "../ui/Icons";

const SWIPE_DISMISS_DISTANCE_PX = 72;

interface NotificationToastsProps {
  cards: NotificationCard[];
  onClose: (id: NotificationCard["id"]) => void;
  onCloseAll: () => void;
  onRead: (card: NotificationCard) => void;
  onTarget: (card: NotificationCard) => void;
}

export function NotificationToasts({
  cards,
  onClose,
  onCloseAll,
  onRead,
  onTarget,
}: NotificationToastsProps) {
  const visibleCards = cards.slice(0, 3);
  const queuedCount = Math.max(0, cards.length - visibleCards.length);
  return (
    <section
      aria-label="Новые уведомления"
      className="notification-toast-region"
      role="region"
    >
      <span aria-live="polite" className="sr-only">
        {cards.length > 0 ? `Новых уведомлений: ${cards.length}` : ""}
      </span>
      <span className="sr-only">
        Смахните карточку вправо, чтобы закрыть её, или сфокусируйте карточку и
        нажмите Escape.
      </span>
      {queuedCount > 0 ? (
        <div className="notification-toast__queue">
          <span>И ещё {queuedCount}</span>
          <Button
            startIcon={<CloseIcon width={18} height={18} />}
            variant="text"
            onClick={onCloseAll}
          >
            Закрыть все
          </Button>
        </div>
      ) : null}
      {visibleCards.map((card) => (
        <NotificationToast
          card={card}
          key={card.id}
          onClose={onClose}
          onRead={onRead}
          onTarget={onTarget}
        />
      ))}
    </section>
  );
}

interface NotificationToastProps {
  card: NotificationCard;
  onClose: (id: NotificationCard["id"]) => void;
  onRead: (card: NotificationCard) => void;
  onTarget: (card: NotificationCard) => void;
}

function NotificationToast({
  card,
  onClose,
  onRead,
  onTarget,
}: NotificationToastProps) {
  const pointerStartX = useRef<number | undefined>(undefined);
  const dragOffsetRef = useRef(0);
  const [dragOffset, setDragOffset] = useState(0);

  function handlePointerDown(event: ReactPointerEvent<HTMLElement>): void {
    if ((event.target as HTMLElement).closest("button, a")) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    pointerStartX.current = event.clientX;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLElement>): void {
    if (pointerStartX.current === undefined) return;
    const nextOffset = Math.max(0, event.clientX - pointerStartX.current);
    dragOffsetRef.current = nextOffset;
    setDragOffset(nextOffset);
  }

  function finishSwipe(): void {
    pointerStartX.current = undefined;
    const shouldClose = dragOffsetRef.current >= SWIPE_DISMISS_DISTANCE_PX;
    dragOffsetRef.current = 0;
    setDragOffset(0);
    if (shouldClose) onClose(card.id);
  }

  function cancelSwipe(): void {
    pointerStartX.current = undefined;
    dragOffsetRef.current = 0;
    setDragOffset(0);
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLElement>): void {
    if (event.key !== "Escape" || event.target !== event.currentTarget) return;
    event.preventDefault();
    onClose(card.id);
  }

  const style = {
    "--notification-drag-x": `${dragOffset}px`,
    "--notification-drag-opacity": Math.max(0.35, 1 - dragOffset / 280),
  } as CSSProperties;
  const readLabel = card.is_aggregate
    ? "Отметить прочитанными"
    : "Отметить прочитанным";

  return (
    <article
      className={`notification-toast notification-toast--${card.level.toLowerCase()}`}
      tabIndex={0}
      onPointerCancel={cancelSwipe}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishSwipe}
      style={style}
    >
      <div className="notification-toast__head">
        <NotificationType level={card.level} />
        <div className="notification-toast__copy">
          <time dateTime={card.created_at}>{formatRelativeTime(card.created_at)}</time>
          <h2>{card.title}</h2>
          <p>{card.message}</p>
        </div>
      </div>
      <div className="notification-toast__actions">
        <Tooltip title={readLabel}>
          <IconButton aria-label={readLabel} onClick={() => onRead(card)}>
            <EyeIcon />
          </IconButton>
        </Tooltip>
        <Button
          component={RouterLink}
          endIcon={<ArrowRightIcon width={18} height={18} />}
          sx={{ minHeight: 36 }}
          to={card.target_url}
          variant="contained"
          onClick={() => onTarget(card)}
        >
          {card.target_label}
        </Button>
      </div>
    </article>
  );
}

export function NotificationType({ level }: { level: "INFO" | "WARNING" }) {
  const warning = level === "WARNING";
  return (
    <span
      aria-label={warning ? "Предупреждение" : "Информационное уведомление"}
      className={`notification-type notification-type--${warning ? "warning" : "info"}`}
      role="img"
    >
      {warning ? "!" : "i"}
    </span>
  );
}
