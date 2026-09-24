import {
  Alert,
  Avatar,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  FormControl,
  FormHelperText,
  FormLabel,
  MenuItem,
  Paper,
  Radio,
  RadioGroup,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { Link as RouterLink, useNavigate, useParams } from "react-router-dom";

import {
  cancelManagerApplication,
  createBookingFromApplication,
  getManagerApplication,
  getManagerApplications,
  MANAGER_APPLICATIONS_KEY,
  type ManagerApplicationOrdering,
  type ManagerApplicationPreferences,
  type RentalApplication,
  updateManagerApplicationPreferences,
} from "../api/applications";
import { ApiError } from "../api/client";
import { parseCreatedBooking } from "../api/bookings";
import { ApplicationDetail } from "./RenterApplications";
import {
  formatMoscowDateTime,
  formatPlannedDuration,
  formatRelativeTime,
} from "./formatting";
import "./applications.css";

const ORDERING_LABELS: Record<ManagerApplicationOrdering, string> = {
  EARLIEST: "Сначала ранние",
  LATEST: "Сначала поздние",
  NEAREST: "Ближайшие",
};

export function ManagerApplicationsPage() {
  const query = useQuery({
    queryKey: MANAGER_APPLICATIONS_KEY,
    queryFn: getManagerApplications,
  });
  const queryClient = useQueryClient();
  const [renderedAt] = useState(() => new Date());
  const [saved, setSaved] = useState(false);
  const preferenceMutation = useMutation({
    mutationFn: updateManagerApplicationPreferences,
    onSuccess: (preferences) => {
      queryClient.setQueryData(MANAGER_APPLICATIONS_KEY, (current: typeof query.data) =>
        current ? { ...current, preferences } : current,
      );
      queryClient.invalidateQueries({ queryKey: MANAGER_APPLICATIONS_KEY });
      setSaved(true);
    },
  });

  if (query.isPending) return <div className="application-state" role="status"><CircularProgress /> Загрузка очереди…</div>;
  if (query.isError) return <Alert severity="error" action={<Button onClick={() => query.refetch()}>Повторить</Button>}>Не удалось загрузить очередь заявок.</Alert>;
  const { preferences, results } = query.data;

  function savePreferences(next: ManagerApplicationPreferences): void {
    setSaved(false);
    preferenceMutation.mutate(next);
  }

  return (
    <>
      <Box className="application-list-heading">
        <Box>
          <Typography component="h1" variant="h3">Очередь заявок</Typography>
          <Typography color="text.secondary">Ожидающие заявки только на ваши товары</Typography>
        </Box>
        <span className="application-timezone">{results.length} ожидают</span>
      </Box>
      <Paper variant="outlined" className="application-queue-controls">
        <TextField
          name="application_queue_ordering"
          select
          label="Сортировка"
          value={preferences.ordering}
          disabled={preferenceMutation.isPending}
          onChange={(event) => savePreferences({
            ...preferences,
            ordering: event.target.value as ManagerApplicationOrdering,
          })}
        >
          {Object.entries(ORDERING_LABELS).map(([value, label]) => (
            <MenuItem value={value} key={value}>{label}</MenuItem>
          ))}
        </TextField>
        <FormControlLabel
          control={(
            <Checkbox
              name="hide_unavailable_applications"
              checked={preferences.hide_unavailable}
              disabled={preferenceMutation.isPending}
              onChange={(event) => savePreferences({
                ...preferences,
                hide_unavailable: event.target.checked,
              })}
            />
          )}
          label="Скрыть товары без свободных экземпляров"
        />
        <Typography role="status" color="primary" variant="body2">
          {saved ? "Настройки сохранены" : ""}
        </Typography>
      </Paper>
      {preferenceMutation.isError ? <Alert severity="error" sx={{ mt: 2 }}>Не удалось сохранить настройки.</Alert> : null}
      <Alert severity="info" sx={{ mt: 2 }}>
        При любой сортировке первыми идут заявки на товары со свободными экземплярами. Вы сами выбираете, какую заявку обработать.
      </Alert>
      <Paper variant="outlined" className="application-table-surface application-queue-surface">
        {results.length === 0 ? (
          <div className="application-empty"><Typography component="h2" variant="h6">Новых заявок нет</Typography><Typography color="text.secondary">Сохранённые настройки очереди продолжат действовать.</Typography></div>
        ) : <ManagerQueueTable applications={results} ordering={preferences.ordering} renderedAt={renderedAt} />}
      </Paper>
    </>
  );
}

function ManagerQueueTable({ applications, ordering, renderedAt }: { applications: RentalApplication[]; ordering: ManagerApplicationOrdering; renderedAt: Date }) {
  return (
    <div className="application-table-wrap">
      <table className="application-table application-queue-table">
        <thead><tr>
          <th>Товар</th>
          <th aria-sort={ordering === "NEAREST" ? "ascending" : "none"}>Получить до</th>
          <th>Плановый срок</th>
          <th aria-sort={ordering === "EARLIEST" ? "ascending" : ordering === "LATEST" ? "descending" : "none"}>Арендатор</th>
          <th>Действие</th>
        </tr></thead>
        <tbody>{applications.map((application, index) => {
          const available = application.product.available_instances_count > 0;
          const previousAvailable = index > 0
            ? applications[index - 1].product.available_instances_count > 0
            : null;
          const showGroup = index === 0 || available !== previousAvailable;
          return (
            <Fragment key={application.id}>
              {showGroup ? <tr className="application-group-row"><td colSpan={5}>{available ? "Есть свободные экземпляры" : "Нет свободных экземпляров"}</td></tr> : null}
              <tr>
                <td data-label="Товар"><div className="application-product-cell"><div className="application-thumb">{application.product.primary_photo ? <img src={application.product.primary_photo.url} alt="" width="56" height="56" loading="lazy" /> : null}</div><div><strong>{application.product.name}</strong><small className={available ? "application-available" : ""}>Свободно: {application.product.available_instances_count} из {application.product.total_instances_count}</small></div></div></td>
                <td data-label="Получить до">{formatMoscowDateTime(application.pickup_deadline_at)}<small>{deadlineHint(application.pickup_deadline_at, renderedAt)}</small></td>
                <td data-label="Плановый срок">{formatPlannedDuration(application.pickup_deadline_at, application.planned_return_at)}</td>
                <td data-label="Арендатор"><div className="application-person-cell"><Avatar src={application.renter.avatar ?? undefined} alt="">{application.renter.name.slice(0, 1)}</Avatar><div><strong>{application.renter.name}</strong><time dateTime={application.created_at} title={formatMoscowDateTime(application.created_at)} aria-label={`Подана ${formatMoscowDateTime(application.created_at)} по Москве`}>{formatRelativeTime(application.created_at, renderedAt)}</time></div></div></td>
                <td data-label="Действие"><Button component={RouterLink} to={`/manager/applications/${application.id}`} variant="outlined" size="small">Открыть</Button></td>
              </tr>
            </Fragment>
          );
        })}</tbody>
      </table>
    </div>
  );
}

export function ManagerApplicationDetailPage() {
  const applicationId = Number(useParams().applicationId);
  const query = useQuery({
    queryKey: [...MANAGER_APPLICATIONS_KEY, applicationId],
    queryFn: () => getManagerApplication(applicationId),
    enabled: Number.isInteger(applicationId) && applicationId > 0,
  });
  const [cancelOpen, setCancelOpen] = useState(false);

  if (query.isPending) return <div className="application-state" role="status"><CircularProgress /> Загрузка заявки…</div>;
  if (query.isError) return <Alert severity="error">Не удалось загрузить заявку.</Alert>;
  return (
    <>
      <ApplicationDetail
        application={query.data}
        audience="manager"
        managerActions={<BookingAssignment application={query.data} onConflict={() => query.refetch()} />}
        onCancel={() => setCancelOpen(true)}
      />
      <ManagerCancelDialog application={cancelOpen ? query.data : null} onClose={() => setCancelOpen(false)} />
    </>
  );
}

function BookingAssignment({ application, onConflict }: { application: RentalApplication; onConflict: () => void }) {
  const [selectedInstanceId, setSelectedInstanceId] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const navigate = useNavigate();
  const availableCount = application.instances?.filter((instance) => instance.status === "AVAILABLE").length ?? 0;
  const mutation = useMutation({
    mutationFn: async () => parseCreatedBooking(
      await createBookingFromApplication(application.id, selectedInstanceId),
    ),
    onSuccess: (booking) => navigate(`/manager/bookings/${booking.id}?created=1`),
    onError: (error) => {
      if (error instanceof ApiError && error.code === "instance_unavailable") {
        setConfirmOpen(false);
        setSelectedInstanceId("");
        onConflict();
      }
    },
  });

  if (application.status !== "WAITING") {
    return <Alert severity="info" sx={{ mt: 2 }}>Эта заявка больше не ожидает назначения.</Alert>;
  }
  return <>
    <Paper variant="outlined" className="booking-assignment-card">
      <Typography component="h2" variant="h6">Назначить экземпляр</Typography>
      <Chip
        color={availableCount > 0 ? "success" : "default"}
        label={availableCount > 0 ? `Можно забронировать · ${availableCount} свободно` : "Пока нельзя забронировать · свободно 0"}
        sx={{ my: 2 }}
      />
      {application.instances?.length ? (
        <FormControl error={mutation.isError} fullWidth>
          <FormLabel id="instance-selection-label">Экземпляры товара</FormLabel>
          <RadioGroup
            aria-labelledby="instance-selection-label"
            name="booking_instance"
            value={selectedInstanceId}
            onChange={(event) => setSelectedInstanceId(event.target.value)}
          >
            {application.instances.map((instance) => (
              <FormControlLabel
                key={instance.id}
                value={instance.id}
                disabled={instance.status !== "AVAILABLE"}
                control={<Radio />}
                label={`${instance.inventory_number} · ${instance.status_label}`}
              />
            ))}
          </RadioGroup>
          <FormHelperText>
            {mutation.isError ? "Выбранный экземпляр уже недоступен. Список обновлён — выберите другой." : "Автоматического выбора нет. Доступность проверится ещё раз при создании брони."}
          </FormHelperText>
        </FormControl>
      ) : <Typography color="text.secondary">У товара нет активных экземпляров.</Typography>}
      <Button
        variant="contained"
        fullWidth
        disabled={!selectedInstanceId || availableCount === 0}
        onClick={() => setConfirmOpen(true)}
        sx={{ mt: 2 }}
      >
        Проверить и создать бронь
      </Button>
    </Paper>
    <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} aria-labelledby="confirm-booking-title">
      <DialogTitle id="confirm-booking-title">Проверить бронь</DialogTitle>
      <DialogContent>
        <Typography><strong>{application.renter.name}</strong> · {application.product.name}</Typography>
        <Typography sx={{ mt: 2 }}>Экземпляр: <strong>{application.instances?.find((instance) => instance.id === selectedInstanceId)?.inventory_number}</strong></Typography>
        <Typography>Удерживать до {formatMoscowDateTime(application.pickup_deadline_at)} МСК</Typography>
        <Alert severity="info" sx={{ mt: 2 }}>Плановый возврат не создаёт интервальную бронь. Экземпляр удерживается только до срока получения.</Alert>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setConfirmOpen(false)}>Назад</Button>
        <Button variant="contained" disabled={mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? "Создаём…" : "Создать бронь"}</Button>
      </DialogActions>
    </Dialog>
  </>;
}

function ManagerCancelDialog({ application, onClose }: { application: RentalApplication | null; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const mutation = useMutation({
    mutationFn: () => cancelManagerApplication(application!.id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MANAGER_APPLICATIONS_KEY });
      onClose();
      navigate("/manager/applications");
    },
  });
  return (
    <Dialog open={Boolean(application)} onClose={onClose} aria-labelledby="manager-cancel-title">
      <DialogTitle id="manager-cancel-title">Отменить заявку?</DialogTitle>
      <DialogContent>
        <Typography>{application?.product.name}</Typography>
        {application ? <Typography color="text.secondary">Получить до {formatMoscowDateTime(application.pickup_deadline_at)} МСК</Typography> : null}
        <TextField name="manager_cancellation_reason" autoComplete="off" fullWidth multiline minRows={3} label="Причина отмены (необязательно)" value={reason} onChange={(event) => setReason(event.target.value)} sx={{ mt: 2 }} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Не отменять</Button>
        <Button color="error" variant="contained" disabled={mutation.isPending} onClick={() => mutation.mutate()}>Отменить заявку</Button>
      </DialogActions>
    </Dialog>
  );
}

function deadlineHint(deadline: string, renderedAt: Date): string {
  const milliseconds = new Date(deadline).getTime() - renderedAt.getTime();
  const hours = Math.max(0, Math.ceil(milliseconds / 3_600_000));
  if (hours < 24) return `через ${hours} ч`;
  return `через ${Math.ceil(hours / 24)} дн`;
}
