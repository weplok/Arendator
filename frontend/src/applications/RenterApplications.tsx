import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
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
  NavLink,
  Outlet,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";

import {
  cancelRenterApplication,
  getRenterApplication,
  getRenterApplications,
  RENTER_APPLICATIONS_KEY,
  type RentalApplication,
} from "../api/applications";
import { formatRate } from "../catalog/formatting";
import { formatMoscowDateTime, formatRubles } from "./formatting";
import "./applications.css";

export function RenterLayout() {
  return (
    <Container maxWidth={false} className="renter-layout">
      <nav className="renter-sidebar" aria-label="Кабинет арендатора">
        <span className="renter-sidebar__caption">Кабинет арендатора</span>
        <NavLink to="/account" end>Заявки</NavLink>
        <span className="renter-sidebar__disabled">Брони</span>
        <span className="renter-sidebar__disabled">Аренды</span>
        <p>На этом этапе доступны подача, просмотр и отмена ожидающих заявок.</p>
      </nav>
      <div className="renter-main"><Outlet /></div>
    </Container>
  );
}

export function RenterApplicationsPage() {
  const query = useQuery({
    queryKey: RENTER_APPLICATIONS_KEY,
    queryFn: getRenterApplications,
  });
  const [selected, setSelected] = useState<RentalApplication | null>(null);

  if (query.isPending) {
    return <div className="application-state" role="status"><CircularProgress /> Загрузка заявок…</div>;
  }
  if (query.isError) {
    return (
      <Alert severity="error" action={<Button onClick={() => query.refetch()}>Повторить</Button>}>
        Не удалось загрузить ваши заявки.
      </Alert>
    );
  }
  const waiting = query.data.filter((application) => application.status === "WAITING");
  const completed = query.data.filter((application) => application.status !== "WAITING");
  return (
    <>
      <Box className="application-list-heading">
        <Box>
          <Typography component="h1" variant="h3">Мои заявки</Typography>
          <Typography color="text.secondary">Ожидающие и завершённые заявки на аренду</Typography>
        </Box>
        <Button component={RouterLink} to="/" variant="outlined">Перейти в каталог</Button>
      </Box>
      {query.data.length === 0 ? (
        <Paper variant="outlined" className="application-empty">
          <Typography component="h2" variant="h6">У вас пока нет заявок</Typography>
          <Typography color="text.secondary">Выберите товар в каталоге и укажите удобные сроки.</Typography>
          <Button component={RouterLink} to="/" variant="contained">Открыть каталог</Button>
        </Paper>
      ) : (
        <>
          <ApplicationTable title={`Ожидают · ${waiting.length}`} applications={waiting} onCancel={setSelected} />
          <ApplicationTable title={`Завершены · ${completed.length}`} applications={completed} onCancel={setSelected} />
        </>
      )}
      <CancelApplicationDialog application={selected} onClose={() => setSelected(null)} />
    </>
  );
}

interface ApplicationTableProps {
  title: string;
  applications: RentalApplication[];
  onCancel: (application: RentalApplication) => void;
}

function ApplicationTable({ title, applications, onCancel }: ApplicationTableProps) {
  return (
    <Paper variant="outlined" className="application-table-surface">
      <Typography component="h2" variant="h6">{title}</Typography>
      {applications.length === 0 ? (
        <Typography color="text.secondary" sx={{ mt: 2 }}>В этом разделе заявок нет.</Typography>
      ) : (
        <div className="application-table-wrap">
          <table className="application-table">
            <thead><tr><th>Товар</th><th>Получить до</th><th>Вернуть</th><th>Статус</th><th>Действия</th></tr></thead>
            <tbody>{applications.map((application) => (
              <tr key={application.id}>
                <td data-label="Товар"><ApplicationProductCell application={application} /></td>
                <td data-label="Получить до">{formatMoscowDateTime(application.pickup_deadline_at)}</td>
                <td data-label="Вернуть">{formatMoscowDateTime(application.planned_return_at)}</td>
                <td data-label="Статус"><ApplicationStatus status={application.status} /></td>
                <td data-label="Действия"><div className="application-row-actions">
                  <Button component={RouterLink} to={`/account/applications/${application.id}`} size="small">Открыть</Button>
                  {application.status === "WAITING" ? <Button color="error" size="small" onClick={() => onCancel(application)}>Отменить</Button> : null}
                </div></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </Paper>
  );
}

function ApplicationProductCell({ application }: { application: RentalApplication }) {
  return (
    <div className="application-product-cell">
      <div className="application-thumb">
        {application.product.primary_photo ? <img src={application.product.primary_photo.url} alt="" width="56" height="56" loading="lazy" /> : null}
      </div>
      <div><strong>{application.product.name}</strong><small>{formatRate(application.product.minute_rate)} ₽/мин</small></div>
    </div>
  );
}

export function ApplicationStatus({ status }: { status: RentalApplication["status"] }) {
  const labels = {
    WAITING: "Ожидает решения",
    CANCELLED: "Отменена",
    EXPIRED: "Срок получения истёк",
  } as const;
  return <Chip size="small" color={status === "WAITING" ? "default" : "warning"} label={labels[status]} />;
}

export function RenterApplicationDetailPage() {
  const applicationId = Number(useParams().applicationId);
  const [searchParams] = useSearchParams();
  const query = useQuery({
    queryKey: [...RENTER_APPLICATIONS_KEY, applicationId],
    queryFn: () => getRenterApplication(applicationId),
    enabled: Number.isInteger(applicationId) && applicationId > 0,
  });
  const [cancelOpen, setCancelOpen] = useState(false);

  if (query.isPending) return <div className="application-state" role="status"><CircularProgress /> Загрузка заявки…</div>;
  if (query.isError) return <Alert severity="error">Не удалось загрузить заявку.</Alert>;
  return (
    <>
      {searchParams.get("created") === "1" ? (
        <Alert severity="success" sx={{ mb: 2 }}>
          Заявка создана и ожидает решения менеджера. Это ещё не бронь.
        </Alert>
      ) : null}
      <ApplicationDetail application={query.data} audience="renter" onCancel={() => setCancelOpen(true)} />
      <CancelApplicationDialog
        application={cancelOpen ? query.data : null}
        onClose={() => setCancelOpen(false)}
      />
    </>
  );
}

interface ApplicationDetailProps {
  application: RentalApplication;
  audience: "renter" | "manager";
  onCancel: () => void;
}

export function ApplicationDetail({ application, audience, onCancel }: ApplicationDetailProps) {
  return (
    <>
      <Typography className="application-crumb" color="text.secondary">
        Заявка №AR-{application.id}
      </Typography>
      <Box className="application-list-heading">
        <Box>
          <Typography component="h1" variant="h3">{application.product.name}</Typography>
          <Typography color="text.secondary">Заявка на один экземпляр</Typography>
        </Box>
        <ApplicationStatus status={application.status} />
      </Box>
      <Box className="application-detail-layout">
        <Box>
          <Paper variant="outlined" className="application-detail-card">
            <ApplicationProductCell application={application} />
            <dl>
              <dt>Крайний срок получения</dt><dd>{formatMoscowDateTime(application.pickup_deadline_at)} МСК</dd>
              <dt>Плановый возврат</dt><dd>{formatMoscowDateTime(application.planned_return_at)} МСК</dd>
              <dt>Место выдачи</dt><dd>{application.product.pickup_point?.full_address ?? "Адрес не указан"}</dd>
              <dt>Примерная стоимость</dt><dd>{formatRubles(application.estimated_cost)}</dd>
            </dl>
          </Paper>
          <Paper variant="outlined" className="application-detail-card">
            <Typography component="h2" variant="h6">История</Typography>
            <ol className="application-timeline">
              {application.history.map((event) => (
                <li key={`${event.event}-${event.created_at}`}>
                  <span aria-hidden="true" />
                  <div><strong>{historyLabel(event.event)}</strong><small>{formatMoscowDateTime(event.created_at)} МСК{event.note ? ` · ${event.note}` : ""}</small></div>
                </li>
              ))}
            </ol>
          </Paper>
        </Box>
        <aside>
          {audience === "renter" ? (
            <Alert severity="info">Это ещё не бронь. Дождитесь решения менеджера.</Alert>
          ) : (
            <Paper variant="outlined" className="application-renter-card">
              <Avatar src={application.renter.avatar ?? undefined} alt="">{application.renter.name.slice(0, 1)}</Avatar>
              <div><small>Арендатор</small><strong>{application.renter.name}</strong></div>
            </Paper>
          )}
          {audience === "manager" ? <Button variant="contained" fullWidth disabled sx={{ mt: 2 }}>Забронировать</Button> : null}
          {audience === "manager" ? <Typography color="text.secondary" variant="caption">Бронирование будет доступно на следующем этапе.</Typography> : null}
          {application.status === "WAITING" ? <Button color="error" variant="outlined" fullWidth sx={{ mt: 2 }} onClick={onCancel}>Отменить заявку</Button> : null}
        </aside>
      </Box>
    </>
  );
}

function CancelApplicationDialog({ application, onClose }: { application: RentalApplication | null; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const mutation = useMutation({
    mutationFn: () => cancelRenterApplication(application!.id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: RENTER_APPLICATIONS_KEY });
      onClose();
      navigate("/account");
    },
  });
  return (
    <Dialog open={Boolean(application)} onClose={onClose} aria-labelledby="cancel-application-title">
      <DialogTitle id="cancel-application-title">Отменить заявку?</DialogTitle>
      <DialogContent>
        <Typography>{application?.product.name}</Typography>
        {application ? <Typography color="text.secondary">Получить до {formatMoscowDateTime(application.pickup_deadline_at)} МСК</Typography> : null}
        <TextField
          name="cancellation_reason"
          autoComplete="off"
          fullWidth
          multiline
          minRows={3}
          label="Причина отмены (необязательно)"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          sx={{ mt: 2 }}
        />
        {mutation.isError ? <Alert severity="error" sx={{ mt: 2 }}>Не удалось отменить заявку.</Alert> : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Не отменять</Button>
        <Button color="error" variant="contained" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? "Отменяем…" : "Отменить заявку"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function historyLabel(event: RentalApplication["history"][number]["event"]): string {
  if (event === "CREATED") return "Заявка создана";
  if (event === "EXPIRED") return "Срок получения истёк";
  return "Заявка отменена";
}
