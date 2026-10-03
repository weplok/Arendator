import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link as RouterLink, useNavigate, useParams } from "react-router-dom";

import {
  getRental,
  getRentals,
  receiveRentalReturn,
  RENTALS_KEY,
  type Rental,
} from "../api/bookings";
import { formatMoscowDateTime, formatRubles } from "./formatting";
import "./rental.css";

export function RenterRentalSummary() {
  const query = useQuery({
    queryKey: RENTALS_KEY,
    queryFn: getRentals,
    refetchInterval: 60_000,
  });
  const activeRental = query.data?.find((rental) => rental.status !== "COMPLETED");
  if (!activeRental) return null;
  return (
    <Box className="renter-rental-summary">
      <RouterLink className="rental-card-link" to={`/account/rentals/${activeRental.id}`}>
        <RentalHero rental={activeRental} audience="renter" compact />
      </RouterLink>
    </Box>
  );
}

export function RentalDetailPage({ audience }: { audience: "manager" | "renter" }) {
  const rentalId = Number(useParams().rentalId);
  const query = useQuery({
    queryKey: [...RENTALS_KEY, rentalId],
    queryFn: () => getRental(rentalId),
    enabled: Number.isInteger(rentalId) && rentalId > 0,
    refetchInterval: 60_000,
  });
  if (query.isPending) {
    return <Box className="application-state" role="status"><CircularProgress /> Загрузка аренды…</Box>;
  }
  if (query.isError) {
    return <Alert severity="error" action={<Button onClick={() => query.refetch()}>Повторить</Button>}>Не удалось загрузить аренду.</Alert>;
  }
  const rental = query.data;
  const returnPath = audience === "manager"
    ? `/manager/rentals/${rental.id}/return`
    : `/account/rentals/${rental.id}/return`;
  return (
    <Box className="rental-page">
      <RentalHero rental={rental} audience={audience} />
      <Box className="rental-detail-grid">
        <Paper variant="outlined" className="rental-detail-card">
          <Typography component="h2" variant="h6">Расчётная стоимость</Typography>
          <dl className="rental-cost-list">
            <dt>Стартовая стоимость</dt><dd>{formatRubles(rental.starting_price_snapshot)}</dd>
            <dt>Своевременные минуты · {rental.timely_minutes}</dt><dd>{formatRubles(rental.timely_cost)}</dd>
            {rental.status === "COMPLETED" || rental.late_minutes > 0 ? <><dt className={rental.late_minutes > 0 ? "is-overdue" : undefined}>Просроченные минуты · {rental.late_minutes}</dt><dd className={rental.late_minutes > 0 ? "is-overdue" : undefined}>{formatRubles(rental.late_cost)}</dd></> : null}
            {rental.status === "COMPLETED" || Number(rental.damage_amount) > 0 ? <><dt>Штраф за повреждение</dt><dd>{formatRubles(rental.damage_amount)}</dd></> : null}
            <dt>Итого сейчас</dt><dd>{formatRubles(rental.current_cost)}</dd>
          </dl>
          <Typography variant="body2" color="text.secondary">Расчётная сумма, без реального списания.</Typography>
        </Paper>
        <Paper variant="outlined" className="rental-detail-card">
          <Typography component="h2" variant="h6">Детали аренды</Typography>
          <dl className="rental-cost-list">
            <dt>Начало</dt><dd>{formatMoscowDateTime(rental.rental_started_at)} МСК</dd>
            <dt>Плановый возврат</dt><dd>{formatMoscowDateTime(rental.planned_return_at)} МСК</dd>
            {rental.return_received_at ? <><dt>Фактически вернули</dt><dd>{formatMoscowDateTime(rental.return_received_at)} МСК</dd></> : null}
            <dt>Минутная ставка</dt><dd>{formatRubles(rental.minute_rate_snapshot)} / мин</dd>
            {audience === "manager" ? <><dt>Арендатор</dt><dd>{rental.renter.name}</dd><dt>Экземпляр</dt><dd>{rental.instance?.inventory_number ?? "—"}</dd></> : null}
          </dl>
          {rental.status === "RETURN_INSPECTION" ? (
            <Alert
              severity="success"
              action={<Button component={RouterLink} to={returnPath}>Оформить возврат</Button>}
            >
              Начисление остановлено. Завершите фотоакт возврата.
            </Alert>
          ) : rental.status === "COMPLETED" ? (
            <Alert
              severity="success"
              action={<Button component={RouterLink} to={returnPath}>Открыть квитанцию</Button>}
            >
              Возврат завершён.
            </Alert>
          ) : audience === "manager" ? (
            <ReceiveReturnAction rental={rental} />
          ) : (
            <Alert severity="info">Возврат начинает менеджер после физического получения товара.</Alert>
          )}
        </Paper>
      </Box>
    </Box>
  );
}

export function ManagerRentalsPage() {
  const query = useQuery({
    queryKey: RENTALS_KEY,
    queryFn: getRentals,
    refetchInterval: 60_000,
  });
  if (query.isPending) {
    return <Box className="application-state" role="status"><CircularProgress /> Загрузка аренд…</Box>;
  }
  if (query.isError) return <Alert severity="error">Не удалось загрузить аренды.</Alert>;
  return (
    <>
      <Box className="application-list-heading">
        <Box><Typography component="h1" variant="h3">Аренды</Typography><Typography color="text.secondary">Активные таймеры и расчётная стоимость</Typography></Box>
      </Box>
      {query.data.length === 0 ? (
        <Paper variant="outlined" className="application-empty"><Typography variant="h6">Активных аренд пока нет</Typography></Paper>
      ) : query.data.map((rental) => (
        <Paper component={RouterLink} to={`/manager/rentals/${rental.id}`} variant="outlined" className="manager-rental-row manager-rental-row--link" key={rental.id}>
          <Box><strong>{rental.product.name}</strong><span>{rental.renter.name} · {formatDuration(rental.duration_minutes)}</span></Box>
          <Box><strong>{formatRubles(rental.current_cost)}</strong><span>{rentalStatusLabel(rental.status)}</span></Box>
        </Paper>
      ))}
    </>
  );
}

export function RenterRentalsPage() {
  const [section, setSection] = useState<"current" | "completed">("current");
  const query = useQuery({
    queryKey: RENTALS_KEY,
    queryFn: getRentals,
    refetchInterval: 60_000,
  });
  if (query.isPending) {
    return <Box className="application-state" role="status"><CircularProgress /> Загрузка аренд…</Box>;
  }
  if (query.isError) return <Alert severity="error">Не удалось загрузить аренды.</Alert>;
  const currentRentals = query.data.filter((rental) => rental.status !== "COMPLETED");
  const completedRentals = query.data.filter((rental) => rental.status === "COMPLETED");
  const visibleRentals = section === "current" ? currentRentals : completedRentals;
  return (
    <>
      <Box className="application-list-heading"><Box><Typography component="h1" variant="h3">Мои аренды</Typography><Typography color="text.secondary">Таймер и текущая расчётная стоимость</Typography></Box></Box>
      <Box className="rental-sections" aria-label="Разделы аренд">
        <Button variant={section === "current" ? "contained" : "outlined"} aria-pressed={section === "current"} onClick={() => setSection("current")}>Текущие · {currentRentals.length}</Button>
        <Button variant={section === "completed" ? "contained" : "outlined"} aria-pressed={section === "completed"} onClick={() => setSection("completed")}>Завершённые · {completedRentals.length}</Button>
      </Box>
      {visibleRentals.length === 0 ? <Paper variant="outlined" className="application-empty"><Typography variant="h6">{section === "current" ? "Текущих аренд пока нет" : "Завершённых аренд пока нет"}</Typography></Paper> : visibleRentals.map((rental) => (
        <RouterLink className="rental-card-link" to={`/account/rentals/${rental.id}`} key={rental.id}><RentalHero rental={rental} audience="renter" compact /></RouterLink>
      ))}
    </>
  );
}

function RentalHero({ rental, audience, compact = false }: {
  rental: Rental;
  audience: "manager" | "renter";
  compact?: boolean;
}) {
  const overdue = rental.status === "OVERDUE";
  const stopped = rental.status === "RETURN_INSPECTION" || rental.status === "COMPLETED";
  const completed = rental.status === "COMPLETED";
  return (
    <Paper className={`rental-hero ${overdue ? "is-overdue" : ""} ${completed ? "is-completed" : ""} ${compact ? "is-compact" : ""}`} elevation={0}>
      <Box className="rental-hero-head">
        <Box>
          <Typography className="rental-eyebrow">{completed ? "Аренда завершена" : stopped ? "Начисление остановлено" : overdue ? "Просрочка" : "Активная аренда"}</Typography>
          <Typography component={compact ? "h2" : "h1"}>{rental.product.name}</Typography>
          <Typography>{audience === "manager" ? `Арендатор: ${rental.renter.name}` : completed ? "Возврат оформлен" : stopped ? "Оформляется фотоакт возврата" : "Расчётная стоимость обновляется раз в минуту"}</Typography>
        </Box>
      </Box>
      <Box className="rental-metrics">
        <Box><span>{stopped ? "Зафиксированная сумма" : "Стоимость сейчас"}</span><strong>{formatRubles(rental.current_cost)}</strong><small>без реального списания</small></Box>
        <Box><span>Длительность</span><strong>{formatDuration(rental.duration_minutes)}</strong><small>с {formatMoscowDateTime(rental.rental_started_at)}</small></Box>
        <Box><span>{overdue ? "Штрафное время" : "Плановый возврат"}</span><strong>{overdue ? formatDuration(rental.late_minutes) : formatMoscowDateTime(rental.planned_return_at)}</strong><small>{overdue ? "двойная минутная ставка" : "МСК"}</small></Box>
      </Box>
    </Paper>
  );
}

function ReceiveReturnAction({ rental }: { rental: Rental }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const receive = useMutation({
    mutationFn: () => receiveRentalReturn(rental.id),
    onSuccess: (updated) => {
      queryClient.setQueryData([...RENTALS_KEY, rental.id], updated);
      queryClient.invalidateQueries({ queryKey: RENTALS_KEY });
      navigate(`/manager/rentals/${rental.id}/return`);
    },
  });
  return (
    <>
      <Button variant="contained" onClick={() => setOpen(true)}>
        Оборудование принесено на возврат
      </Button>
      <Dialog className="return-receive-dialog" open={open} onClose={() => !receive.isPending && setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Подтвердить физический возврат?</DialogTitle>
        <DialogContent>
          <Typography component="p" sx={{ mb: 2 }}>
            {rental.product.name} · {rental.renter.name}
          </Typography>
          <Typography component="p" sx={{ mb: 2 }}>
            Текущая расчётная сумма: <strong>{formatRubles(rental.current_cost)}</strong>.
          </Typography>
          <Alert severity="warning">
            После подтверждения сервер зафиксирует точное время и остановит начисление.
            Осмотр и фотофиксация не оплачиваются.
          </Alert>
          {receive.isError ? <Alert severity="error" sx={{ mt: 2 }}>Не удалось принять возврат. Попробуйте ещё раз.</Alert> : null}
        </DialogContent>
        <DialogActions>
          <Button disabled={receive.isPending} onClick={() => setOpen(false)}>Отмена</Button>
          <Button variant="contained" disabled={receive.isPending} onClick={() => receive.mutate()}>
            {receive.isPending ? "Останавливаем начисление…" : "Подтвердить приём"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

function rentalStatusLabel(status: Rental["status"]): string {
  if (status === "OVERDUE") return "Просрочка";
  if (status === "RETURN_INSPECTION") return "Оформляется возврат";
  if (status === "COMPLETED") return "Завершена";
  return "Активна";
}

function formatDuration(totalMinutes: number): string {
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days} д ${hours} ч`;
  if (hours > 0) return `${hours} ч ${minutes} мин`;
  return `${minutes} мин`;
}
