import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  Link as RouterLink,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";

import {
  cancelManagerBooking,
  cancelRenterBooking,
  confirmBookingArrival,
  getManagerBooking,
  getManagerBookings,
  getRenterBooking,
  getRenterBookings,
  MANAGER_BOOKINGS_KEY,
  RENTER_BOOKINGS_KEY,
  type BookingPeriod,
  type RentalBooking,
} from "../api/bookings";
import { formatMoscowDateTime, formatRubles } from "./formatting";
import "./applications.css";

const PERIOD_LABELS: Record<BookingPeriod, string> = {
  today: "Сегодня",
  three: "3 дня",
  all: "Все",
};

const ACTIVE_STATUSES = new Set<RentalBooking["status"]>(["ACTIVE", "ARRIVED"]);

export function ManagerBookingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedPeriod = searchParams.get("period");
  const period: BookingPeriod = requestedPeriod === "three" || requestedPeriod === "all"
    ? requestedPeriod
    : "today";
  const query = useQuery({
    queryKey: [...MANAGER_BOOKINGS_KEY, period],
    queryFn: () => getManagerBookings(period),
  });
  const [renderedAt] = useState(() => new Date());

  if (query.isPending) {
    return <div className="application-state" role="status"><CircularProgress /> Загрузка броней…</div>;
  }
  if (query.isError) {
    return <Alert severity="error" action={<Button onClick={() => query.refetch()}>Повторить</Button>}>Не удалось загрузить текущие брони.</Alert>;
  }
  const { results, summary } = query.data;
  return (
    <>
      <Box className="application-list-heading">
        <Box>
          <Typography component="h1" variant="h3">Текущие брони</Typography>
          <Typography color="text.secondary">Сроки получения и подтверждённые прибытия</Typography>
        </Box>
        <span className="application-timezone">Время указано по Москве</span>
      </Box>
      <div className="booking-summary" aria-label="Сводка текущих броней">
        <Paper variant="outlined"><span>Сегодня</span><strong>{summary.today}</strong></Paper>
        <Paper variant="outlined"><span>Срок в течение 4 часов</span><strong>{summary.urgent}</strong></Paper>
        <Paper variant="outlined"><span>Ближайшие 3 дня</span><strong>{summary.three_days}</strong></Paper>
      </div>
      <div className="booking-periods" aria-label="Период списка">
        {(Object.keys(PERIOD_LABELS) as BookingPeriod[]).map((value) => (
          <Button
            key={value}
            variant={period === value ? "contained" : "outlined"}
            aria-pressed={period === value}
            onClick={() => setSearchParams({ period: value }, { replace: true })}
          >
            {PERIOD_LABELS[value]}
          </Button>
        ))}
      </div>
      <Paper variant="outlined" className="application-table-surface booking-list-surface">
        {results.length === 0 ? (
          <div className="application-empty">
            <Typography component="h2" variant="h6">На выбранный период броней нет</Typography>
            <Typography color="text.secondary">Выберите другой период или перейдите к заявкам.</Typography>
            <Button component={RouterLink} to="/manager/applications" variant="outlined">Открыть заявки</Button>
          </div>
        ) : <BookingTable bookings={results} renderedAt={renderedAt} />}
      </Paper>
    </>
  );
}

function BookingTable({ bookings, renderedAt }: { bookings: RentalBooking[]; renderedAt: Date }) {
  return (
    <div className="application-table-wrap">
      <table className="application-table booking-table">
        <thead><tr><th>Товар</th><th>Получить до</th><th>Арендатор</th><th>Экземпляр</th><th>Статус</th></tr></thead>
        <tbody>{bookings.map((booking) => (
          <tr key={booking.id}>
            <td data-label="Товар"><div className="application-product-cell"><ProductThumb booking={booking} /><div><RouterLink className="booking-row-link" to={`/manager/bookings/${booking.id}`}>{booking.product.name}</RouterLink><small>Бронь №BK-{booking.id}</small></div></div></td>
            <td data-label="Получить до"><strong>{formatMoscowDateTime(booking.pickup_deadline_at)}</strong><small>{deadlineHint(booking.pickup_deadline_at, renderedAt)}</small></td>
            <td data-label="Арендатор"><div className="application-person-cell"><Avatar src={booking.renter.avatar ?? undefined} alt="">{booking.renter.name.slice(0, 1)}</Avatar><strong>{booking.renter.name}</strong></div></td>
            <td data-label="Экземпляр">{booking.instance?.inventory_number ?? "—"}</td>
            <td data-label="Статус"><BookingStatus status={booking.status} /></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

export function RenterBookingsPage() {
  const query = useQuery({ queryKey: RENTER_BOOKINGS_KEY, queryFn: getRenterBookings });
  if (query.isPending) {
    return <div className="application-state" role="status"><CircularProgress /> Загрузка броней…</div>;
  }
  if (query.isError) {
    return <Alert severity="error" action={<Button onClick={() => query.refetch()}>Повторить</Button>}>Не удалось загрузить ваши брони.</Alert>;
  }
  const active = query.data.filter((booking) => ACTIVE_STATUSES.has(booking.status));
  const completed = query.data.filter((booking) => !ACTIVE_STATUSES.has(booking.status));
  return (
    <>
      <Box className="application-list-heading">
        <Box>
          <Typography component="h1" variant="h3">Мои брони</Typography>
          <Typography color="text.secondary">Активные брони и история завершённых</Typography>
        </Box>
      </Box>
      {query.data.length === 0 ? (
        <Paper variant="outlined" className="application-empty">
          <Typography component="h2" variant="h6">У вас пока нет броней</Typography>
          <Typography color="text.secondary">Подтверждённые менеджером заявки появятся здесь.</Typography>
          <Button component={RouterLink} to="/account" variant="outlined">Открыть заявки</Button>
        </Paper>
      ) : (
        <>
          <BookingCards title={`Активные · ${active.length}`} bookings={active} />
          <BookingCards title={`Завершённые · ${completed.length}`} bookings={completed} />
        </>
      )}
      <Alert severity="info">Бронь гарантирует наличие товара до срока получения, но не резервирует его на весь плановый период аренды.</Alert>
    </>
  );
}

function BookingCards({ title, bookings }: { title: string; bookings: RentalBooking[] }) {
  return (
    <section className="booking-card-section">
      <Typography component="h2" variant="h6">{title}</Typography>
      {bookings.length === 0 ? <Typography color="text.secondary">В этом разделе броней нет.</Typography> : bookings.map((booking) => (
        <Paper variant="outlined" className="renter-booking-card" key={booking.id}>
          <div className="booking-card-main">
            <div className="application-product-cell"><ProductThumb booking={booking} /><div><BookingStatus status={booking.status} /><Typography component="h3" variant="h6">{booking.product.name}</Typography><small>Менеджер: {booking.manager.name}</small></div></div>
            <div className="renter-booking-deadline"><span>Получить до</span><strong>{formatMoscowDateTime(booking.pickup_deadline_at)} МСК</strong></div>
          </div>
          <div className="booking-card-footer"><span>{booking.product.pickup_point?.full_address ?? "Адрес уточняется"}</span><Button component={RouterLink} to={`/account/bookings/${booking.id}`} variant="outlined">Открыть бронь</Button></div>
        </Paper>
      ))}
    </section>
  );
}

export function ManagerBookingDetailPage() {
  const bookingId = Number(useParams().bookingId);
  const [searchParams] = useSearchParams();
  const query = useQuery({
    queryKey: [...MANAGER_BOOKINGS_KEY, bookingId],
    queryFn: () => getManagerBooking(bookingId),
    enabled: Number.isInteger(bookingId) && bookingId > 0,
  });
  const [dialog, setDialog] = useState<"arrival" | "cancel" | null>(null);
  if (query.isPending) return <div className="application-state" role="status"><CircularProgress /> Загрузка брони…</div>;
  if (query.isError) return <Alert severity="error">Не удалось загрузить бронь.</Alert>;
  return (
    <>
      {searchParams.get("created") === "1" ? <Alert severity="success" sx={{ mb: 2 }}>Бронь создана. Экземпляр удерживается до срока получения.</Alert> : null}
      <BookingDetail booking={query.data} audience="manager" onArrival={() => setDialog("arrival")} onCancel={() => setDialog("cancel")} />
      <ArrivalDialog booking={dialog === "arrival" ? query.data : null} onClose={() => setDialog(null)} />
      <CancelBookingDialog audience="manager" booking={dialog === "cancel" ? query.data : null} onClose={() => setDialog(null)} />
    </>
  );
}

export function RenterBookingDetailPage() {
  const bookingId = Number(useParams().bookingId);
  const query = useQuery({
    queryKey: [...RENTER_BOOKINGS_KEY, bookingId],
    queryFn: () => getRenterBooking(bookingId),
    enabled: Number.isInteger(bookingId) && bookingId > 0,
  });
  const [cancelOpen, setCancelOpen] = useState(false);
  if (query.isPending) return <div className="application-state" role="status"><CircularProgress /> Загрузка брони…</div>;
  if (query.isError) return <Alert severity="error">Не удалось загрузить бронь.</Alert>;
  return (
    <>
      <BookingDetail booking={query.data} audience="renter" onCancel={() => setCancelOpen(true)} />
      <CancelBookingDialog audience="renter" booking={cancelOpen ? query.data : null} onClose={() => setCancelOpen(false)} />
    </>
  );
}

interface BookingDetailProps {
  booking: RentalBooking;
  audience: "manager" | "renter";
  onArrival?: () => void;
  onCancel: () => void;
}

function BookingDetail({ booking, audience, onArrival, onCancel }: BookingDetailProps) {
  const canCancel = ACTIVE_STATUSES.has(booking.status);
  const active = booking.status === "ACTIVE";
  return (
    <>
      <Typography className="application-crumb" color="text.secondary">Бронь №BK-{booking.id}</Typography>
      <Box className="application-list-heading">
        <Box><Typography component="h1" variant="h3">{booking.product.name}</Typography><Typography color="text.secondary">{audience === "manager" ? booking.renter.name : `Менеджер: ${booking.manager.name}`}</Typography></Box>
        <BookingStatus status={booking.status} />
      </Box>
      {active ? <Paper className="booking-deadline-hero" elevation={0}><span>Товар гарантирован до</span><strong>{formatMoscowDateTime(booking.pickup_deadline_at)} МСК</strong><small>{audience === "manager" ? "Подтвердите только физическое прибытие арендатора" : "Приезжайте до указанного времени"}</small></Paper> : null}
      {booking.status === "ARRIVED" ? <Alert severity="success" sx={{ mb: 2 }}><strong>Арендатор прибыл.</strong> Автоматическое истечение остановлено, получение оформляется. Аренда ещё не началась.</Alert> : null}
      {booking.status === "EXPIRED" ? <Alert severity="warning" sx={{ mb: 2 }}>Прибытие не было подтверждено до срока. Бронь истекла автоматически, товар больше не удерживается.</Alert> : null}
      <Box className="application-detail-layout">
        <Box>
          <Paper variant="outlined" className="application-detail-card">
            <div className="application-product-cell"><ProductThumb booking={booking} /><div><strong>{booking.product.name}</strong><small>{audience === "manager" ? `Экземпляр ${booking.instance?.inventory_number ?? "—"}` : "Один экземпляр товара"}</small></div></div>
            <dl>
              <dt>Крайний срок получения</dt><dd>{formatMoscowDateTime(booking.pickup_deadline_at)} МСК</dd>
              <dt>Плановый возврат</dt><dd>{formatMoscowDateTime(booking.planned_return_at)} МСК</dd>
              <dt>Точка самовывоза</dt><dd>{booking.product.pickup_point?.full_address ?? "Адрес не указан"}</dd>
              <dt>Зафиксированная ставка</dt><dd>{formatRubles(booking.minute_rate_snapshot)} / мин</dd>
              <dt>Стартовая стоимость</dt><dd>{formatRubles(booking.starting_price_snapshot)}</dd>
              {booking.arrival_confirmed_at ? <><dt>Прибытие подтверждено</dt><dd>{formatMoscowDateTime(booking.arrival_confirmed_at)} МСК</dd></> : null}
            </dl>
          </Paper>
          <Paper variant="outlined" className="application-detail-card">
            <Typography component="h2" variant="h6">История</Typography>
            <ol className="application-timeline">{booking.history.map((event) => <li key={`${event.event}-${event.created_at}`}><span aria-hidden="true" /><div><strong>{bookingHistoryLabel(event.event)}</strong><small>{formatMoscowDateTime(event.created_at)} МСК · {actorLabel(event.actor)}{event.note ? ` · ${event.note}` : ""}</small></div></li>)}</ol>
          </Paper>
        </Box>
        <aside>
          <Paper variant="outlined" className="booking-action-card">
            {active && audience === "manager" ? <><Typography component="h2" variant="h6">Арендатор приехал?</Typography><Typography color="text.secondary">Подтверждение остановит автоистечение, но не начнёт аренду.</Typography><Button variant="contained" fullWidth onClick={onArrival}>Подтвердить прибытие</Button></> : null}
            {booking.status === "ARRIVED" ? <><Typography component="h2" variant="h6">Получение оформляется</Typography><Typography color="text.secondary">Выдача и фотоакт будут реализованы на следующем этапе.</Typography></> : null}
            {canCancel ? <Button color="error" variant="outlined" fullWidth onClick={onCancel}>Отменить бронь</Button> : null}
          </Paper>
          <Alert severity="info" sx={{ mt: 2 }}>Бронь гарантирует наличие товара только до срока получения, а не до планового возврата.</Alert>
        </aside>
      </Box>
    </>
  );
}

function ArrivalDialog({ booking, onClose }: { booking: RentalBooking | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => confirmBookingArrival(booking!.id),
    onSuccess: (confirmed) => {
      queryClient.setQueryData([...MANAGER_BOOKINGS_KEY, confirmed.id], confirmed);
      queryClient.invalidateQueries({ queryKey: MANAGER_BOOKINGS_KEY });
      onClose();
    },
  });
  return <Dialog open={Boolean(booking)} onClose={onClose} aria-labelledby="arrival-dialog-title"><DialogTitle id="arrival-dialog-title">Арендатор уже прибыл?</DialogTitle><DialogContent><Typography><strong>{booking?.renter.name}</strong> · {booking?.product.name}</Typography><Typography sx={{ mt: 2 }}>Подтверждайте только физическое прибытие. Автоистечение остановится, экземпляр перейдёт в «Получение оформляется», но аренда и расчёт времени не начнутся.</Typography>{mutation.isError ? <Alert severity="error" sx={{ mt: 2 }}>Не удалось подтвердить прибытие. Возможно, срок уже прошёл; обновите страницу.</Alert> : null}</DialogContent><DialogActions><Button onClick={onClose}>Не подтверждать</Button><Button variant="contained" disabled={mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? "Подтверждаем…" : "Подтвердить прибытие"}</Button></DialogActions></Dialog>;
}

function CancelBookingDialog({ audience, booking, onClose }: { audience: "manager" | "renter"; booking: RentalBooking | null; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const mutation = useMutation({
    mutationFn: () => audience === "manager"
      ? cancelManagerBooking(booking!.id, reason)
      : cancelRenterBooking(booking!.id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: audience === "manager" ? MANAGER_BOOKINGS_KEY : RENTER_BOOKINGS_KEY });
      onClose();
      navigate(audience === "manager" ? "/manager/bookings" : "/account/bookings");
    },
  });
  return <Dialog open={Boolean(booking)} onClose={onClose} aria-labelledby="cancel-booking-title"><DialogTitle id="cancel-booking-title">Отменить бронь?</DialogTitle><DialogContent><Typography><strong>{booking?.product.name}</strong><br />Получение до {booking ? formatMoscowDateTime(booking.pickup_deadline_at) : ""} МСК</Typography><Typography sx={{ mt: 2 }}>Бронь прекратится без штрафа, удерживаемый экземпляр сразу станет доступен другим арендаторам.{audience === "manager" ? " Арендатор увидит отмену." : ""}</Typography><TextField name="booking_cancellation_reason" autoComplete="off" fullWidth multiline minRows={3} label="Причина отмены (необязательно)" value={reason} onChange={(event) => setReason(event.target.value)} sx={{ mt: 2 }} />{mutation.isError ? <Alert severity="error" sx={{ mt: 2 }}>Не удалось отменить бронь.</Alert> : null}</DialogContent><DialogActions><Button onClick={onClose}>Не отменять</Button><Button color="error" variant="contained" disabled={mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? "Отменяем…" : "Отменить бронь"}</Button></DialogActions></Dialog>;
}

function ProductThumb({ booking }: { booking: RentalBooking }) {
  return <div className="application-thumb">{booking.product.primary_photo ? <img src={booking.product.primary_photo.url} alt="" width="56" height="56" loading="lazy" /> : null}</div>;
}

function BookingStatus({ status }: { status: RentalBooking["status"] }) {
  const labels: Record<RentalBooking["status"], string> = {
    ACTIVE: "Ждёт арендатора",
    ARRIVED: "Арендатор прибыл",
    CANCELLED: "Отменена",
    EXPIRED: "Истекла автоматически",
  };
  const color = status === "ARRIVED" ? "success" : status === "ACTIVE" ? "primary" : "warning";
  return <Chip size="small" color={color} label={labels[status]} />;
}

function bookingHistoryLabel(event: RentalBooking["history"][number]["event"]): string {
  if (event === "CREATED") return "Бронь создана";
  if (event === "ARRIVAL_CONFIRMED") return "Прибытие подтверждено";
  if (event === "EXPIRED") return "Бронь истекла автоматически";
  return "Бронь отменена";
}

function actorLabel(actor: RentalBooking["history"][number]["actor"]): string {
  if (actor === "RENTER") return "Арендатор";
  if (actor === "MANAGER") return "Менеджер";
  return "Система";
}

function deadlineHint(deadline: string, renderedAt: Date): string {
  const minutes = Math.max(0, Math.ceil((new Date(deadline).getTime() - renderedAt.getTime()) / 60_000));
  if (minutes < 60) return `осталось ${minutes} мин`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return `осталось ${hours} ч`;
  return `осталось ${Math.ceil(hours / 24)} дн`;
}
