import {
  Alert,
  Avatar,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Slider,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  CURRENT_USER_QUERY_KEY,
  type CurrentUser,
  updateProfile,
} from "../api/auth";
import { ApiError } from "../api/client";

interface ProfileSettingsPageProps {
  user: CurrentUser;
}

interface CropState {
  zoom: number;
  offsetX: number;
  offsetY: number;
}

const INITIAL_CROP: CropState = { zoom: 1, offsetX: 0, offsetY: 0 };
const MAX_AVATAR_SIZE = 15 * 1024 * 1024;
const ACCEPTED_AVATAR_TYPES = new Set(["image/jpeg", "image/png"]);

export function ProfileSettingsPage({ user }: ProfileSettingsPageProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(user.name);
  const [avatar, setAvatar] = useState<File>();
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [cropSource, setCropSource] = useState<File>();
  const [avatarSelectionError, setAvatarSelectionError] = useState<string>();
  const nameInputRef = useRef<HTMLInputElement>(null);
  const mutation = useMutation({
    mutationFn: updateProfile,
    onSuccess: (updatedUser) => {
      queryClient.setQueryData(CURRENT_USER_QUERY_KEY, updatedUser);
      setAvatar(undefined);
      setRemoveAvatar(false);
    },
  });
  const previewUrl = useFilePreviewUrl(avatar);
  const avatarUrl = removeAvatar ? undefined : previewUrl ?? user.avatar ?? undefined;
  const nameError =
    mutation.error instanceof ApiError ? mutation.error.fieldErrors.name?.[0] : undefined;
  const serverAvatarError =
    mutation.error instanceof ApiError
      ? mutation.error.fieldErrors.avatar?.[0]
      : undefined;
  const avatarError = avatarSelectionError ?? serverAvatarError;

  useEffect(() => {
    if (nameError) {
      nameInputRef.current?.focus();
    }
  }, [nameError]);

  function selectAvatar(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!ACCEPTED_AVATAR_TYPES.has(file.type)) {
      setAvatarSelectionError("Выберите фотографию в формате PNG или JPEG.");
      return;
    }
    if (file.size > MAX_AVATAR_SIZE) {
      setAvatarSelectionError("Фотография должна быть не больше 15 МБ.");
      return;
    }
    setAvatarSelectionError(undefined);
    setCropSource(file);
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    mutation.mutate({ name, avatar, removeAvatar });
  }

  return (
    <Box className="profile-settings">
      <Box className="profile-settings__heading">
        <Typography component="h1" variant="h3">Настройки профиля</Typography>
        <Typography color="text.secondary">
          Имя и аватар видны другим пользователям сервиса.
        </Typography>
      </Box>
      <Paper component="form" variant="outlined" onSubmit={submit} className="profile-settings__form">
        <Stack className="profile-settings__avatar" spacing={2}>
          <Avatar src={avatarUrl} alt="" className="profile-settings__avatar-preview">
            {name.trim().slice(0, 1)}
          </Avatar>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
            <Button component="label" variant="outlined">
              Загрузить фото
              <input
                hidden
                type="file"
                name="profile_avatar"
                aria-label="Выбрать фотографию для аватара"
                accept="image/png,image/jpeg"
                onChange={selectAvatar}
              />
            </Button>
            {avatarUrl ? (
              <Button
                color="error"
                onClick={() => {
                  setAvatar(undefined);
                  setRemoveAvatar(true);
                  setAvatarSelectionError(undefined);
                }}
              >
                Удалить аватар
              </Button>
            ) : null}
          </Stack>
          <Typography variant="caption" color="text.secondary">
            PNG или JPEG до 15 МБ. Итоговое изображение будет квадратным.
          </Typography>
          {avatarError ? <Alert severity="error">{avatarError}</Alert> : null}
        </Stack>
        <TextField
          label="Имя"
          name="profile_name"
          autoComplete="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          slotProps={{ htmlInput: { maxLength: 150, ref: nameInputRef } }}
          error={Boolean(nameError)}
          helperText={nameError ?? `${name.length} из 150 символов`}
        />
        <TextField
          label="Email"
          name="profile_email"
          autoComplete="email"
          value={user.email}
          disabled
        />
        <TextField
          label="Роль"
          name="profile_role"
          autoComplete="off"
          value={user.role === "RENTER" ? "Арендатор" : "Менеджер"}
          disabled
        />
        {mutation.isError && !nameError && !serverAvatarError ? (
          <Alert severity="error">Не удалось сохранить профиль. Попробуйте ещё раз.</Alert>
        ) : null}
        {mutation.isSuccess ? (
          <Alert severity="success" role="status">Профиль сохранён.</Alert>
        ) : null}
        <Button
          type="submit"
          variant="contained"
          disabled={mutation.isPending || !name.trim()}
        >
          {mutation.isPending ? "Сохраняем…" : "Сохранить изменения"}
        </Button>
      </Paper>
      {cropSource ? (
        <AvatarCropDialog
          file={cropSource}
          onCancel={() => setCropSource(undefined)}
          onConfirm={(croppedFile) => {
            setAvatar(croppedFile);
            setRemoveAvatar(false);
            setAvatarSelectionError(undefined);
            setCropSource(undefined);
          }}
        />
      ) : null}
    </Box>
  );
}

interface AvatarCropDialogProps {
  file: File;
  onCancel: () => void;
  onConfirm: (file: File) => void;
}

function AvatarCropDialog({ file, onCancel, onConfirm }: AvatarCropDialogProps) {
  const sourceUrl = useFilePreviewUrl(file);
  const [crop, setCrop] = useState(INITIAL_CROP);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingError, setProcessingError] = useState<string>();

  async function confirm(): Promise<void> {
    if (!sourceUrl) return;
    setIsProcessing(true);
    setProcessingError(undefined);
    try {
      onConfirm(await createCroppedAvatar(sourceUrl, file.name, crop));
    } catch {
      setProcessingError("Не удалось обработать фотографию. Выберите другой файл.");
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <Dialog open onClose={isProcessing ? undefined : onCancel} fullWidth maxWidth="sm">
      <DialogTitle>Обрезать аватар</DialogTitle>
      <DialogContent className="avatar-crop-dialog">
        <Typography color="text.secondary">
          Перетаскивайте фото в рамке или используйте ползунки для точной
          настройки квадратной области.
        </Typography>
        {processingError ? <Alert severity="error">{processingError}</Alert> : null}
        <AvatarCropPreview
          sourceUrl={sourceUrl}
          crop={crop}
          onChange={setCrop}
        />
        <CropSlider
          label="Масштаб"
          value={crop.zoom}
          min={1}
          max={3}
          step={0.05}
          onChange={(zoom) => setCrop((current) => ({ ...current, zoom }))}
        />
        <CropSlider
          label="Положение по горизонтали"
          value={crop.offsetX}
          min={-100}
          max={100}
          onChange={(offsetX) => setCrop((current) => ({ ...current, offsetX }))}
        />
        <CropSlider
          label="Положение по вертикали"
          value={crop.offsetY}
          min={-100}
          max={100}
          onChange={(offsetY) => setCrop((current) => ({ ...current, offsetY }))}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={isProcessing}>Отмена</Button>
        <Button onClick={confirm} variant="contained" disabled={isProcessing}>
          {isProcessing ? "Обрабатываем…" : "Применить"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

interface AvatarCropPreviewProps {
  sourceUrl?: string;
  crop: CropState;
  onChange: (crop: CropState) => void;
}

interface CropDragStart {
  pointerId: number;
  clientX: number;
  clientY: number;
  offsetX: number;
  offsetY: number;
}

function AvatarCropPreview({ sourceUrl, crop, onChange }: AvatarCropPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const cropRef = useRef(crop);
  const dragStartRef = useRef<CropDragStart | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (!sourceUrl) return undefined;
    let isCurrent = true;
    void loadImage(sourceUrl).then((image) => {
      if (!isCurrent) return;
      imageRef.current = image;
      const canvas = canvasRef.current;
      if (canvas) drawCroppedImage(canvas, image, cropRef.current);
    });
    return () => {
      isCurrent = false;
      imageRef.current = null;
    };
  }, [sourceUrl]);

  useEffect(() => {
    cropRef.current = crop;
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (canvas && image) drawCroppedImage(canvas, image, crop);
  }, [crop]);

  function beginDrag(event: ReactPointerEvent<HTMLCanvasElement>): void {
    dragStartRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      offsetX: crop.offsetX,
      offsetY: crop.offsetY,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setIsDragging(true);
  }

  function continueDrag(event: ReactPointerEvent<HTMLCanvasElement>): void {
    const start = dragStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return;
    onChange({
      ...crop,
      offsetX: clampCropOffset(
        start.offsetX - ((event.clientX - start.clientX) / bounds.width) * 200,
      ),
      offsetY: clampCropOffset(
        start.offsetY - ((event.clientY - start.clientY) / bounds.height) * 200,
      ),
    });
  }

  function endDrag(event: ReactPointerEvent<HTMLCanvasElement>): void {
    const start = dragStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    dragStartRef.current = null;
    setIsDragging(false);
  }

  return (
    <Box className={`avatar-crop-frame${isDragging ? " is-dragging" : ""}`}>
      {sourceUrl ? (
        <canvas
          ref={canvasRef}
          width="512"
          height="512"
          role="img"
          aria-label="Предпросмотр обрезки аватара"
          onPointerDown={beginDrag}
          onPointerMove={continueDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        />
      ) : null}
    </Box>
  );
}

interface CropSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}

function CropSlider({ label, value, min, max, step = 1, onChange }: CropSliderProps) {
  return (
    <Box>
      <Typography component="label" gutterBottom>{label}</Typography>
      <Slider
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(_, nextValue) => onChange(nextValue as number)}
        aria-label={label}
        valueLabelDisplay="auto"
      />
    </Box>
  );
}

interface FilePreview {
  file: File;
  url: string;
}

function useFilePreviewUrl(file?: File): string | undefined {
  const [preview, setPreview] = useState<FilePreview>();

  useEffect(() => {
    if (!file) return undefined;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setPreview({ file, url: reader.result });
      }
    };
    reader.readAsDataURL(file);
    return () => reader.abort();
  }, [file]);

  return file && preview?.file === file ? preview.url : undefined;
}

async function createCroppedAvatar(
  sourceUrl: string,
  originalName: string,
  crop: CropState,
): Promise<File> {
  const image = await loadImage(sourceUrl);
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  if (!drawCroppedImage(canvas, image, crop)) {
    throw new Error("Браузер не поддерживает обработку изображения.");
  }
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => result ? resolve(result) : reject(new Error("Не удалось обрезать изображение.")),
      "image/jpeg",
      0.9,
    );
  });
  const baseName = originalName.replace(/\.[^.]+$/, "") || "avatar";
  return new File([blob], `${baseName}.jpg`, { type: "image/jpeg" });
}

function drawCroppedImage(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  crop: CropState,
): boolean {
  const context = canvas.getContext("2d");
  if (!context) return false;
  const { sourceX, sourceY, sourceSize } = calculateCropRectangle(image, crop);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceSize,
    sourceSize,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return true;
}

function calculateCropRectangle(
  image: HTMLImageElement,
  crop: CropState,
): { sourceX: number; sourceY: number; sourceSize: number } {
  const sourceSize = Math.min(image.naturalWidth, image.naturalHeight) / crop.zoom;
  const maxOffsetX = (image.naturalWidth - sourceSize) / 2;
  const maxOffsetY = (image.naturalHeight - sourceSize) / 2;
  return {
    sourceX: maxOffsetX + (crop.offsetX / 100) * maxOffsetX,
    sourceY: maxOffsetY + (crop.offsetY / 100) * maxOffsetY,
    sourceSize,
  };
}

function clampCropOffset(value: number): number {
  return Math.max(-100, Math.min(100, value));
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Не удалось прочитать изображение."));
    image.src = source;
  });
}
