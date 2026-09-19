import { Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Link, Paper, TextField, Typography } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link as RouterLink, NavLink, useNavigate, useParams } from "react-router-dom";

import { getCategories, type Category } from "../api/categories";
import { ApiError } from "../api/client";
import {
  addInstance, addPhoto, freezeProduct, getCharacteristicValues, getOwnProduct,
  makePrimaryPhoto, publishProduct, removeInstance, removePhoto,
  saveBasic, saveCharacteristicValues, savePickup,
  OWN_PRODUCTS_KEY, type CharacteristicValue, type ManagerProduct, type PickupFields, type ProductFields,
} from "../api/manager";

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
  return <>
    <div className="manager-crumb"><Link component={RouterLink} to="/manager/products">Мои товары</Link> / {product?.name ?? "Новый товар"}</div>
    <div className="manager-head"><div><Typography variant="h3" component="h1">{archived ? "Просмотр товара" : product && step === "basic" ? "Редактирование товара" : current.title}</Typography>
      <Typography color="text.secondary">{product?.name ?? `Шаг ${steps.indexOf(current) + 1} из 5 · ${current.label}`}</Typography></div>
      <span className={`manager-status ${product?.status === "PUBLISHED" ? "manager-status--published" : ""}`}>{archived ? "Заморожен" : product?.status === "PUBLISHED" ? "Опубликован" : "Черновик"}</span>
    </div>
    {product?.status === "PUBLISHED" ? <Alert severity="info" sx={{ mb: 2 }}>Изменения названия, фото, ставки, характеристик и экземпляров сохраняются без повторной модерации. Точка самовывоза зафиксирована.</Alert> : null}
    {archived ? <Alert severity="info" sx={{ mb: 2 }}>Товар находится в архиве. Возврат из архива не предусмотрен.</Alert> : null}
    <nav className="manager-tabs" aria-label="Разделы редактора">{steps.map((item, index) =>
      product ? <NavLink key={item.id} to={`/manager/products/${product.id}/${item.id}`} aria-current={step === item.id ? "page" : undefined}>{index + 1} {item.label}</NavLink> :
        <span key={item.id} className={step === item.id ? "active" : ""}>{index + 1} {item.label}</span>,
    )}</nav>
    <div className="manager-editor-grid"><div>
      {step === "basic" ? <BasicForm key={product?.id ?? "new"} product={product} categories={categoriesQuery.data ?? []} /> : null}
      {product && step === "photos" ? <PhotosStep product={product} /> : null}
      {product && step === "features" ? <FeaturesStep product={product} categories={categoriesQuery.data ?? []} /> : null}
      {product && step === "pickup" ? <PickupStep product={product} /> : null}
      {product && step === "instances" ? <InstancesStep product={product} categories={categoriesQuery.data ?? []} /> : null}
    </div><Checklist product={product} categories={categoriesQuery.data ?? []} values={valuesQuery.data ?? []} /></div>
  </>;
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
  const { productId } = useParams();
  return <div className="manager-actions"><Button component={RouterLink} to="/manager/products">← Мои товары</Button><div>
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
  const archived = product?.status === "FROZEN";
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate(product ? { name: fields.name, description: fields.description, minute_rate: fields.minute_rate } : fields);
  }
  return <Paper component="form" onSubmit={submit} variant="outlined" className="manager-surface">
    <Typography variant="h6" component="h2" sx={{ mb: 3 }}>Основная информация</Typography><FormError error={mutation.error} />
    {saved ? <Alert severity="success" role="status" sx={{ mb: 2 }}>Изменения сохранены.</Alert> : null}
    <div className="manager-form-grid">
      <TextField select slotProps={{ select: { native: true }, htmlInput: { name: "category" } }} label="Категория" value={fields.category ?? ""} onChange={(event) => setFields({ ...fields, category: Number(event.target.value) })} required disabled={Boolean(product)} helperText="После создания категорию изменить нельзя.">
        <option value="" disabled>Выберите категорию</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
      </TextField>
      <TextField name="name" label="Название" value={fields.name} onChange={(event) => setFields({ ...fields, name: event.target.value })} required slotProps={{ htmlInput: { maxLength: 200 } }} disabled={archived} />
      <TextField name="description" label="Описание" multiline minRows={4} value={fields.description} onChange={(event) => setFields({ ...fields, description: event.target.value })} required disabled={archived} />
      <TextField name="minute_rate" label="Ставка, ₽/мин" type="number" slotProps={{ htmlInput: { min: 0.01, step: 0.01 } }} value={fields.minute_rate} onChange={(event) => setFields({ ...fields, minute_rate: event.target.value })} required disabled={archived} helperText="Общая ставка для всех экземпляров." />
    </div>
    <EditorActions next={product ? "photos" : undefined}>{!archived ? <Button type="submit" variant="contained" disabled={mutation.isPending}>{mutation.isPending ? "Сохраняем…" : product ? "Сохранить изменения" : "Сохранить и продолжить"}</Button> : null}</EditorActions>
  </Paper>;
}

function PhotosStep({ product }: { product: ManagerProduct }) {
  const refresh = useProductAction(product.id);
  const [pendingRemoval, setPendingRemoval] = useState<number | null>(null);
  const action = useMutation({ mutationFn: async (operation: () => Promise<void>) => operation(), onSuccess: refresh });
  return <Paper variant="outlined" className="manager-surface"><Typography variant="h6" component="h2">Публичные фотографии</Typography>
    <Typography color="text.secondary" sx={{ mb: 2 }}>PNG или JPEG, до 15 МБ на файл. Фотоакты здесь не размещаются.</Typography><FormError error={action.error} />
    {product.status !== "FROZEN" ? <label className="manager-upload">Добавить фотографии
      <input type="file" accept="image/png,image/jpeg,.jpg,.jpeg,.png" multiple onChange={(event) => {
        const files = Array.from(event.target.files ?? []);
        if (files.length) action.mutate(async () => { for (const file of files) await addPhoto(product.id, file); });
        event.target.value = "";
      }} disabled={action.isPending} /></label> : null}
    <div className="manager-photo-grid">{product.photos.map((photo, index) => <div className="manager-photo" key={photo.id}>
      <img src={photo.url} alt={`Фото ${index + 1} товара ${product.name}`} loading="lazy" width="240" height="180" />
      <div>{photo.is_primary ? <strong>Главное фото</strong> : <Button disabled={action.isPending || product.status === "FROZEN"} onClick={() => action.mutate(() => makePrimaryPhoto(product.id, photo.id))}>Сделать главным</Button>}
        <Button color="error" disabled={action.isPending || product.status === "FROZEN"} onClick={() => setPendingRemoval(photo.id)}>Удалить</Button></div>
    </div>)}</div>
    {product.photos.length === 0 ? <p className="manager-muted">Добавьте хотя бы одну фотографию перед публикацией.</p> : null}
    <EditorActions next="features" busy={action.isPending} />
    <Dialog open={pendingRemoval !== null} onClose={() => setPendingRemoval(null)} aria-labelledby="remove-photo-title"><DialogTitle id="remove-photo-title">Удалить фотографию?</DialogTitle><DialogActions><Button onClick={() => setPendingRemoval(null)}>Отмена</Button><Button color="error" onClick={() => { if (pendingRemoval !== null) action.mutate(() => removePhoto(product.id, pendingRemoval)); setPendingRemoval(null); }}>Удалить</Button></DialogActions></Dialog>
  </Paper>;
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
  const [values, setValues] = useState<Record<number, string>>(() => Object.fromEntries(initial.map((item) => [item.characteristic_id, String(item.option_id ?? item.number_value ?? (item.boolean_value === null ? "" : item.boolean_value))])));
  const mutation = useMutation({ mutationFn: (items: CharacteristicValue[]) => saveCharacteristicValues(product.id, items),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ["manager", "characteristics", product.id] }); },
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
    <div className="manager-form-grid">{category?.characteristics.map((definition) => <TextField key={definition.id} label={`${definition.name}${definition.unit ? `, ${definition.unit}` : ""}`} required={definition.is_required} select={definition.type !== "NUMBER"} slotProps={definition.type !== "NUMBER" ? { select: { native: true } } : { htmlInput: { step: "any" } }} type={definition.type === "NUMBER" ? "number" : undefined} value={values[definition.id] ?? ""} onChange={(event) => setValues({ ...values, [definition.id]: event.target.value })} disabled={product.status === "FROZEN"}>
      {definition.type !== "NUMBER" ? [<option value="" key="empty">Выберите значение</option>, ...(definition.type === "BOOLEAN" ? [<option value="true" key="true">Да</option>, <option value="false" key="false">Нет</option>] : definition.options.map((option) => <option key={option.id} value={option.id}>{option.value}</option>))] : undefined}
    </TextField>)}</div>
    {!category?.characteristics.length ? <Typography color="text.secondary">У этой категории нет характеристик.</Typography> : null}
    <EditorActions next="pickup" busy={mutation.isPending}>{product.status !== "FROZEN" ? <Button type="submit" variant="contained" disabled={mutation.isPending}>Сохранить характеристики</Button> : null}</EditorActions>
  </Paper>;
}

function PickupStep({ product }: { product: ManagerProduct }) {
  const refresh = useProductAction(product.id);
  const [fields, setFields] = useState<PickupFields>({
    city: product.pickup_point?.city ?? "", district: product.pickup_point?.district ?? "",
    full_address: product.pickup_point?.full_address ?? "", latitude: product.pickup_point?.latitude ?? "",
    longitude: product.pickup_point?.longitude ?? "",
  });
  const mutation = useMutation({ mutationFn: (values: PickupFields) => savePickup(product.id, values), onSuccess: refresh });
  const locked = Boolean(product.published_at);
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); mutation.mutate(fields); }
  return <Paper component="form" onSubmit={submit} variant="outlined" className="manager-surface"><Typography variant="h6" component="h2">Точка самовывоза</Typography>
    <Typography color="text.secondary" sx={{ mb: 2 }}>Одна точка для всех экземпляров. После первой публикации её нельзя изменить.</Typography><FormError error={mutation.error} />
    <div className="manager-form-grid">{([ ["city", "Город"], ["district", "Район"], ["full_address", "Полный адрес"], ["latitude", "Широта"], ["longitude", "Долгота"] ] as const).map(([field, label]) =>
      <TextField key={field} label={label} required value={fields[field]} onChange={(event) => setFields({ ...fields, [field]: event.target.value })} disabled={locked} slotProps={field === "latitude" || field === "longitude" ? { htmlInput: { inputMode: "decimal" } } : undefined} />)}</div>
    {product.pickup_point ? <div className="manager-map"><span aria-hidden="true">●</span><p>Точка на карте: {product.pickup_point.city}, {product.pickup_point.district}</p><Link href={product.pickup_point.yandex_maps_url} target="_blank" rel="noopener noreferrer">Открыть в Яндекс.Картах</Link></div> : null}
    <EditorActions next="instances" busy={mutation.isPending}>{!locked ? <Button type="submit" variant="contained" disabled={mutation.isPending}>Сохранить точку</Button> : null}</EditorActions>
  </Paper>;
}

function InstancesStep({ product, categories }: { product: ManagerProduct; categories: Category[] }) {
  const refresh = useProductAction(product.id);
  const navigate = useNavigate();
  const [inventory, setInventory] = useState("");
  const [confirmFreeze, setConfirmFreeze] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);
  const action = useMutation({ mutationFn: async (operation: () => Promise<unknown>) => operation(), onSuccess: refresh });
  const publish = useMutation({ mutationFn: () => publishProduct(product.id), onSuccess: async () => { await refresh(); navigate("/manager/products"); } });
  const freeze = useMutation({ mutationFn: () => freezeProduct(product.id), onSuccess: async () => { await refresh(); navigate("/manager/archive"); } });
  const required = categories.find((item) => item.id === product.category)?.characteristics.filter((item) => item.is_required) ?? [];
  return <><Paper variant="outlined" className="manager-surface"><Typography variant="h6" component="h2" sx={{ mb: 1 }}>Добавить экземпляр</Typography>
    <Typography color="text.secondary" sx={{ mb: 2 }}>Оставьте поле пустым для автоматического номера {product.catalog_number}-{product.instances.length + 1}. Свой номер должен быть уникален в вашем каталоге.</Typography><FormError error={action.error} />
    {product.status !== "FROZEN" ? <div className="manager-instance-form"><TextField label="Инвентарный номер" value={inventory} onChange={(event) => setInventory(event.target.value)} /><Button variant="contained" disabled={action.isPending} onClick={() => action.mutate(async () => { await addInstance(product.id, inventory); setInventory(""); })}>Добавить экземпляр</Button></div> : null}
  </Paper><Paper variant="outlined" className="manager-surface"><Typography variant="h6" component="h2" sx={{ mb: 2 }}>Добавленные экземпляры · {product.instances.length}</Typography>
    {product.instances.length ? <div className="manager-table-wrap"><table className="manager-table"><thead><tr><th>Инвентарный номер</th><th>Статус</th><th>Действие</th></tr></thead><tbody>{product.instances.map((instance) => <tr key={instance.id}><td data-label="Номер">{instance.inventory_number}</td><td data-label="Статус">{instance.status === "AVAILABLE" ? "Свободен" : instance.status}</td><td data-label="Действие"><Button color="error" disabled={action.isPending || instance.status !== "AVAILABLE" || product.status === "FROZEN"} onClick={() => setPendingRemoval(instance.id)}>Удалить</Button></td></tr>)}</tbody></table></div> : <Typography color="text.secondary">Для публикации нужен минимум один экземпляр.</Typography>}
    <FormError error={publish.error ?? freeze.error} />
    <EditorActions busy={publish.isPending || freeze.isPending}>
      {product.status === "DRAFT" ? <Button variant="contained" onClick={() => publish.mutate()} disabled={publish.isPending || !product.pickup_point || !product.photos.length || !product.instances.length}>Опубликовать товар</Button> : null}
      {product.status === "PUBLISHED" ? <Button variant="outlined" color="error" onClick={() => setConfirmFreeze(true)}>Заморозить</Button> : null}
    </EditorActions>{required.length && product.status === "DRAFT" ? <Typography className="manager-muted">Перед публикацией заполните обязательные характеристики на вкладке «Характеристики».</Typography> : null}
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
  </ul><p>После заполнения карточка автоматически пройдёт этап «На модерации» и появится в каталоге.</p></Paper>;
}
