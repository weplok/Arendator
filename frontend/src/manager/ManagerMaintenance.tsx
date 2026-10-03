import {
  Alert,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import { ApiError } from "../api/client";
import {
  completeMaintenance,
  searchOwnInstance,
  startMaintenance,
  type InstanceSearchResult,
  type ManagerInstance,
} from "../api/manager";
import { CloseIcon, SearchIcon } from "../ui/Icons";
import { instanceStatusLabel } from "./managerStatus";

interface InstanceSearchDialogProps {
  open: boolean;
  onClose: () => void;
}

export function InstanceSearchDialog(props: InstanceSearchDialogProps) {
  const [inventoryNumber, setInventoryNumber] = useState("");
  const [result, setResult] = useState<InstanceSearchResult | null>(null);
  const [actionOpen, setActionOpen] = useState(false);
  const search = useMutation({
    mutationFn: () => searchOwnInstance(inventoryNumber.trim()),
    onSuccess: setResult,
  });

  function close(): void {
    setInventoryNumber("");
    setResult(null);
    setActionOpen(false);
    search.reset();
    props.onClose();
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setResult(null);
    search.mutate();
  }

  const notFound = search.error instanceof ApiError && search.error.status === 404;
  return <>
    <Dialog open={props.open} onClose={close} fullWidth maxWidth="sm" aria-labelledby="instance-search-title">
      <DialogTitle id="instance-search-title" className="maintenance-dialog-title">
        Найти экземпляр
        <Button className="maintenance-close" onClick={close} aria-label="Закрыть поиск"><CloseIcon /></Button>
      </DialogTitle>
      <DialogContent>
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          Введите полный инвентарный номер экземпляра из вашего каталога.
        </Typography>
        <form className="maintenance-search-form" onSubmit={submit}>
          <TextField
            autoFocus
            fullWidth
            label="Инвентарный номер"
            name="inventory_number"
            autoComplete="off"
            spellCheck={false}
            value={inventoryNumber}
            onChange={(event) => setInventoryNumber(event.target.value)}
            required
          />
          <Button type="submit" variant="contained" disabled={search.isPending || !inventoryNumber.trim()} startIcon={<SearchIcon />}>
            {search.isPending ? "Ищем…" : "Найти"}
          </Button>
        </form>
        {search.isPending ? <div className="maintenance-loading" role="status"><CircularProgress size={24} /> Поиск экземпляра…</div> : null}
        {notFound ? <Alert severity="info" sx={{ mt: 2 }}>Экземпляр с таким номером не найден. Проверьте номер целиком.</Alert> : null}
        {search.isError && !notFound ? <Alert severity="error" sx={{ mt: 2 }}>Не удалось выполнить поиск. Введённый номер сохранён — попробуйте ещё раз.</Alert> : null}
        {result ? <SearchResultCard
          result={result}
          onAction={() => {
            setActionOpen(true);
            props.onClose();
          }}
        /> : null}
      </DialogContent>
      <DialogActions><Button onClick={close}>Закрыть</Button></DialogActions>
    </Dialog>
    {result && actionOpen ? <MaintenanceActionDialog
      instance={result}
      productName={result.product.name}
      open
      onClose={() => setActionOpen(false)}
      onSuccess={(updated) => setResult({ ...result, ...updated })}
    /> : null}
  </>;
}

function SearchResultCard(props: {
  result: InstanceSearchResult;
  onAction: () => void;
}) {
  const actionLabel = props.result.status === "AVAILABLE"
    ? "Отправить на обслуживание"
    : props.result.status === "MAINTENANCE"
      ? "Завершить обслуживание"
      : null;
  return <div className="maintenance-search-result" role="status">
    <div>
      <Typography variant="overline" color="text.secondary">Экземпляр найден</Typography>
      <Typography component="h3" variant="h6">{props.result.product.name} · {props.result.inventory_number}</Typography>
    </div>
    <Chip label={instanceStatusLabel(props.result.status)} color={props.result.status === "AVAILABLE" ? "success" : "warning"} />
    {props.result.active_maintenance ? <p><strong>Причина:</strong> {props.result.active_maintenance.reason}</p> : null}
    {actionLabel ? <Button variant="contained" onClick={props.onAction}>{actionLabel}</Button> : (
      <Alert severity="info">Для текущего статуса действие с обслуживанием недоступно.</Alert>
    )}
  </div>;
}

interface MaintenanceActionDialogProps {
  instance: ManagerInstance;
  productName: string;
  open: boolean;
  initialReason?: string;
  onClose: () => void;
  onSuccess?: (instance: ManagerInstance) => void;
}

export function MaintenanceActionDialog(props: MaintenanceActionDialogProps) {
  const [isCompletion] = useState(
    () => props.instance.status === "MAINTENANCE",
  );
  const defaultReason = props.initialReason
    ?? props.instance.active_maintenance?.reason
    ?? "";
  const [reason, setReason] = useState(defaultReason);
  const [repairCost, setRepairCost] = useState("");
  const [description, setDescription] = useState(defaultReason);
  const [images, setImages] = useState<File[]>([]);
  const [completed, setCompleted] = useState(false);
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async () => {
      if (isCompletion) {
        const maintenance = props.instance.active_maintenance;
        if (!maintenance) throw new Error("Не найдена активная запись обслуживания.");
        return completeMaintenance(maintenance.id, {
          repairCost,
          damageDescription: description,
          images,
        });
      }
      return startMaintenance(props.instance.id, reason);
    },
    onSuccess: async (maintenance) => {
      setCompleted(true);
      const updated: ManagerInstance = {
        ...props.instance,
        status: isCompletion ? "AVAILABLE" : "MAINTENANCE",
        active_maintenance: isCompletion ? null : maintenance,
      };
      props.onSuccess?.(updated);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["manager", "products"] }),
        queryClient.invalidateQueries({ queryKey: ["manager", "product"] }),
      ]);
    },
  });

  function close(): void {
    setReason(defaultReason);
    setDescription(defaultReason);
    setRepairCost("");
    setImages([]);
    setCompleted(false);
    mutation.reset();
    props.onClose();
  }

  const title = completed
    ? isCompletion ? "Обслуживание завершено" : "Отправлено на обслуживание"
    : isCompletion ? "Завершить обслуживание" : "Обслуживание";

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    mutation.mutate();
  }

  return <Dialog open={props.open} onClose={close} fullWidth maxWidth={isCompletion ? "md" : "sm"} aria-labelledby="maintenance-action-title">
    <DialogTitle id="maintenance-action-title" className="maintenance-dialog-title">
      {title}
      <Button className="maintenance-close" onClick={close} aria-label="Закрыть"><CloseIcon /></Button>
    </DialogTitle>
    <DialogContent>
      {completed ? <MaintenanceSuccess
        completion={isCompletion}
        productName={props.productName}
        inventoryNumber={props.instance.inventory_number}
        reason={isCompletion ? description || defaultReason : reason}
      /> : <form id="maintenance-form" className="maintenance-form" onSubmit={submit}>
        <InstanceBrief productName={props.productName} instance={props.instance} />
        {isCompletion ? <>
          <TextField
            label="Стоимость ремонта, ₽"
            name="repair_cost"
            autoComplete="off"
            type="number"
            value={repairCost}
            onChange={(event) => setRepairCost(event.target.value)}
            required
            slotProps={{ htmlInput: { min: 0, step: "0.01", inputMode: "decimal" } }}
          />
          <TextField
            label="Описание повреждения"
            name="damage_description"
            autoComplete="off"
            multiline
            minRows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            required
          />
          <div className="maintenance-photo-upload">
            <strong>Итоговый фотоакт</strong>
            <span>Необязательно · PNG или JPEG до 15 МБ</span>
            <Button component="label" variant="outlined">
              Выбрать фотографии
              <input
                className="visually-hidden"
                type="file"
                name="maintenance_photos"
                accept="image/png,image/jpeg,.png,.jpg,.jpeg"
                multiple
                onChange={(event) => setImages(Array.from(event.target.files ?? []))}
              />
            </Button>
            {images.length ? <span aria-live="polite">Выбрано фотографий: {images.length}</span> : null}
          </div>
        </> : <TextField
          autoFocus
          label="Причина обслуживания"
          name="reason"
          autoComplete="off"
          multiline
          minRows={3}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          required
          helperText="Опишите поломку или причину диагностики."
        />}
        {mutation.isError ? <Alert severity="error" role="alert">{maintenanceError(mutation.error)}</Alert> : null}
      </form>}
    </DialogContent>
    <DialogActions>
      {completed ? <Button variant="contained" onClick={close}>Вернуться к товарам</Button> : <>
        <Button onClick={close} disabled={mutation.isPending}>Отмена</Button>
        <Button
          form="maintenance-form"
          type="submit"
          variant="contained"
          disabled={mutation.isPending || (isCompletion ? repairCost === "" || !description.trim() : !reason.trim())}
        >
          {mutation.isPending ? "Сохраняем…" : isCompletion ? "Завершить обслуживание" : "Отправить на обслуживание"}
        </Button>
      </>}
    </DialogActions>
  </Dialog>;
}

function InstanceBrief(props: { productName: string; instance: ManagerInstance }) {
  return <div className="maintenance-instance-brief">
    <div aria-hidden="true" className="maintenance-instance-mark">✓</div>
    <div><strong>{props.productName} · {props.instance.inventory_number}</strong>
      <span>Текущий статус: {instanceStatusLabel(props.instance.status)}</span></div>
  </div>;
}

function MaintenanceSuccess(props: {
  completion: boolean;
  productName: string;
  inventoryNumber: string;
  reason: string;
}) {
  return <div className="maintenance-success" role="status">
    <InstanceBrief productName={props.productName} instance={{
      id: "", inventory_number: props.inventoryNumber,
      status: props.completion ? "AVAILABLE" : "MAINTENANCE",
      created_at: "", repair_total: "0", history_count: 0,
      history: [], active_maintenance: null,
    }} />
    <div className="maintenance-reason"><span>{props.completion ? "Описание повреждения" : "Причина обслуживания"}</span><strong>{props.reason}</strong></div>
  </div>;
}

function maintenanceError(error: Error | null): string {
  if (error instanceof ApiError) {
    return Object.values(error.fieldErrors).flat()[0] ?? error.message;
  }
  return error?.message ?? "Не удалось изменить статус экземпляра.";
}
