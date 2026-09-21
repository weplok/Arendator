import {
  Alert,
  Box,
  Button,
  Checkbox,
  Container,
  FormControlLabel,
  Paper,
  Skeleton,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link as RouterLink, useNavigate, useParams } from "react-router-dom";

import {
  createApplication,
  RENTER_APPLICATIONS_KEY,
} from "../api/applications";
import { ApiError } from "../api/client";
import { getProduct } from "../api/catalog";
import { formatRate } from "../catalog/formatting";
import {
  moscowInputToDate,
  toMoscowInputParts,
} from "./formatting";
import "./applications.css";

interface FormDates {
  pickupDate: string;
  pickupTime: string;
  returnDate: string;
  returnTime: string;
}

interface FormErrors {
  summary?: string;
  pickup?: string;
  plannedReturn?: string;
  consent?: string;
  limitReached?: boolean;
}

const DEFAULT_DURATION_HOURS = 24;

export function ApplicationFormPage() {
  const productId = Number(useParams().productId);
  const query = useQuery({
    queryKey: ["catalog", "product", productId],
    queryFn: () => getProduct(productId),
    enabled: Number.isInteger(productId) && productId > 0,
  });

  if (query.isPending) {
    return (
      <Container maxWidth="lg" className="application-page">
        <Skeleton variant="rounded" height={520} />
      </Container>
    );
  }
  if (query.isError) {
    return (
      <Container maxWidth="md" className="application-page">
        <Alert
          severity="error"
          action={<Button onClick={() => query.refetch()}>Повторить</Button>}
        >
          Не удалось загрузить форму заявки.
        </Alert>
      </Container>
    );
  }
  return <ApplicationForm product={query.data} />;
}

function ApplicationForm({ product }: { product: Awaited<ReturnType<typeof getProduct>> }) {
  const [dates, setDates] = useState<FormDates>(createInitialFormDates);
  const [durationDays, setDurationDays] = useState(1);
  const [durationHours, setDurationHours] = useState(0);
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (input: { pickup_deadline_at: string; planned_return_at: string }) =>
      createApplication(product.id, input),
    onSuccess: (application) => {
      queryClient.invalidateQueries({ queryKey: RENTER_APPLICATIONS_KEY });
      navigate(`/account/applications/${application.id}?created=1`);
    },
  });

  useEffect(() => {
    if (errors.summary) errorSummaryRef.current?.focus();
  }, [errors.summary]);

  const pickup = moscowInputToDate(dates.pickupDate, dates.pickupTime);
  const plannedReturn = moscowInputToDate(dates.returnDate, dates.returnTime);
  const estimatedMinutes = pickup && plannedReturn
    ? Math.max(0, Math.ceil((plannedReturn.getTime() - pickup.getTime()) / 60_000))
    : 0;
  const estimatedCost = (estimatedMinutes + 10) * Number(product.minute_rate);

  function updatePickup(nextDates: Partial<FormDates>): void {
    const next = { ...dates, ...nextDates };
    const nextPickup = moscowInputToDate(next.pickupDate, next.pickupTime);
    if (nextPickup) {
      const duration = (durationDays * 24 + durationHours) * 3_600_000;
      const shiftedReturn = toMoscowInputParts(new Date(nextPickup.getTime() + duration));
      next.returnDate = shiftedReturn.date;
      next.returnTime = shiftedReturn.time;
    }
    setDates(next);
  }

  function updateDuration(days: number, hours: number): void {
    const safeDays = Math.max(0, days);
    const safeHours = Math.min(23, Math.max(0, hours));
    setDurationDays(safeDays);
    setDurationHours(safeHours);
    const currentPickup = moscowInputToDate(dates.pickupDate, dates.pickupTime);
    if (!currentPickup) return;
    const nextReturn = toMoscowInputParts(
      new Date(currentPickup.getTime() + (safeDays * 24 + safeHours) * 3_600_000),
    );
    setDates((current) => ({
      ...current,
      returnDate: nextReturn.date,
      returnTime: nextReturn.time,
    }));
  }

  function updateReturn(nextDates: Partial<FormDates>): void {
    const next = { ...dates, ...nextDates };
    setDates(next);
    const currentPickup = moscowInputToDate(next.pickupDate, next.pickupTime);
    const nextReturn = moscowInputToDate(next.returnDate, next.returnTime);
    if (!currentPickup || !nextReturn || nextReturn < currentPickup) return;
    const totalHours = Math.round(
      (nextReturn.getTime() - currentPickup.getTime()) / 3_600_000,
    );
    setDurationDays(Math.floor(totalHours / 24));
    setDurationHours(totalHours % 24);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const validationErrors = validateApplicationForm(pickup, plannedReturn, consent);
    if (validationErrors.summary) {
      setErrors(validationErrors);
      return;
    }
    setErrors({});
    try {
      await mutation.mutateAsync({
        pickup_deadline_at: pickup!.toISOString(),
        planned_return_at: plannedReturn!.toISOString(),
      });
    } catch (error) {
      setErrors(apiErrors(error));
    }
  }

  return (
    <Container maxWidth="lg" className="application-page">
      <Box className="application-heading">
        <Box>
          <Typography component="h1" variant="h3">Подать заявку</Typography>
          <Typography color="text.secondary">
            Укажите, до какого момента сможете забрать товар и когда планируете вернуть его.
          </Typography>
        </Box>
        <span className="application-timezone">Время по Москве</span>
      </Box>
      <Box className="application-form-layout">
        <Paper
          component="form"
          variant="outlined"
          className="application-form"
          noValidate
          onSubmit={submit}
        >
          {errors.summary ? (
            <Alert ref={errorSummaryRef} tabIndex={-1} severity="error" role="alert">
              {errors.summary}
              {errors.limitReached ? (
                <Button component={RouterLink} to="/account" color="inherit" size="small">
                  Открыть мои заявки
                </Button>
              ) : null}
            </Alert>
          ) : null}
          <fieldset>
            <legend>Крайний срок получения</legend>
            <Typography color="text.secondary" variant="body2">
              Заберите товар не позднее указанного времени.
            </Typography>
            <Box className="application-date-grid">
              <TextField
                id="pickup-date"
                name="pickup_date"
                autoComplete="off"
                label="Дата получения"
                type="date"
                value={dates.pickupDate}
                error={Boolean(errors.pickup)}
                helperText={errors.pickup}
                slotProps={{ inputLabel: { shrink: true } }}
                onChange={(event) => updatePickup({ pickupDate: event.target.value })}
              />
              <TextField
                id="pickup-time"
                name="pickup_time"
                autoComplete="off"
                label="Время получения, МСК"
                type="time"
                value={dates.pickupTime}
                slotProps={{ inputLabel: { shrink: true } }}
                onChange={(event) => updatePickup({ pickupTime: event.target.value })}
              />
            </Box>
          </fieldset>
          <fieldset>
            <legend>Плановый срок возврата</legend>
            <Typography color="text.secondary" variant="body2">
              Можно изменить точную дату либо длительность — поля связаны.
            </Typography>
            <Box className="application-date-grid">
              <TextField
                id="return-date"
                name="planned_return_date"
                autoComplete="off"
                label="Дата возврата"
                type="date"
                value={dates.returnDate}
                error={Boolean(errors.plannedReturn)}
                helperText={errors.plannedReturn}
                slotProps={{ inputLabel: { shrink: true } }}
                onChange={(event) => updateReturn({ returnDate: event.target.value })}
              />
              <TextField
                id="return-time"
                name="planned_return_time"
                autoComplete="off"
                label="Время возврата, МСК"
                type="time"
                value={dates.returnTime}
                slotProps={{ inputLabel: { shrink: true } }}
                onChange={(event) => updateReturn({ returnTime: event.target.value })}
              />
            </Box>
            <Typography className="application-sync-note" variant="body2">
              Или задайте длительность — срок возврата пересчитается автоматически
            </Typography>
            <Box className="application-date-grid">
              <TextField
                name="duration_days"
                autoComplete="off"
                label="Дней"
                type="number"
                value={durationDays}
                slotProps={{ htmlInput: { min: 0, inputMode: "numeric" } }}
                onChange={(event) => updateDuration(Number(event.target.value), durationHours)}
              />
              <TextField
                name="duration_hours"
                autoComplete="off"
                label="Часов"
                type="number"
                value={durationHours}
                slotProps={{ htmlInput: { min: 0, max: 23, inputMode: "numeric" } }}
                onChange={(event) => updateDuration(durationDays, Number(event.target.value))}
              />
            </Box>
          </fieldset>
          <Box className="application-notices">
            <Alert severity="info">
              Это только заявка: она не является бронью и не гарантирует получение экземпляра.
            </Alert>
            <Alert severity="warning">
              Просроченная минута после планового срока рассчитывается по двойной ставке до подтверждения возврата менеджером.
            </Alert>
          </Box>
          <FormControlLabel
            control={(
              <Checkbox
                name="application_conditions_acknowledged"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
              />
            )}
            label="Понимаю, что товар нужно забрать до крайнего срока, а заявка ещё не является бронью"
          />
          {errors.consent ? <Typography color="error" variant="body2">{errors.consent}</Typography> : null}
          <Box className="application-actions">
            <Button component={RouterLink} to={`/products/${product.id}`} variant="text">
              Вернуться к товару
            </Button>
            <Button type="submit" variant="contained" disabled={mutation.isPending}>
              {mutation.isPending ? "Отправляем…" : "Подать заявку"}
            </Button>
          </Box>
        </Paper>
        <aside className="application-summary">
          <Paper variant="outlined" className="application-product-summary">
            {product.primary_photo ? (
              <img src={product.primary_photo.url} alt="" width="84" height="84" />
            ) : null}
            <Box>
              <Typography component="h2" variant="h6">{product.name}</Typography>
              <Typography color="text.secondary" variant="body2">
                {product.description.slice(0, 100)}
              </Typography>
            </Box>
            <dl>
              <dt>Ставка</dt><dd>{formatRate(product.minute_rate)} ₽/мин</dd>
              <dt>Менеджер</dt><dd>{product.manager.name}</dd>
              <dt>Место выдачи</dt><dd>{product.pickup_point.full_address ?? `${product.pickup_point.city}, ${product.pickup_point.district}`}</dd>
            </dl>
          </Paper>
          <Box className="application-cost-summary">
            <Typography variant="body2">Примерная стоимость</Typography>
            <strong>{new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(estimatedCost)} ₽</strong>
            <small>
              Включает стоимость выбранного времени и обязательные первые 10 минут. Фактический расчёт начнётся только после выдачи.
            </small>
          </Box>
          <div className="application-counter">
            <span>После подачи</span>
            <strong>{product.current_user_pending_applications_count + 1} из {product.total_instances_count} заявок</strong>
          </div>
        </aside>
      </Box>
    </Container>
  );
}

function validateApplicationForm(
  pickup: Date | null,
  plannedReturn: Date | null,
  consent: boolean,
): FormErrors {
  const errors: FormErrors = {};
  if (!pickup || pickup <= new Date()) {
    errors.pickup = "Срок получения должен быть в будущем.";
  }
  if (!plannedReturn || !pickup || plannedReturn < pickup) {
    errors.plannedReturn = "Плановый возврат не может быть раньше срока получения.";
  }
  if (!consent) errors.consent = "Подтвердите условия подачи заявки.";
  if (errors.pickup || errors.plannedReturn || errors.consent) {
    errors.summary = "Исправьте отмеченные поля, чтобы подать заявку.";
  }
  return errors;
}

function createInitialFormDates(): FormDates {
  const initialPickup = new Date(Date.now() + 24 * 3_600_000);
  const initialReturn = new Date(
    initialPickup.getTime() + DEFAULT_DURATION_HOURS * 3_600_000,
  );
  const pickup = toMoscowInputParts(initialPickup);
  const plannedReturn = toMoscowInputParts(initialReturn);
  return {
    pickupDate: pickup.date,
    pickupTime: pickup.time,
    returnDate: plannedReturn.date,
    returnTime: plannedReturn.time,
  };
}

function apiErrors(error: unknown): FormErrors {
  if (!(error instanceof ApiError)) {
    return { summary: "Не удалось подать заявку. Повторите попытку." };
  }
  return {
    summary: error.fieldErrors.product?.[0] ?? error.message,
    pickup: error.fieldErrors.pickup_deadline_at?.[0],
    plannedReturn: error.fieldErrors.planned_return_at?.[0],
    limitReached: error.code === "application_limit_reached",
  };
}
