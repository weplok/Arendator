import {
  Alert,
  Avatar,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  FormControl,
  FormControlLabel,
  FormLabel,
  IconButton,
  Paper,
  Radio,
  RadioGroup,
  Skeleton,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { Link as RouterLink, useParams } from "react-router-dom";

import {
  completeReturnMaterials,
  confirmReturn,
  decideReturnDamage,
  deleteReturnPhoto,
  finishReturn,
  getRental,
  RENTER_ACTIVITY_KEY,
  RENTALS_KEY,
  requestReturnChanges,
  saveReturnComment,
  saveReturnFinancials,
  uploadReturnPhoto,
  type Rental,
  type ReturnParty,
} from "../api/bookings";
import { ApiError } from "../api/client";
import { CloseIcon, ImageIcon } from "../ui/Icons";
import { formatMoscowDateTime, formatRubles } from "./formatting";
import "./return.css";

interface ReturnPageProps {
  audience: "manager" | "renter";
}

interface PendingUpload {
  id: string;
  file: File;
  previewUrl: string;
  state: "uploading" | "error";
}

export function ReturnPage({ audience }: ReturnPageProps) {
  const rentalId = Number(useParams().rentalId);
  const queryKey = [...RENTALS_KEY, rentalId];
  const query = useQuery({
    queryKey,
    queryFn: () => getRental(rentalId),
    enabled: Number.isInteger(rentalId) && rentalId > 0,
  });

  if (query.isPending) return <ReturnSkeleton />;
  if (query.isError || !query.data.return_act) {
    return (
      <Alert severity="error" action={<Button onClick={() => query.refetch()}>Повторить</Button>}>
        Не удалось загрузить оформление возврата.
      </Alert>
    );
  }
  if (query.data.status === "COMPLETED") {
    return <ReturnReceipt rental={query.data} audience={audience} />;
  }
  return (
    <ReturnWorkspace
      audience={audience}
      rental={query.data}
      queryKey={queryKey}
      refetch={query.refetch}
    />
  );
}

function ReturnWorkspace(props: {
  audience: ReturnPageProps["audience"];
  rental: Rental;
  queryKey: readonly unknown[];
  refetch: () => Promise<unknown>;
}) {
  const { audience, rental, queryKey } = props;
  const returnAct = rental.return_act!;
  const ownParty = audience === "renter" ? returnAct.renter : returnAct.manager;
  const otherParty = audience === "renter" ? returnAct.manager : returnAct.renter;
  const queryClient = useQueryClient();
  const [comment, setComment] = useState(ownParty.comment);
  const [uploads, setUploads] = useState<PendingUpload[]>([]);
  const [waived, setWaived] = useState(returnAct.late_surcharge_waived);
  const [waiverReason, setWaiverReason] = useState(returnAct.late_surcharge_waiver_reason);
  const [damageEnabled, setDamageEnabled] = useState(returnAct.damage_enabled);
  const [damageDescription, setDamageDescription] = useState(returnAct.damage_description);
  const [damageAmount, setDamageAmount] = useState(returnAct.damage_amount);
  const [nextStatus, setNextStatus] = useState<"AVAILABLE" | "MAINTENANCE">(
    returnAct.next_instance_status || "AVAILABLE",
  );
  const previewUrls = useRef(new Set<string>());

  useEffect(() => () => {
    previewUrls.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const updateRental = (updated: Rental) => {
    queryClient.setQueryData(queryKey, updated);
    queryClient.invalidateQueries({ queryKey: RENTALS_KEY });
    queryClient.invalidateQueries({ queryKey: RENTER_ACTIVITY_KEY });
  };
  const complete = useMutation({
    mutationFn: async () => {
      if (returnAct.manager_amount_only && audience === "manager") {
        return saveReturnFinancials(rental.id, { damage_amount: damageAmount });
      }
      if (comment !== ownParty.comment) {
        await saveReturnComment(rental.id, comment);
      }
      if (audience === "manager") {
        await saveReturnFinancials(rental.id, {
          late_surcharge_waived: waived,
          late_surcharge_waiver_reason: waiverReason,
          damage_enabled: damageEnabled,
          damage_description: damageDescription,
          damage_amount: damageAmount || "0",
        });
      }
      return completeReturnMaterials(rental.id);
    },
    onSuccess: updateRental,
  });
  const confirm = useMutation({
    mutationFn: () => confirmReturn(rental.id),
    onSuccess: updateRental,
  });
  const finish = useMutation({
    mutationFn: () => finishReturn(rental.id, nextStatus),
    onSuccess: updateRental,
  });
  const requestChanges = useMutation({
    mutationFn: () => requestReturnChanges(rental.id),
    onSuccess: updateRental,
  });
  const damageDecision = useMutation({
    mutationFn: (accepted: boolean) => decideReturnDamage(rental.id, accepted),
    onSuccess: updateRental,
  });
  const removePhoto = useMutation({
    mutationFn: (photoId: number) => deleteReturnPhoto(rental.id, photoId),
    onSuccess: () => props.refetch(),
  });

  const uploadOne = async (upload: PendingUpload) => {
    setUploads((current) => replaceUploadState(current, upload.id, "uploading"));
    try {
      await uploadReturnPhoto(rental.id, upload.file);
      URL.revokeObjectURL(upload.previewUrl);
      previewUrls.current.delete(upload.previewUrl);
      setUploads((current) => current.filter((item) => item.id !== upload.id));
      await props.refetch();
    } catch {
      setUploads((current) => replaceUploadState(current, upload.id, "error"));
    }
  };
  const addFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const pending = Array.from(event.target.files ?? []).map((file) => {
      const previewUrl = URL.createObjectURL(file);
      previewUrls.current.add(previewUrl);
      return {
        id: crypto.randomUUID(),
        file,
        previewUrl,
        state: "uploading" as const,
      };
    });
    setUploads((current) => [...current, ...pending]);
    pending.forEach((upload) => void uploadOne(upload));
    event.target.value = "";
  };

  const mutationError = complete.error ?? confirm.error ?? finish.error
    ?? requestChanges.error ?? damageDecision.error ?? removePhoto.error;
  const completionFieldErrors = complete.error instanceof ApiError
    ? complete.error.fieldErrors
    : {};
  const reviewReady = returnAct.can_review;
  const ownEditable = !ownParty.is_completed;

  return (
    <Box className="return-page">
      <ReturnHeader rental={rental} />
      <Box className="return-steps" aria-label="Этап возврата">
        <span className={!reviewReady ? "is-current" : "is-complete"}>1. Фиксация</span>
        <span className={reviewReady ? "is-current" : ""}>2. Подтверждение</span>
      </Box>
      {returnAct.manager_amount_only && audience === "manager" ? (
        <Alert severity="warning" className="return-alert">
          Арендатор отказался от штрафа. Можно изменить только сумму; фото,
          комментарий и описание повреждения заблокированы.
        </Alert>
      ) : null}
      {returnAct.damage_decision === "REJECTED" && audience === "renter" ? (
        <Alert severity="info" className="return-alert">
          Вы отказались от штрафа. Ожидайте новую сумму от менеджера.
        </Alert>
      ) : null}
      {mutationError ? <Alert severity="error">{errorMessage(mutationError)}</Alert> : null}

      <Box className="return-layout">
        <Box className="return-parties">
          <ReturnPartyCard party={ownParty} title="Ваша фиксация">
            {ownEditable && !returnAct.manager_amount_only ? (
              <ReturnEditor
                party={ownParty}
                comment={comment}
                uploads={uploads}
                onCommentChange={setComment}
                onFiles={addFiles}
                onRetry={(upload) => void uploadOne(upload)}
                onDelete={(photoId) => removePhoto.mutate(photoId)}
              />
            ) : (
              <ReturnPartyReadOnly party={ownParty} />
            )}
          </ReturnPartyCard>
          <ReturnPartyCard party={otherParty} title="Фиксация второй стороны">
            <ReturnPartyReadOnly party={otherParty} />
            {!otherParty.is_completed ? (
              <Typography className="return-unconfirmed">
                Это ещё не подтверждённая фиксация.
              </Typography>
            ) : null}
          </ReturnPartyCard>
        </Box>

        <Box className="return-aside">
          {audience === "manager" ? (
            <ReturnFinancialPanel
              rental={rental}
              editable={ownEditable && !returnAct.manager_amount_only}
              amountOnly={returnAct.manager_amount_only}
              waived={waived}
              waiverReason={waiverReason}
              damageEnabled={damageEnabled}
              damageDescription={damageDescription}
              damageAmount={damageAmount}
              onWaivedChange={setWaived}
              onWaiverReasonChange={setWaiverReason}
              onDamageEnabledChange={setDamageEnabled}
              onDamageDescriptionChange={setDamageDescription}
              onDamageAmountChange={setDamageAmount}
              fieldErrors={completionFieldErrors}
            />
          ) : (
            <Paper variant="outlined" className="return-financial-card">
              <Typography component="h2" variant="h6">Расчётная сумма</Typography>
              <ReturnCostBreakdown rental={rental} />
              <Typography className="return-calculation-note">Без реального списания.</Typography>
            </Paper>
          )}

          {!ownParty.is_completed
          || (returnAct.manager_amount_only && audience === "manager") ? (
            <Paper variant="outlined" className="return-action-card">
              <Typography component="h2" variant="h6">
                {returnAct.manager_amount_only ? "Новая сумма штрафа" : "Завершить фиксацию"}
              </Typography>
              <Typography color="text.secondary">
                {returnAct.manager_amount_only
                  ? "После сохранения арендатор примет решение повторно."
                  : "После завершения материалы останутся доступны обеим сторонам."}
              </Typography>
              <Button
                variant="contained"
                disabled={
                  complete.isPending
                  || uploads.some((upload) => upload.state === "uploading")
                  || (!returnAct.manager_amount_only && ownParty.photos.length < 1)
                }
                onClick={() => complete.mutate()}
              >
                {complete.isPending
                  ? "Сохраняем…"
                  : returnAct.manager_amount_only
                    ? "Сохранить новую сумму"
                    : "Завершить фиксацию"}
              </Button>
              {!returnAct.manager_amount_only && ownParty.photos.length < 1 ? (
                <span className="return-field-hint">Добавьте минимум одно фото</span>
              ) : completionFieldErrors.photos?.[0] ? (
                <span className="return-field-error">{completionFieldErrors.photos[0]}</span>
              ) : null}
            </Paper>
          ) : reviewReady ? (
            <ReturnReviewActions
              audience={audience}
              rental={rental}
              nextStatus={nextStatus}
              onNextStatusChange={setNextStatus}
              onDamageDecision={(accepted) => damageDecision.mutate(accepted)}
              onConfirm={() => confirm.mutate()}
              onFinish={() => finish.mutate()}
              onRequestChanges={() => requestChanges.mutate()}
              pending={
                damageDecision.isPending
                || confirm.isPending
                || finish.isPending
                || requestChanges.isPending
              }
            />
          ) : (
            <Alert severity="info">Ваша фиксация сохранена. Ожидаем вторую сторону.</Alert>
          )}
        </Box>
      </Box>
    </Box>
  );
}

function ReturnHeader({ rental }: { rental: Rental }) {
  return (
    <Box className="return-heading">
      <Box>
        <Typography className="return-eyebrow">Возврат оборудования</Typography>
        <Typography component="h1" variant="h3">{rental.product.name}</Typography>
        <Typography color="text.secondary">Зафиксируйте состояние товара при возврате.</Typography>
      </Box>
      <Paper variant="outlined" className="return-stopped">
        <strong>Начисление остановлено</strong>
        <span>{formatMoscowDateTime(rental.return_received_at!)} МСК</span>
        <small>Время оформления возврата не оплачивается.</small>
      </Paper>
    </Box>
  );
}

function ReturnPartyCard(props: {
  party: ReturnParty;
  title: string;
  children: ReactNode;
}) {
  return (
    <Paper variant="outlined" className="return-party-card">
      <Box className="return-party-head">
        <Box className="return-party-person">
          <Avatar src={props.party.avatar ?? undefined} alt="">
            {props.party.name.slice(0, 1)}
          </Avatar>
          <div>
            <Typography component="h2" variant="body2">{props.title}</Typography>
            <strong>{props.party.name}</strong>
          </div>
        </Box>
        <Chip
          size="small"
          color={props.party.is_completed ? "success" : "default"}
          label={props.party.is_completed
            ? `Готово · ${props.party.photos.length} фото`
            : `В процессе · ${props.party.photos.length} фото`}
        />
      </Box>
      {props.children}
    </Paper>
  );
}

function ReturnEditor(props: {
  party: ReturnParty;
  comment: string;
  uploads: PendingUpload[];
  onCommentChange: (value: string) => void;
  onFiles: (event: ChangeEvent<HTMLInputElement>) => void;
  onRetry: (upload: PendingUpload) => void;
  onDelete: (photoId: number) => void;
}) {
  return (
    <>
      <ReturnPhotoGrid party={props.party} editable onDelete={props.onDelete} />
      <PendingUploads uploads={props.uploads} onRetry={props.onRetry} />
      <Box className="return-upload-choices">
        <UploadChoice id="return-camera" label="Сделать фото" capture onChange={props.onFiles} />
        <UploadChoice id="return-files" label="Выбрать из устройства" multiple onChange={props.onFiles} />
      </Box>
      <TextField
        label="Комментарий о состоянии"
        multiline
        minRows={3}
        fullWidth
        name="return_comment"
        autoComplete="off"
        value={props.comment}
        onChange={(event) => props.onCommentChange(event.target.value)}
        helperText="Необязательно. Опишите видимые следы использования или повреждения."
      />
    </>
  );
}

function ReturnPartyReadOnly({ party }: { party: ReturnParty }) {
  return (
    <>
      <ReturnPhotoGrid party={party} />
      <Box className="return-comment">
        <strong>Комментарий</strong>
        <span>{party.comment || "Комментарий не добавлен"}</span>
      </Box>
    </>
  );
}

function ReturnPhotoGrid(props: {
  party: ReturnParty;
  editable?: boolean;
  onDelete?: (photoId: number) => void;
}) {
  if (props.party.photos.length === 0) {
    return <Box className="return-photo-empty">Фото не добавлены</Box>;
  }
  return (
    <Box className="return-photo-grid">
      {props.party.photos.map((photo, index) => (
        <Box className="return-photo" key={photo.id}>
          <a href={photo.url} target="_blank" rel="noreferrer" aria-label={`Открыть фотографию ${index + 1}, ${props.party.name}`}>
            <img src={photo.url} alt="" width="400" height="300" loading="lazy" />
          </a>
          {props.editable ? (
            <IconButton aria-label={`Удалить фотографию ${index + 1}`} onClick={() => props.onDelete?.(photo.id)}>
              <CloseIcon />
            </IconButton>
          ) : null}
        </Box>
      ))}
    </Box>
  );
}

function UploadChoice(props: {
  id: string;
  label: string;
  capture?: boolean;
  multiple?: boolean;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <Button component="label" className="return-upload-choice" htmlFor={props.id}>
      <ImageIcon />
      <span><strong>{props.label}</strong><small>PNG или JPEG, до 15 МБ</small></span>
      <input
        id={props.id}
        className="visually-hidden"
        type="file"
        accept="image/png,image/jpeg"
        aria-label={props.label}
        name={props.capture ? "return_camera" : "return_files"}
        capture={props.capture ? "environment" : undefined}
        multiple={props.multiple}
        onChange={props.onChange}
      />
    </Button>
  );
}

function PendingUploads(props: {
  uploads: PendingUpload[];
  onRetry: (upload: PendingUpload) => void;
}) {
  if (props.uploads.length === 0) return null;
  return (
    <Box className="return-upload-list" aria-live="polite">
      {props.uploads.map((upload) => (
        <Box className={`return-upload-row is-${upload.state}`} key={upload.id}>
          <img src={upload.previewUrl} alt="" width="52" height="40" />
          {upload.state === "uploading" ? (
            <><CircularProgress size={18} /><span>Загружается {upload.file.name}</span></>
          ) : (
            <>
              <span>Не удалось загрузить {upload.file.name}</span>
              <Button size="small" onClick={() => props.onRetry(upload)}>Повторить</Button>
            </>
          )}
        </Box>
      ))}
    </Box>
  );
}

function ReturnFinancialPanel(props: {
  rental: Rental;
  editable: boolean;
  amountOnly: boolean;
  waived: boolean;
  waiverReason: string;
  damageEnabled: boolean;
  damageDescription: string;
  damageAmount: string;
  onWaivedChange: (value: boolean) => void;
  onWaiverReasonChange: (value: string) => void;
  onDamageEnabledChange: (value: boolean) => void;
  onDamageDescriptionChange: (value: string) => void;
  onDamageAmountChange: (value: string) => void;
  fieldErrors: Record<string, string[]>;
}) {
  return (
    <Paper variant="outlined" className="return-financial-card">
      <Typography component="h2" variant="h6">Расчёт и штрафы</Typography>
      <ReturnCostBreakdown rental={props.rental} />
      <FormControlLabel
        control={<Checkbox checked={props.waived} disabled={!props.editable} onChange={(event) => props.onWaivedChange(event.target.checked)} />}
        label="Отменить повышающий коэффициент просрочки"
      />
      {props.waived ? (
        <TextField
          label="Причина отмены"
          value={props.waiverReason}
          disabled={!props.editable}
          onChange={(event) => props.onWaiverReasonChange(event.target.value)}
          helperText="Необязательно"
          fullWidth
          name="late_surcharge_waiver_reason"
          autoComplete="off"
        />
      ) : null}
      <Box className="return-damage-fields">
        <FormControlLabel
          control={<Checkbox checked={props.damageEnabled} disabled={!props.editable} onChange={(event) => props.onDamageEnabledChange(event.target.checked)} />}
          label="Зафиксировать повреждение"
        />
        {props.damageEnabled ? (
          <>
            <TextField
              label="Описание повреждения"
              value={props.damageDescription}
              disabled={!props.editable}
              onChange={(event) => props.onDamageDescriptionChange(event.target.value)}
              multiline
              minRows={3}
              required
              fullWidth
              name="damage_description"
              autoComplete="off"
              error={Boolean(props.fieldErrors.damage_description)}
              helperText={props.fieldErrors.damage_description?.[0]}
            />
            <TextField
              label="Сумма штрафа, ₽"
              value={props.damageAmount}
              disabled={!props.editable && !props.amountOnly}
              onChange={(event) => props.onDamageAmountChange(event.target.value)}
              type="number"
              slotProps={{ htmlInput: { min: 0, step: "0.01" } }}
              required
              fullWidth
              name="damage_amount"
              autoComplete="off"
              error={Boolean(props.fieldErrors.damage_amount)}
              helperText={props.fieldErrors.damage_amount?.[0]}
            />
          </>
        ) : null}
      </Box>
      <Typography className="return-calculation-note">
        Все суммы расчётные. Реального списания на этом этапе нет.
      </Typography>
    </Paper>
  );
}

function ReturnCostBreakdown({ rental }: { rental: Rental }) {
  return (
    <dl className="return-cost-list">
      <dt>Стартовая стоимость</dt><dd>{formatRubles(rental.starting_price_snapshot)}</dd>
      <dt>Своевременные минуты · {rental.timely_minutes}</dt><dd>{formatRubles(rental.timely_cost)}</dd>
      <dt>Просроченные минуты · {rental.late_minutes}</dt><dd>{formatRubles(rental.late_base_cost)}</dd>
      {rental.late_minutes > 0 ? (
        <><dt>{rental.late_surcharge_waived ? "Повышающий коэффициент отменён" : "Повышающий коэффициент"}</dt><dd>{formatRubles(rental.late_surcharge)}</dd></>
      ) : null}
      {Number(rental.damage_amount) > 0 ? <><dt>Повреждение</dt><dd>{formatRubles(rental.damage_amount)}</dd></> : null}
      <dt className="return-total">Расчётный итог</dt><dd className="return-total">{formatRubles(rental.current_cost)}</dd>
    </dl>
  );
}

function ReturnReviewActions(props: {
  audience: ReturnPageProps["audience"];
  rental: Rental;
  nextStatus: "AVAILABLE" | "MAINTENANCE";
  onNextStatusChange: (status: "AVAILABLE" | "MAINTENANCE") => void;
  onDamageDecision: (accepted: boolean) => void;
  onConfirm: () => void;
  onFinish: () => void;
  onRequestChanges: () => void;
  pending: boolean;
}) {
  const returnAct = props.rental.return_act!;
  const ownParty = props.audience === "renter" ? returnAct.renter : returnAct.manager;
  const otherLabel = props.audience === "renter" ? "менеджера" : "арендатора";
  const damageResolved = !returnAct.damage_enabled || returnAct.damage_decision === "ACCEPTED";
  return (
    <Paper variant="outlined" className="return-action-card">
      <Typography component="h2" variant="h6">Подтверждение возврата</Typography>
      <Box className="return-review-statuses">
        <span>{returnAct.renter.is_confirmed ? "Арендатор подтвердил" : "Арендатор проверяет"}</span>
        <span>{returnAct.manager.is_confirmed ? "Менеджер подтвердил" : "Менеджер проверяет"}</span>
      </Box>
      {props.audience === "renter" && returnAct.damage_enabled ? (
        <Box className="return-damage-decision">
          <strong>Повреждение: {returnAct.damage_description}</strong>
          <span>Сумма: {formatRubles(returnAct.damage_amount)}</span>
          {returnAct.damage_decision === "ACCEPTED" ? (
            <Alert severity="success">Вы согласились с актуальной суммой.</Alert>
          ) : (
            <Box className="return-decision-buttons">
              <Button variant="contained" disabled={props.pending} onClick={() => props.onDamageDecision(true)}>
                Согласиться со штрафом
              </Button>
              <Button color="error" variant="outlined" disabled={props.pending} onClick={() => props.onDamageDecision(false)}>
                Отказаться от штрафа
              </Button>
            </Box>
          )}
        </Box>
      ) : null}
      {props.audience === "manager" ? (
        <FormControl className="return-instance-state">
          <FormLabel>Состояние экземпляра после возврата</FormLabel>
          <RadioGroup value={props.nextStatus} onChange={(event) => props.onNextStatusChange(event.target.value as "AVAILABLE" | "MAINTENANCE")}>
            <FormControlLabel value="AVAILABLE" control={<Radio />} label="Доступен" />
            <FormControlLabel value="MAINTENANCE" control={<Radio />} label="На обслуживании" />
          </RadioGroup>
        </FormControl>
      ) : null}
      {props.audience === "renter" ? (
        <Button variant="contained" disabled={props.pending || ownParty.is_confirmed || !damageResolved} onClick={props.onConfirm}>
          {ownParty.is_confirmed ? "Фотоакт подтверждён" : "Подтвердить фотоакт возврата"}
        </Button>
      ) : (
        <Button variant="contained" disabled={props.pending} onClick={props.onFinish}>
          Подтвердить и завершить возврат
        </Button>
      )}
      <Button variant="outlined" disabled={props.pending} onClick={props.onRequestChanges}>
        Попросить {otherLabel} изменить фиксацию
      </Button>
    </Paper>
  );
}

function ReturnReceipt({ rental, audience }: { rental: Rental; audience: "manager" | "renter" }) {
  return (
    <Box className="return-page return-receipt">
      <Paper variant="outlined" className="return-success">
        <Typography className="return-eyebrow">Возврат завершён</Typography>
        <Typography component="h1" variant="h3">{rental.product.name}</Typography>
        <Typography color="text.secondary">
          Начисление остановлено {formatMoscowDateTime(rental.return_received_at!)} МСК.
          Итог ниже является расчётным, без реального списания.
        </Typography>
      </Paper>
      <Box className="return-receipt-grid">
        <Paper variant="outlined" className="return-financial-card">
          <Typography component="h2" variant="h6">Итоговая квитанция</Typography>
          <ReturnCostBreakdown rental={rental} />
        </Paper>
        <Paper variant="outlined" className="return-action-card">
          <Typography component="h2" variant="h6">
            {audience === "manager" ? "Следующий шаг" : "Оформление завершено"}
          </Typography>
          {audience === "manager" ? (
            <>
              <Chip label={rental.return_act?.next_instance_status === "MAINTENANCE" ? "На обслуживании" : "Экземпляр доступен"} color="success" />
              {rental.waiting_applications.length > 0 ? rental.waiting_applications.map((application) => (
                <Box className="return-queue-item" key={application.id}>
                  <strong>{application.renter_name}</strong>
                  <span>Получение до {formatMoscowDateTime(application.pickup_deadline_at)} МСК</span>
                </Box>
              )) : <Typography color="text.secondary">Ожидающих заявок нет.</Typography>}
              <Button component={RouterLink} to="/manager/applications" variant="outlined">К заявкам</Button>
            </>
          ) : (
            <Button component={RouterLink} to="/account/rentals" variant="contained">К моим арендам</Button>
          )}
        </Paper>
      </Box>
    </Box>
  );
}

function replaceUploadState(
  uploads: PendingUpload[],
  id: string,
  state: PendingUpload["state"],
): PendingUpload[] {
  return uploads.map((upload) => upload.id === id ? { ...upload, state } : upload);
}

function errorMessage(error: Error | null): string {
  if (error instanceof ApiError) {
    const fieldMessage = Object.values(error.fieldErrors).flat()[0];
    return fieldMessage ?? error.message;
  }
  return "Не удалось выполнить действие. Введённые данные сохранены — попробуйте ещё раз.";
}

function ReturnSkeleton() {
  return (
    <Box className="return-page" role="status" aria-label="Загрузка оформления возврата">
      <Skeleton height={120} variant="rounded" />
      <Skeleton height={64} variant="rounded" />
      <Skeleton height={480} variant="rounded" />
    </Box>
  );
}
