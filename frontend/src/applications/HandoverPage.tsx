import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
  Skeleton,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";

import {
  completeHandover,
  confirmHandover,
  deleteHandoverPhoto,
  getManagerBooking,
  getRenterBooking,
  MANAGER_BOOKINGS_KEY,
  RENTER_ACTIVITY_KEY,
  RENTER_BOOKINGS_KEY,
  requestHandoverChanges,
  saveHandoverComment,
  uploadHandoverPhoto,
  type HandoverParty,
  type RentalBooking,
} from "../api/bookings";
import { CloseIcon, ImageIcon } from "../ui/Icons";
import "./handover.css";

interface HandoverPageProps {
  audience: "manager" | "renter";
}

interface PendingUpload {
  id: string;
  file: File;
  previewUrl: string;
  state: "uploading" | "error";
}

export function HandoverPage({ audience }: HandoverPageProps) {
  const bookingId = Number(useParams().bookingId);
  const queryKey = audience === "manager"
    ? [...MANAGER_BOOKINGS_KEY, bookingId]
    : [...RENTER_BOOKINGS_KEY, bookingId];
  const query = useQuery({
    queryKey,
    queryFn: () => audience === "manager"
      ? getManagerBooking(bookingId)
      : getRenterBooking(bookingId),
    enabled: Number.isInteger(bookingId) && bookingId > 0,
    refetchInterval: 2000,
  });

  if (query.isPending) return <HandoverSkeleton />;
  if (query.isError || !query.data.handover) {
    return (
      <Alert severity="error" action={<Button onClick={() => query.refetch()}>Повторить</Button>}>
        Не удалось загрузить фотоакт выдачи.
      </Alert>
    );
  }
  return (
    <HandoverWorkspace
      audience={audience}
      booking={query.data}
      queryKey={queryKey}
      refetch={query.refetch}
    />
  );
}

interface HandoverWorkspaceProps {
  audience: HandoverPageProps["audience"];
  booking: RentalBooking;
  queryKey: readonly unknown[];
  refetch: () => Promise<unknown>;
}

function HandoverWorkspace(props: HandoverWorkspaceProps) {
  const { audience, booking, queryKey } = props;
  const handover = booking.handover!;
  const ownParty = audience === "renter" ? handover.renter : handover.manager;
  const otherParty = audience === "renter" ? handover.manager : handover.renter;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [comment, setComment] = useState(ownParty.comment);
  const [uploads, setUploads] = useState<PendingUpload[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [openedPhoto, setOpenedPhoto] = useState<{ url: string; label: string } | null>(null);
  const [photoToDelete, setPhotoToDelete] = useState<number | null>(null);
  const previewUrls = useRef(new Set<string>());

  useEffect(() => () => {
    previewUrls.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  useEffect(() => {
    if (!booking.rental) return;
    navigate(
      audience === "manager"
        ? `/manager/rentals/${booking.rental.id}`
        : `/account/rentals/${booking.rental.id}`,
    );
  }, [audience, booking.rental, navigate]);

  const updateBooking = (updated: RentalBooking) => {
    queryClient.setQueryData(queryKey, updated);
    queryClient.invalidateQueries({ queryKey: RENTER_ACTIVITY_KEY });
  };
  const complete = useMutation({
    mutationFn: async () => {
      if (comment !== ownParty.comment) {
        await saveHandoverComment(booking.id, comment);
      }
      return completeHandover(booking.id);
    },
    onSuccess: updateBooking,
  });
  const confirm = useMutation({
    mutationFn: () => confirmHandover(booking.id),
    onSuccess: (updated) => {
      updateBooking(updated);
      if (updated.rental) {
        navigate(
          audience === "manager"
            ? `/manager/rentals/${updated.rental.id}`
            : `/account/rentals/${updated.rental.id}`,
        );
      }
    },
  });
  const requestChanges = useMutation({
    mutationFn: () => requestHandoverChanges(booking.id),
    onSuccess: updateBooking,
  });
  const removePhoto = useMutation({
    mutationFn: (photoId: number) => deleteHandoverPhoto(booking.id, photoId),
    onSuccess: () => props.refetch(),
  });

  const addFileList = (files: File[]) => {
    files
      .filter((file) => file.type === "image/png" || file.type === "image/jpeg")
      .forEach((file) => startUpload(file));
  };
  const addFiles = (event: ChangeEvent<HTMLInputElement>) => {
    addFileList(Array.from(event.target.files ?? []));
    event.target.value = "";
  };
  const dropFiles = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    addFileList(Array.from(event.dataTransfer.files));
  };
  const startUpload = (file: File) => {
    const id = `${file.name}-${file.lastModified}-${crypto.randomUUID()}`;
    const previewUrl = URL.createObjectURL?.(file) ?? "";
    if (previewUrl) previewUrls.current.add(previewUrl);
    setUploads((current) => [...current, { id, file, previewUrl, state: "uploading" }]);
    uploadHandoverPhoto(booking.id, file)
      .then(async () => {
        if (previewUrl) {
          URL.revokeObjectURL(previewUrl);
          previewUrls.current.delete(previewUrl);
        }
        setUploads((current) => current.filter((item) => item.id !== id));
        await props.refetch();
      })
      .catch(() => {
        setUploads((current) => current.map((item) => (
          item.id === id ? { ...item, state: "error" } : item
        )));
      });
  };
  const retryUpload = (upload: PendingUpload) => {
    if (upload.previewUrl) {
      URL.revokeObjectURL(upload.previewUrl);
      previewUrls.current.delete(upload.previewUrl);
    }
    setUploads((current) => current.filter((item) => item.id !== upload.id));
    startUpload(upload.file);
  };

  const pendingCount = uploads.filter((upload) => upload.state === "uploading").length;
  const missingPhotoCount = audience === "renter"
    ? Math.max(0, 2 - ownParty.photos.length)
    : 0;
  const completionDisabled = pendingCount > 0 || missingPhotoCount > 0;
  const actionError = complete.error ?? confirm.error ?? requestChanges.error;

  return (
    <Box className="handover-page">
      <header className="handover-heading">
        <Box>
          <Typography className="page-eyebrow">Фотоакт выдачи · BK-{booking.id}</Typography>
          <Typography component="h1" variant="h3">Фиксация состояния</Typography>
          <Typography color="text.secondary">{booking.product.name}</Typography>
        </Box>
        <Chip color="success" label="Приёмка активна" />
      </header>

      <Box className="handover-steps" aria-label="Этапы выдачи">
        <Box className={handover.can_review ? "handover-step is-done" : "handover-step is-current"}>
          <span>1</span><div><strong>Фиксация</strong><small>Фото и комментарии</small></div>
        </Box>
        <Box className={handover.can_review ? "handover-step is-current" : "handover-step"}>
          <span>2</span><div><strong>Подтверждение</strong><small>Проверка обеими сторонами</small></div>
        </Box>
      </Box>

      <Box className="handover-layout">
        <Box className="handover-parties">
          <PartyCard party={ownParty} title="Ваши материалы">
            {ownParty.is_completed ? (
              <>
                <Alert severity="success">Ваш набор завершён и сохранён.</Alert>
                <PhotoGrid party={ownParty} onOpen={setOpenedPhoto} />
                <CommentValue comment={ownParty.comment} />
              </>
            ) : (
              <>
                <Box
                  className={`handover-upload-actions handover-dropzone${dragActive ? " is-drag-active" : ""}`}
                  onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }}
                  onDragLeave={() => setDragActive(false)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={dropFiles}
                >
                  <Typography className="handover-dropzone-hint">
                    Перетащите фото сюда или выберите способ загрузки
                  </Typography>
                  <UploadChoice
                    id="handover-camera"
                    label="Сделать фото"
                    hint="Открыть камеру"
                    capture
                    onChange={addFiles}
                  />
                  <UploadChoice
                    id="handover-files"
                    label="Выбрать из устройства"
                    hint="PNG/JPEG, до 15 МБ"
                    multiple
                    onChange={addFiles}
                  />
                </Box>
                <PhotoGrid
                  party={ownParty}
                  editable
                  onOpen={setOpenedPhoto}
                  onDelete={setPhotoToDelete}
                />
                <PendingPhotoGrid uploads={uploads} />
                <UploadRows uploads={uploads} onRetry={retryUpload} />
                <TextField
                  label="Комментарий (необязательно)"
                  multiline
                  minRows={3}
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  name="handover_comment"
                  autoComplete="off"
                  slotProps={{ htmlInput: { maxLength: 2000 } }}
                />
                <Box className="handover-material-actions">
                  <Button
                    variant="contained"
                    disabled={completionDisabled || complete.isPending}
                    onClick={() => complete.mutate()}
                  >
                    {complete.isPending ? "Завершаем…" : "Завершить фиксацию"}
                  </Button>
                  {missingPhotoCount > 0 ? <small>Добавьте ещё {missingPhotoCount} фото</small> : null}
                  {pendingCount > 0 ? <small>Дождитесь завершения загрузки</small> : null}
                </Box>
              </>
            )}
          </PartyCard>

          <PartyCard party={otherParty} title="Материалы второй стороны">
            {!otherParty.is_completed ? (
              <Alert icon={<ImageIcon />} severity="info">
                Это ещё не подтверждённая фиксация.
              </Alert>
            ) : null}
            <PhotoGrid party={otherParty} onOpen={setOpenedPhoto} />
            <CommentValue comment={otherParty.comment} />
          </PartyCard>
        </Box>

        <Paper variant="outlined" className="handover-review-card">
          <Typography component="h2" variant="h6">Подтверждение фотоакта</Typography>
          {!handover.can_review ? (
            <Typography color="text.secondary">Обе стороны должны завершить свои наборы. Аренда ещё не началась.</Typography>
          ) : (
            <>
              <ReviewStatus party={handover.renter} label="Арендатор" />
              <ReviewStatus party={handover.manager} label="Менеджер" />
              {!ownParty.is_confirmed ? (
                <Button
                  fullWidth
                  variant="contained"
                  disabled={confirm.isPending}
                  onClick={() => confirm.mutate()}
                >
                  {confirmLabel(audience, otherParty.is_confirmed)}
                </Button>
              ) : <Alert severity="success">Вы подтвердили фотоакт. Ждём вторую сторону.</Alert>}
              <Button
                fullWidth
                variant="outlined"
                disabled={requestChanges.isPending}
                onClick={() => requestChanges.mutate()}
              >
                Попросить {audience === "renter" ? "менеджера" : "арендатора"} изменить
              </Button>
            </>
          )}
          {actionError ? <Alert severity="error">Не удалось выполнить действие. Обновите страницу и повторите.</Alert> : null}
        </Paper>
      </Box>

      <Dialog
        open={Boolean(openedPhoto)}
        onClose={() => setOpenedPhoto(null)}
        maxWidth="md"
        fullWidth
        aria-labelledby="handover-photo-title"
      >
        <DialogTitle id="handover-photo-title">
          {openedPhoto?.label}
          <IconButton aria-label="Закрыть фотографию" onClick={() => setOpenedPhoto(null)}>
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent className="handover-photo-dialog">
          {openedPhoto ? <img src={openedPhoto.url} alt={openedPhoto.label} width="800" height="600" /> : null}
        </DialogContent>
      </Dialog>
      <Dialog
        open={photoToDelete !== null}
        onClose={() => setPhotoToDelete(null)}
        aria-labelledby="delete-handover-photo-title"
      >
        <DialogTitle id="delete-handover-photo-title">Удалить фотографию?</DialogTitle>
        <DialogContent>Она исчезнет из фотоакта. При необходимости файл можно загрузить заново.</DialogContent>
        <Box className="handover-delete-actions">
          <Button onClick={() => setPhotoToDelete(null)}>Не удалять</Button>
          <Button
            color="error"
            variant="contained"
            disabled={removePhoto.isPending}
            onClick={() => {
              if (photoToDelete === null) return;
              removePhoto.mutate(photoToDelete, {
                onSuccess: () => setPhotoToDelete(null),
              });
            }}
          >
            {removePhoto.isPending ? "Удаляем…" : "Удалить фото"}
          </Button>
        </Box>
      </Dialog>
    </Box>
  );
}

function PartyCard({ party, title, children }: {
  party: HandoverParty;
  title: string;
  children: ReactNode;
}) {
  return (
    <Paper variant="outlined" className="handover-party-card">
      <Box className="handover-party-head">
        <Box className="handover-party-person">
          <Avatar src={party.avatar ?? undefined} alt="">{party.name.slice(0, 1)}</Avatar>
          <div><Typography component="h2" variant="body2">{title}</Typography><strong>{party.name}</strong></div>
        </Box>
        <Chip
          size="small"
          color={party.is_completed ? "success" : "default"}
          label={party.is_completed ? `Готово · ${party.photos.length} фото` : `В процессе · ${party.photos.length} фото`}
        />
      </Box>
      {children}
    </Paper>
  );
}

function UploadChoice(props: {
  id: string;
  label: string;
  hint: string;
  capture?: boolean;
  multiple?: boolean;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <Button component="label" className="handover-upload-choice" htmlFor={props.id}>
      <ImageIcon />
      <span><strong>{props.label}</strong><small>{props.hint}</small></span>
      <input
        id={props.id}
        className="visually-hidden"
        type="file"
        accept="image/png,image/jpeg"
        aria-label={props.label}
        name={props.capture ? "handover_camera" : "handover_files"}
        capture={props.capture ? "environment" : undefined}
        multiple={props.multiple}
        onChange={props.onChange}
      />
    </Button>
  );
}

function PhotoGrid(props: {
  party: HandoverParty;
  editable?: boolean;
  onOpen: (photo: { url: string; label: string }) => void;
  onDelete?: (photoId: number) => void;
}) {
  if (props.party.photos.length === 0) {
    return <Box className="handover-photo-empty">Фото не добавлены</Box>;
  }
  return (
    <Box className="handover-photo-grid">
      {props.party.photos.map((photo, index) => {
        const label = `Фотография ${index + 1}, ${props.party.name}`;
        return (
          <Box className="handover-photo" key={photo.id}>
            <button type="button" aria-label={`Открыть ${label.toLowerCase()}`} onClick={() => props.onOpen({ url: photo.url, label })}>
              <img src={photo.url} alt="" width="400" height="300" loading="lazy" />
            </button>
            {props.editable ? (
              <IconButton aria-label={`Удалить фотографию ${index + 1}`} onClick={() => props.onDelete?.(photo.id)}>
                <CloseIcon />
              </IconButton>
            ) : null}
          </Box>
        );
      })}
    </Box>
  );
}

function UploadRows({ uploads, onRetry }: {
  uploads: PendingUpload[];
  onRetry: (upload: PendingUpload) => void;
}) {
  return <Box className="handover-upload-list" aria-live="polite">{uploads.map((upload) => (
    <Box className={`handover-upload-row is-${upload.state}`} key={upload.id}>
      {upload.state === "uploading" ? (
        <><CircularProgress size={18} /><span>Загружается {upload.file.name}</span></>
      ) : (
        <>
          <span>Не удалось загрузить {upload.file.name}</span>
          <Button size="small" onClick={() => onRetry(upload)} aria-label={`Повторить загрузку ${upload.file.name}`}>Повторить</Button>
        </>
      )}
    </Box>
  ))}</Box>;
}

function PendingPhotoGrid({ uploads }: { uploads: PendingUpload[] }) {
  const visible = uploads.filter((upload) => upload.previewUrl);
  if (visible.length === 0) return null;
  return (
    <Box className="handover-photo-grid" aria-label="Локальные превью загрузки">
      {visible.map((upload) => (
        <Box className={`handover-photo handover-photo-pending is-${upload.state}`} key={upload.id}>
          <img src={upload.previewUrl} alt={`Превью ${upload.file.name}`} width="400" height="300" />
          <span>{upload.state === "uploading" ? "Загрузка…" : "Ошибка"}</span>
        </Box>
      ))}
    </Box>
  );
}

function CommentValue({ comment }: { comment: string }) {
  return (
    <Box className="handover-comment-value">
      <strong>Комментарий</strong>
      <span>{comment || "Комментарий не добавлен"}</span>
    </Box>
  );
}

function ReviewStatus({ party, label }: { party: HandoverParty; label: string }) {
  return (
    <Box className={`handover-review-person ${party.is_confirmed ? "is-ready" : ""}`}>
      <strong>{label}</strong>
      <span>{party.is_confirmed ? "Подтверждено" : "Ожидает подтверждения"}</span>
    </Box>
  );
}

function confirmLabel(audience: HandoverPageProps["audience"], otherConfirmed: boolean): string {
  if (audience === "manager" && otherConfirmed) return "Подтвердить и начать аренду";
  return "Подтвердить фиксацию";
}

function HandoverSkeleton() {
  return (
    <Box className="handover-page" role="status" aria-label="Загрузка фотоакта">
      <Skeleton height={96} variant="rounded" />
      <Skeleton height={72} variant="rounded" />
      <Skeleton height={420} variant="rounded" />
    </Box>
  );
}
