import { Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Link, Paper, TextField, Typography } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link as RouterLink, NavLink, useNavigate, useParams } from "react-router-dom";

import { getCategories, type Category } from "../api/categories";
import { ApiError } from "../api/client";
import {
  addInstance, addPhoto, deleteProduct, freezeProduct, getCharacteristicValues, getOwnProduct,
  removeInstance, removePhoto, reorderPhotos,
  saveBasic, saveCharacteristicValues, savePickup,
  submitProduct,
  OWN_PRODUCTS_KEY, type CharacteristicValue, type ManagerProduct, type PickupFields, type ProductFields,
} from "../api/manager";
import { ArrowLeftIcon } from "../ui/Icons";

type Step = "basic" | "photos" | "features" | "pickup" | "instances";
const steps: { id: Step; label: string; title: string }[] = [
  { id: "basic", label: "Основное", title: "Новый товар" },
  { id: "photos", label: "Фото", title: "Фотографии товара" },
  { id: "features", label: "Характеристики", title: "Характеристики" },
  { id: "pickup", label: "Точка", title: "Точка самовывоза" },
  { id: "instances", label: "Экземпляры", title: "Экземпляры товара" },
];

export function ManagerEditor() {
  const { productId, step: requestedStep } = useParams();
  const id = Number(productId);
  const isNew = productId === undefined;
  const step: Step = steps.some((item) => item.id === requestedStep) ? requestedStep as Step : "basic";
  const productQuery = useQuery({
    queryKey: ["manager", "product", id], queryFn: () => getOwnProduct(id), enabled: !isNew,
  });
  const categoriesQuery = useQuery({ queryKey: ["categories"], queryFn: getCategories });
  const product = isNew ? undefined : productQuery.data;
  const valuesQuery = useQuery({
    queryKey: ["manager", "characteristics", id],
    queryFn: () => getCharacteristicValues(id), enabled: Boolean(product),
  });
  if (!isNew && productQuery.isPending || categoriesQuery.isPending) return <div role="status" className="manager-state"><CircularProgress /> Загрузка редактора…</div>;
  if (productQuery.isError || categoriesQuery.isError) return <Alert severity="error" action={<Button onClick={() => { productQuery.refetch(); categoriesQuery.refetch(); }}>Повторить</Button>}>Не удалось загрузить редактор товара.</Alert>;
  if (!isNew && !product) return null;
  const current = steps.find((item) => item.id === step)!;
  const archived = product?.status === "FROZEN";
  const showChecklist = product?.status === "DRAFT" || product?.status === "REJECTED";
  return <>
    <Button className="manager-back-to-products" component={RouterLink} to="/manager/products" startIcon={<ArrowLeftIcon />}>Мои товары</Button>
    <div className="manager-head"><div><Typography variant="h3" component="h1">{archived ? "Просмотр товара" : product && step === "basic" ? "Редактирование товара" : current.title}</Typography>
      <Typography color="text.secondary">{product?.name ?? `Шаг ${steps.indexOf(current) + 1} из 5 · ${current.label}`}</Typography></div>
      <span className={`manager-status ${product?.status === "PUBLISHED" ? "manager-status--published" : ""}`}>{product ? productStatusLabel(product.status) : "Черновик"}</span>
    </div>
    {product?.status === "PUBLISHED" ? <Alert severity="info" sx={{ mb: 2 }}>Изменения названия, фото, ставки, характеристик и экземпляров сохраняются без повторной модерации. Точка самовывоза зафиксирована.</Alert> : null}
    {product?.status === "ON_MODERATION" ? <Alert severity="info" sx={{ mb: 2 }}>Карточка ожидает решения администратора и пока недоступна для редактирования.</Alert> : null}
    {archived ? <Alert severity="info" sx={{ mb: 2 }}>Товар находится в архиве. Возврат из архива не предусмотрен.</Alert> : null}
    <nav className="manager-tabs" aria-label="Разделы редактора">{steps.map((item) =>
      product ? <NavLink key={item.id} to={`/manager/products/${product.id}/${item.id}`} aria-current={step === item.id ? "page" : undefined}>{item.label}</NavLink> :
        <span key={item.id} className={step === item.id ? "active" : ""}>{item.label}</span>,
    )}</nav>
    <div className={`manager-editor-grid${showChecklist ? "" : " manager-editor-grid--wide"}`}><div>
      {step === "basic" ? <BasicForm key={product?.id ?? "new"} product={product} categories={categoriesQuery.data ?? []} /> : null}
      {product && step === "photos" ? <PhotosStep key={product.photos.map((photo) => `${photo.id}:${photo.display_order}:${photo.is_primary}`).join("|")} product={product} /> : null}
      {product && step === "features" ? <FeaturesStep product={product} categories={categoriesQuery.data ?? []} /> : null}
      {product && step === "pickup" ? <PickupStep product={product} /> : null}
      {product && step === "instances" ? <InstancesStep product={product} categories={categoriesQuery.data ?? []} /> : null}
    </div>{showChecklist ? <Checklist product={product} categories={categoriesQuery.data ?? []} values={valuesQuery.data ?? []} /> : null}</div>
    {product?.status === "REJECTED" ? <RejectedProductDialog product={product} /> : null}
  </>;
}

function productStatusLabel(status: ManagerProduct["status"]): string {
  const labels: Record<ManagerProduct["status"], string> = {
    DRAFT: "Черновик",
    ON_MODERATION: "На модерации",
    PUBLISHED: "Опубликован",
    REJECTED: "Отклонён",
    FROZEN: "Заморожен",
    HIDDEN_BY_ADMIN: "Скрыт администратором",
  };
  return labels[status];
}

function isProductReadOnly(product: ManagerProduct): boolean {
  return product.status === "FROZEN" || product.status === "ON_MODERATION" || product.status === "HIDDEN_BY_ADMIN";
}

function RejectedProductDialog({ product }: { product: ManagerProduct }) {
  const [mode, setMode] = useState<"reason" | "confirm-delete" | "closed">("reason");
  const client = useQueryClient();
  const navigate = useNavigate();
  const deletion = useMutation({
    mutationFn: () => deleteProduct(product.id),
    onSuccess: async () => {
      navigate("/manager/rejected");
      await client.invalidateQueries({ queryKey: OWN_PRODUCTS_KEY });
    },
  });
  const confirmingDeletion = mode === "confirm-delete";
  return <Dialog
    open={mode !== "closed"}
    onClose={() => setMode("closed")}
    aria-labelledby="rejected-product-title"
  >
    <DialogTitle id="rejected-product-title">
      {confirmingDeletion ? "Удалить карточку безвозвратно?" : "Карточка отклонена"}
    </DialogTitle>
    <DialogContent>
      {confirmingDeletion ? <>
        <p><strong>{product.name}</strong> и все данные неопубликованной карточки будут удалены.</p>
        <p>Это действие нельзя отменить.</p>
      </> : <>
        <Typography color="text.secondary" sx={{ mb: 1 }}>Причина отклонения</Typography>
        <Typography>{product.rejection_reason}</Typography>
      </>}
      <FormError error={deletion.error} />
    </DialogContent>
    <DialogActions>
      {confirmingDeletion ? <>
        <Button onClick={() => setMode("reason")} disabled={deletion.isPending}>Назад</Button>
        <Button color="error" onClick={() => deletion.mutate()} disabled={deletion.isPending}>
          {deletion.isPending ? "Удаляем…" : "Удалить безвозвратно"}
        </Button>
      </> : <>
        <Button color="error" onClick={() => setMode("confirm-delete")}>Удалить карточку</Button>
        <Button variant="contained" onClick={() => setMode("closed")}>Перейти к редактированию</Button>
      </>}
    </DialogActions>
  </Dialog>;
}

function useProductAction(id: number) {
  const client = useQueryClient();
  return async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: OWN_PRODUCTS_KEY }),
      client.invalidateQueries({ queryKey: ["manager", "product", id] }),
      client.invalidateQueries({ queryKey: ["catalog"] }),
    ]);
  };
}

function FormError({ error }: { error: unknown }) {
  const summary = useRef<HTMLDivElement>(null);
  useEffect(() => { if (error) summary.current?.focus(); }, [error]);
  if (!error) return null;
  return <Alert ref={summary} tabIndex={-1} severity="error" role="alert" sx={{ mb: 2 }}>
    {error instanceof ApiError ? Object.entries(error.fieldErrors).map(([field, messages]) =>
      <div key={field}>{messages.join(" ")}</div>) : null}
    {error instanceof Error ? error.message : "Не удалось сохранить изменения."}
  </Alert>;
}

function EditorActions({ children, next, busy }: { children?: ReactNode; next?: Step; busy?: boolean }) {
  const { productId, step = "basic" } = useParams();
  const currentIndex = steps.findIndex((item) => item.id === step);
  const previous = currentIndex > 0 ? steps[currentIndex - 1] : undefined;
  return <div className="manager-actions"><div>
    {previous && productId ? <Button component={RouterLink} to={`/manager/products/${productId}/${previous.id}`} startIcon={<ArrowLeftIcon />}>Назад</Button> : null}
  </div><div>
    {children}{next && productId ? <Button component={RouterLink} to={`/manager/products/${productId}/${next}`} disabled={busy}>Далее →</Button> : null}
  </div></div>;
}

function BasicForm({ product, categories }: { product?: ManagerProduct; categories: Category[] }) {
  const navigate = useNavigate();
  const refresh = useProductAction(product?.id ?? 0);
  const [saved, setSaved] = useState(false);
  const [fields, setFields] = useState<ProductFields>({
    category: product?.category ?? categories[0]?.id,
    name: product?.name ?? "", description: product?.description ?? "",
    minute_rate: product?.minute_rate ?? "",
  });
  const mutation = useMutation({ mutationFn: (values: ProductFields) => saveBasic(values, product?.id),
    onSuccess: async (result) => { await refresh(); if (product) setSaved(true); else navigate(`/manager/products/${result.id}/photos`); },
  });
  const readOnly = product ? isProductReadOnly(product) : false;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate(product ? { name: fields.name, description: fields.description, minute_rate: fields.minute_rate } : fields);
  }
  return <Paper component="form" onSubmit={submit} variant="outlined" className="manager-surface">
    <Typography variant="h6" component="h2" sx={{ mb: 3 }}>Основная информация</Typography><FormError error={mutation.error} />
    {saved ? <Alert severity="success" role="status" sx={{ mb: 2 }}>Изменения сохранены.</Alert> : null}
    <div className="manager-form-grid">
      <TextField select autoComplete="off" slotProps={{ select: { native: true }, htmlInput: { name: "category" } }} label="Категория" value={fields.category ?? ""} onChange={(event) => setFields({ ...fields, category: Number(event.target.value) })} required disabled={Boolean(product)} helperText="После создания категорию изменить нельзя.">
        <option value="" disabled>Выберите категорию</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
      </TextField>
      <TextField name="name" autoComplete="off" label="Название" value={fields.name} onChange={(event) => setFields({ ...fields, name: event.target.value })} required slotProps={{ htmlInput: { maxLength: 200 } }} disabled={readOnly} />
      <TextField name="description" autoComplete="off" label="Описание" multiline minRows={4} value={fields.description} onChange={(event) => setFields({ ...fields, description: event.target.value })} required disabled={readOnly} />
      <TextField name="minute_rate" autoComplete="off" label="Ставка, ₽/мин" type="number" slotProps={{ htmlInput: { min: 0.01, step: 0.01 } }} value={fields.minute_rate} onChange={(event) => setFields({ ...fields, minute_rate: event.target.value })} required disabled={readOnly} helperText="Общая ставка для всех экземпляров." />
    </div>
    <EditorActions next={product ? "photos" : undefined}>{!readOnly ? <Button type="submit" variant="contained" disabled={mutation.isPending}>{mutation.isPending ? "Сохраняем…" : product ? "Сохранить изменения" : "Сохранить и продолжить"}</Button> : null}</EditorActions>
  </Paper>;
}

function PhotosStep({ product }: { product: ManagerProduct }) {
  const refresh = useProductAction(product.id);
  const readOnly = isProductReadOnly(product);
  const [pendingRemoval, setPendingRemoval] = useState<number | null>(null);
  const [draggedPhotoId, setDraggedPhotoId] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [orderedPhotos, setOrderedPhotos] = useState(() => orderPhotos(product.photos));
  const dragOriginOrder = useRef<ManagerProduct["photos"] | null>(null);
  const dragPreviewOrder = useRef<ManagerProduct["photos"] | null>(null);
  const photoElements = useRef(new Map<number, HTMLDivElement>());
  const previousPhotoPositions = useRef<Map<number, DOMRect> | null>(null);
  const action = useMutation({ mutationFn: async (operation: () => Promise<void>) => operation(), onSuccess: refresh });

  useLayoutEffect(() => {
    const previousPositions = previousPhotoPositions.current;
    previousPhotoPositions.current = null;
    const prefersReducedMotion = typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!previousPositions || prefersReducedMotion) return;
    const movements = [...photoElements.current].flatMap(([photoId, element]) => {
      const previous = previousPositions.get(photoId);
      if (!previous || typeof element.animate !== "function") return [];
      const current = element.getBoundingClientRect();
      const offsetX = previous.left - current.left;
      const offsetY = previous.top - current.top;
      return offsetX === 0 && offsetY === 0 ? [] : [{ element, offsetX, offsetY }];
    });
    movements.forEach(({ element, offsetX, offsetY }) => {
      element.animate(
        [{ transform: `translate(${offsetX}px, ${offsetY}px)` }, { transform: "translate(0, 0)" }],
        { duration: 180, easing: "ease-out" },
      );
    });
  }, [orderedPhotos]);

  function capturePhotoPositions(): void {
    previousPhotoPositions.current = new Map(
      [...photoElements.current].map(([photoId, element]) => [photoId, element.getBoundingClientRect()]),
    );
  }

  function movePhoto(photoId: number, targetIndex: number): void {
    const nextPhotos = repositionPhoto(orderedPhotos, photoId, targetIndex);
    if (nextPhotos === orderedPhotos) return;
    capturePhotoPositions();
    setOrderedPhotos(nextPhotos);
    setAnnouncement(`Фото перемещено на позицию ${targetIndex + 1}`);
    action.mutate(() => reorderPhotos(product.id, nextPhotos.map((photo) => photo.id)));
  }

  function previewPhotoPosition(targetIndex: number): void {
    if (draggedPhotoId === null) return;
    const currentOrder = dragPreviewOrder.current ?? orderedPhotos;
    const nextPhotos = repositionPhoto(currentOrder, draggedPhotoId, targetIndex);
    if (nextPhotos === currentOrder) return;
    capturePhotoPositions();
    dragPreviewOrder.current = nextPhotos;
    setOrderedPhotos(nextPhotos);
  }

  function finishPhotoDrag(): void {
    const nextPhotos = dragPreviewOrder.current;
    const originalPhotos = dragOriginOrder.current;
    dragOriginOrder.current = null;
    dragPreviewOrder.current = null;
    setDraggedPhotoId(null);
    if (!nextPhotos || !originalPhotos || haveSamePhotoOrder(nextPhotos, originalPhotos)) return;
    const finalIndex = nextPhotos.findIndex((photo) => photo.id === draggedPhotoId);
    setAnnouncement(`Фото перемещено на позицию ${finalIndex + 1}`);
    action.mutate(() => reorderPhotos(product.id, nextPhotos.map((photo) => photo.id)));
  }

  function cancelPhotoDrag(): void {
    const originalPhotos = dragOriginOrder.current;
    dragOriginOrder.current = null;
    dragPreviewOrder.current = null;
    setDraggedPhotoId(null);
    if (!originalPhotos || haveSamePhotoOrder(originalPhotos, orderedPhotos)) return;
    capturePhotoPositions();
    setOrderedPhotos(originalPhotos);
  }

  return <Paper variant="outlined" className="manager-surface"><Typography variant="h6" component="h2">Публичные фотографии</Typography>
    <Typography color="text.secondary" sx={{ mb: 2 }}>PNG или JPEG, до 15 МБ на файл. Фотоакты здесь не размещаются.</Typography><FormError error={action.error} />
    {!readOnly ? <div className="manager-upload"><Typography>Перетащите фотографии для изменения порядка</Typography>
      <Button component="label" variant="outlined">Выбрать файлы
      <input className="visually-hidden" type="file" accept="image/png,image/jpeg,.jpg,.jpeg,.png" multiple onChange={(event) => {
        const files = Array.from(event.target.files ?? []);
        if (files.length) action.mutate(async () => { for (const file of files) await addPhoto(product.id, file); });
        event.target.value = "";
      }} disabled={action.isPending} /></Button></div> : null}
    <p id="photo-order-instructions" className="visually-hidden">Для изменения порядка с клавиатуры выберите фото и нажмите Alt со стрелкой влево или вправо.</p>
    <div className="manager-photo-grid" role="list" aria-label="Фотографии товара">{orderedPhotos.map((photo, index) => <div
      className="manager-photo"
      data-dragging={draggedPhotoId === photo.id || undefined}
      draggable={!readOnly && !action.isPending}
      key={photo.id}
      ref={(element) => {
        if (element) photoElements.current.set(photo.id, element);
        else photoElements.current.delete(photo.id);
      }}
      role="listitem"
      tabIndex={!readOnly ? 0 : undefined}
      aria-label={`Фото ${index + 1} товара ${product.name}`}
      aria-describedby={!readOnly ? "photo-order-instructions" : undefined}
      onDragStart={() => {
        dragOriginOrder.current = orderedPhotos;
        dragPreviewOrder.current = orderedPhotos;
        setDraggedPhotoId(photo.id);
      }}
      onDragEnd={cancelPhotoDrag}
      onDragEnter={() => previewPhotoPosition(index)}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        finishPhotoDrag();
      }}
      onKeyDown={(event) => {
        if (!event.altKey || action.isPending || readOnly) return;
        if (event.key === "ArrowLeft" && index > 0) {
          event.preventDefault();
          movePhoto(photo.id, index - 1);
        }
        if (event.key === "ArrowRight" && index < orderedPhotos.length - 1) {
          event.preventDefault();
          movePhoto(photo.id, index + 1);
        }
      }}
    >
      <img src={photo.url} alt={`Фото ${index + 1} товара ${product.name}`} loading="lazy" width="240" height="180" />
      <div>{index === 0 ? <strong>Главное фото</strong> : <Button disabled={action.isPending || readOnly} onClick={() => movePhoto(photo.id, 0)}>Сделать главным</Button>}
        <Button color="error" disabled={action.isPending || readOnly} onClick={() => setPendingRemoval(photo.id)}>Удалить</Button></div>
    </div>)}</div>
    <span className="visually-hidden" aria-live="polite">{announcement}</span>
    {product.photos.length === 0 ? <p className="manager-muted">Добавьте хотя бы одну фотографию перед публикацией.</p> : null}
    <EditorActions next="features" busy={action.isPending} />
    <Dialog open={pendingRemoval !== null} onClose={() => setPendingRemoval(null)} aria-labelledby="remove-photo-title"><DialogTitle id="remove-photo-title">Удалить фотографию?</DialogTitle><DialogActions><Button onClick={() => setPendingRemoval(null)}>Отмена</Button><Button color="error" onClick={() => { if (pendingRemoval !== null) action.mutate(() => removePhoto(product.id, pendingRemoval)); setPendingRemoval(null); }}>Удалить</Button></DialogActions></Dialog>
  </Paper>;
}

function orderPhotos(photos: ManagerProduct["photos"]): ManagerProduct["photos"] {
  return [...photos].sort((left, right) => {
    if (left.is_primary !== right.is_primary) return left.is_primary ? -1 : 1;
    return left.display_order - right.display_order;
  });
}

function repositionPhoto(
  photos: ManagerProduct["photos"],
  photoId: number,
  targetIndex: number,
): ManagerProduct["photos"] {
  const sourceIndex = photos.findIndex((photo) => photo.id === photoId);
  if (sourceIndex < 0 || sourceIndex === targetIndex) return photos;
  const nextPhotos = [...photos];
  const [movedPhoto] = nextPhotos.splice(sourceIndex, 1);
  nextPhotos.splice(targetIndex, 0, movedPhoto);
  return nextPhotos;
}

function haveSamePhotoOrder(
  left: ManagerProduct["photos"],
  right: ManagerProduct["photos"],
): boolean {
  return left.length === right.length && left.every((photo, index) => photo.id === right[index]?.id);
}

function FeaturesStep({ product, categories }: { product: ManagerProduct; categories: Category[] }) {
  const category = categories.find((item) => item.id === product.category);
  const query = useQuery({ queryKey: ["manager", "characteristics", product.id], queryFn: () => getCharacteristicValues(product.id) });
  if (query.isPending) return <div role="status" className="manager-state">Загрузка характеристик…</div>;
  if (query.isError) return <Alert severity="error" action={<Button onClick={() => query.refetch()}>Повторить</Button>}>Не удалось загрузить характеристики.</Alert>;
  return <FeatureForm product={product} category={category} initial={query.data} />;
}

function FeatureForm({ product, category, initial }: { product: ManagerProduct; category?: Category; initial: CharacteristicValue[] }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const readOnly = isProductReadOnly(product);
  const [values, setValues] = useState<Record<number, string>>(() => Object.fromEntries(initial.map((item) => [
    item.characteristic_id,
    item.number_value === null
      ? String(item.option_id ?? (item.boolean_value === null ? "" : item.boolean_value))
      : trimDecimalZeros(item.number_value),
  ])));
  const mutation = useMutation({ mutationFn: (items: CharacteristicValue[]) => saveCharacteristicValues(product.id, items),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["manager", "characteristics", product.id] });
      navigate(`/manager/products/${product.id}/pickup`);
    },
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const selected = (category?.characteristics ?? []).filter((definition) => values[definition.id] !== undefined && values[definition.id] !== "");
    mutation.mutate(selected.map((definition) => ({
      characteristic_id: definition.id,
      option_id: definition.type === "LIST" ? Number(values[definition.id]) : null,
      number_value: definition.type === "NUMBER" ? values[definition.id] : null,
      boolean_value: definition.type === "BOOLEAN" ? values[definition.id] === "true" : null,
    })));
  }
  return <Paper component="form" onSubmit={submit} variant="outlined" className="manager-surface"><Typography variant="h6" component="h2" sx={{ mb: 1 }}>Характеристики категории</Typography>
    <Typography color="text.secondary" sx={{ mb: 2 }}>Поля зависят от выбранной категории, включая унаследованные.</Typography><FormError error={mutation.error} />
    <div className="manager-form-grid">{category?.characteristics.map((definition) => <TextField key={definition.id} name={`characteristic-${definition.id}`} autoComplete="off" label={`${definition.name}${definition.unit ? `, ${definition.unit}` : ""}`} required={definition.is_required} select={definition.type !== "NUMBER"} slotProps={definition.type !== "NUMBER" ? { select: { native: true } } : { htmlInput: { step: "any" } }} type={definition.type === "NUMBER" ? "number" : undefined} value={values[definition.id] ?? ""} onChange={(event) => setValues({ ...values, [definition.id]: event.target.value })} disabled={readOnly}>
      {definition.type !== "NUMBER" ? [<option value="" key="empty">—</option>, ...(definition.type === "BOOLEAN" ? [<option value="true" key="true">Да</option>, <option value="false" key="false">Нет</option>] : definition.options.map((option) => <option key={option.id} value={option.id}>{option.value}</option>))] : undefined}
    </TextField>)}</div>
    {!category?.characteristics.length ? <Typography color="text.secondary">У этой категории нет характеристик.</Typography> : null}
    <EditorActions busy={mutation.isPending}>{!readOnly ? <Button type="submit" variant="contained" disabled={mutation.isPending}>Сохранить характеристики</Button> : null}</EditorActions>
  </Paper>;
}

function trimDecimalZeros(value: string): string {
  return value.includes(".") ? value.replace(/\.?0+$/, "") : value;
}

function PickupStep({ product }: { product: ManagerProduct }) {
  const refresh = useProductAction(product.id);
  const [fields, setFields] = useState<PickupFields>({
    city: product.pickup_point?.city ?? "", district: product.pickup_point?.district ?? "",
    full_address: product.pickup_point?.full_address ?? "", latitude: product.pickup_point?.latitude ?? "",
    longitude: product.pickup_point?.longitude ?? "",
  });
  const mutation = useMutation({ mutationFn: (values: PickupFields) => savePickup(product.id, values), onSuccess: refresh });
  const locked = Boolean(product.published_at) || isProductReadOnly(product);
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); mutation.mutate(fields); }
  return <Paper component="form" onSubmit={submit} variant="outlined" className="manager-surface"><Typography variant="h6" component="h2">Точка самовывоза</Typography>
    <Typography color="text.secondary" sx={{ mb: 2 }}>Одна точка для всех экземпляров. После первой публикации её нельзя изменить.</Typography><FormError error={mutation.error} />
    <div className="manager-form-grid">{([ ["city", "Город"], ["district", "Район"], ["full_address", "Полный адрес"], ["latitude", "Широта"], ["longitude", "Долгота"] ] as const).map(([field, label]) =>
      <TextField key={field} name={field} autoComplete="off" label={label} required value={fields[field]} onChange={(event) => setFields({ ...fields, [field]: event.target.value })} disabled={locked} slotProps={field === "latitude" || field === "longitude" ? { htmlInput: { inputMode: "decimal" } } : undefined} />)}</div>
    {product.pickup_point ? <div className="manager-map"><span aria-hidden="true">●</span><p>Точка на карте: {product.pickup_point.city}, {product.pickup_point.district}</p><Link href={product.pickup_point.yandex_maps_url} target="_blank" rel="noopener noreferrer">Открыть в Яндекс.Картах</Link></div> : null}
    <EditorActions next="instances" busy={mutation.isPending}>{!locked ? <Button type="submit" variant="contained" disabled={mutation.isPending}>Сохранить точку</Button> : null}</EditorActions>
  </Paper>;
}

function InstancesStep({ product, categories }: { product: ManagerProduct; categories: Category[] }) {
  const refresh = useProductAction(product.id);
  const navigate = useNavigate();
  const readOnly = isProductReadOnly(product);
  const [inventory, setInventory] = useState("");
  const [confirmFreeze, setConfirmFreeze] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);
  const action = useMutation({ mutationFn: async (operation: () => Promise<unknown>) => operation(), onSuccess: refresh });
  const submission = useMutation({ mutationFn: () => submitProduct(product.id), onSuccess: async () => { navigate("/manager/products"); await refresh(); } });
  const freeze = useMutation({ mutationFn: () => freezeProduct(product.id), onSuccess: async () => { navigate("/manager/archive"); await refresh(); } });
  const required = categories.find((item) => item.id === product.category)?.characteristics.filter((item) => item.is_required) ?? [];
  return <><Paper variant="outlined" className="manager-surface"><Typography variant="h6" component="h2" sx={{ mb: 1 }}>Добавить экземпляр</Typography>
    <Typography color="text.secondary" sx={{ mb: 2 }}>Оставьте поле пустым для автоматического номера {product.catalog_number}-{product.instances.length + 1}. Свой номер должен быть уникален в вашем каталоге.</Typography><FormError error={action.error} />
    {!readOnly ? <div className="manager-instance-form"><TextField name="inventory_number" autoComplete="off" label="Инвентарный номер" value={inventory} onChange={(event) => setInventory(event.target.value)} /><Button variant="contained" disabled={action.isPending} onClick={() => action.mutate(async () => { await addInstance(product.id, inventory); setInventory(""); })}>Добавить экземпляр</Button></div> : null}
  </Paper><Paper variant="outlined" className="manager-surface"><Typography variant="h6" component="h2" sx={{ mb: 2 }}>Добавленные экземпляры · {product.instances.length}</Typography>
    {product.instances.length ? <div className="manager-table-wrap"><table className="manager-table"><thead><tr><th>Инвентарный номер</th><th>Статус</th><th>Действие</th></tr></thead><tbody>{product.instances.map((instance) => <tr key={instance.id}><td data-label="Номер">{instance.inventory_number}</td><td data-label="Статус">{instance.status === "AVAILABLE" ? "Свободен" : instance.status}</td><td data-label="Действие"><Button color="error" disabled={action.isPending || instance.status !== "AVAILABLE" || readOnly} onClick={() => setPendingRemoval(instance.id)}>Удалить</Button></td></tr>)}</tbody></table></div> : <Typography color="text.secondary">Для отправки на модерацию нужен минимум один экземпляр.</Typography>}
    <FormError error={submission.error ?? freeze.error} />
    <EditorActions busy={submission.isPending || freeze.isPending}>
      {product.status === "DRAFT" || product.status === "REJECTED" ? <Button variant="contained" onClick={() => submission.mutate()} disabled={submission.isPending || !product.pickup_point || !product.photos.length || !product.instances.length}>{product.status === "REJECTED" ? "Повторно отправить на модерацию" : "Отправить на модерацию"}</Button> : null}
      {product.status === "PUBLISHED" ? <Button variant="outlined" color="error" onClick={() => setConfirmFreeze(true)}>Заморозить</Button> : null}
    </EditorActions>{required.length && (product.status === "DRAFT" || product.status === "REJECTED") ? <Typography className="manager-muted">Перед отправкой заполните обязательные характеристики на вкладке «Характеристики».</Typography> : null}
  </Paper>
    <Dialog open={confirmFreeze} onClose={() => setConfirmFreeze(false)} aria-labelledby="freeze-title"><DialogTitle id="freeze-title">Заморозить товар?</DialogTitle><DialogContent><p><strong>{product.name}</strong> исчезнет из общего каталога и перейдёт в архив публичного профиля.</p><p>Новые заявки станут недоступны. Уже начатые брони и аренды сохраняются. Вернуть товар из архива нельзя.</p></DialogContent><DialogActions><Button onClick={() => setConfirmFreeze(false)}>Отмена</Button><Button color="error" disabled={freeze.isPending} onClick={() => freeze.mutate()}>Заморозить товар</Button></DialogActions></Dialog>
    <Dialog open={pendingRemoval !== null} onClose={() => setPendingRemoval(null)} aria-labelledby="remove-instance-title"><DialogTitle id="remove-instance-title">Удалить экземпляр?</DialogTitle><DialogContent>Экземпляр будет помечен как удалённый; его история сохранится.</DialogContent><DialogActions><Button onClick={() => setPendingRemoval(null)}>Отмена</Button><Button color="error" onClick={() => { if (pendingRemoval) action.mutate(() => removeInstance(product.id, pendingRemoval)); setPendingRemoval(null); }}>Удалить</Button></DialogActions></Dialog>
  </>;
}

function Checklist({ product, categories, values }: { product?: ManagerProduct; categories: Category[]; values: CharacteristicValue[] }) {
  const required = categories.find((item) => item.id === product?.category)?.characteristics.filter((item) => item.is_required) ?? [];
  const characteristicsComplete = required.every((definition) => values.some((value) => value.characteristic_id === definition.id));
  return <Paper component="aside" variant="outlined" className="manager-checklist"><Typography variant="h6">Перед публикацией</Typography><ul>
    <li className={product ? "done" : ""}>{product ? "✓" : "○"} Основное</li>
    <li className={product?.photos.length ? "done" : ""}>{product?.photos.length ? "✓" : "○"} Фото</li>
    <li className={characteristicsComplete ? "done" : ""}>{characteristicsComplete ? "✓" : "○"} Обязательные характеристики</li>
    <li className={product?.pickup_point ? "done" : ""}>{product?.pickup_point ? "✓" : "○"} Точка самовывоза</li>
    <li className={product?.instances.length ? "done" : ""}>{product?.instances.length ? "✓" : "○"} Минимум один экземпляр</li>
  </ul><p>После отправки карточка получит статус «На модерации». В каталоге она появится только после одобрения.</p></Paper>;
}
