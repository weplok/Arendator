import {
  Alert,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Link,
  Paper,
  Typography,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link as RouterLink, useParams } from "react-router-dom";

import {
  getOwnProduct,
  type InstanceHistory,
  type ManagerInstance,
  type ManagerProduct,
} from "../api/manager";
import { formatRate } from "../catalog/formatting";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BoxIcon,
  ChevronDownIcon,
  CloseIcon,
  ImageIcon,
  SadImageIcon,
  SearchIcon,
  ToolIcon,
} from "../ui/Icons";
import { InstanceSearchDialog, MaintenanceActionDialog } from "./ManagerMaintenance";
import { instanceStatusLabel } from "./managerStatus";

export function ManagerProductPage() {
  const productId = Number(useParams().productId);
  const [searchOpen, setSearchOpen] = useState(false);
  const [actionInstance, setActionInstance] = useState<ManagerInstance | null>(null);
  const query = useQuery({
    queryKey: ["manager", "product", productId],
    queryFn: () => getOwnProduct(productId),
  });
  if (query.isPending) return <div className="manager-state" role="status"><CircularProgress /> Загрузка товара…</div>;
  if (query.isError) return <Alert severity="error" action={<Button onClick={() => query.refetch()}>Повторить</Button>}>Не удалось загрузить товар.</Alert>;
  const product = query.data;
  return <>
    <div className="manager-product-crumb"><RouterLink to="/manager/products">Мои товары</RouterLink> / {product.name}</div>
    <div className="manager-product-heading">
      <div>
        <Chip size="small" label={productStatusLabel(product.status)} color={product.status === "PUBLISHED" ? "success" : "default"} />
        <Typography component="h1" variant="h3">{product.name}</Typography>
        <Typography color="text.secondary">Экземпляры и история обслуживания</Typography>
      </div>
      <div className="manager-product-heading__actions">
        <Button variant="outlined" startIcon={<SearchIcon />} onClick={() => setSearchOpen(true)}>Найти экземпляр</Button>
        <Button component={RouterLink} to={`/manager/products/${product.id}/basic`} variant="contained">Редактировать</Button>
      </div>
    </div>
    <ProductSummary product={product} />
    <InstanceList product={product} onAction={setActionInstance} />
    <InstanceSearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} />
    {actionInstance ? <MaintenanceActionDialog
      open
      instance={actionInstance}
      productName={product.name}
      onClose={() => setActionInstance(null)}
      onSuccess={() => query.refetch()}
    /> : null}
  </>;
}

function ProductSummary({ product }: { product: ManagerProduct }) {
  const [expanded, setExpanded] = useState(false);
  const statuses = useMemo(() => countInstanceStatuses(product.instances), [product.instances]);
  const descriptionIsLong = product.description.length > 100;
  const description = !expanded && descriptionIsLong
    ? `${product.description.slice(0, 100).trimEnd()}…`
    : product.description;
  const primaryPhoto = product.photos.find((photo) => photo.is_primary) ?? product.photos[0];
  return <Paper variant="outlined" className="manager-product-summary">
    <div className="manager-product-visual">
      {primaryPhoto ? <img src={primaryPhoto.url} alt={`Основное фото товара ${product.name}`} width="240" height="180" /> : <ImageIcon width="80" height="80" />}
    </div>
    <div className="manager-product-summary__body">
      <Typography component="h2" variant="h5">{product.name}</Typography>
      <p className="manager-product-description">{description} {descriptionIsLong ? <Button size="small" onClick={() => setExpanded((value) => !value)}>{expanded ? "Свернуть" : "Подробнее"}</Button> : null}</p>
      <div className="manager-product-meta">
        <div><span>Категория</span><strong>{product.category_name}</strong></div>
        <div><span>Ставка</span><strong>{formatRate(product.minute_rate)} ₽/мин</strong></div>
        <div><span>Точка</span>{product.pickup_point ? <Link href={product.pickup_point.yandex_maps_url} target="_blank" rel="noreferrer">{product.pickup_point.city}, {product.pickup_point.district}</Link> : <strong>Не указана</strong>}</div>
        <div><span>Экземпляры</span><strong><span className="manager-nowrap">{statuses.AVAILABLE} свободно</span> · {product.instances.length} всего</strong></div>
      </div>
    </div>
  </Paper>;
}

function InstanceList(props: {
  product: ManagerProduct;
  onAction: (instance: ManagerInstance) => void;
}) {
  const totalRepairCost = props.product.instances.reduce(
    (total, instance) => total + Number(instance.repair_total), 0,
  );
  return <section className="manager-instance-section" aria-labelledby="instances-title">
    <div className="manager-instance-section__head">
      <div><Typography id="instances-title" component="h2" variant="h5">Экземпляры</Typography><Typography color="text.secondary">Текущее состояние и история каждого экземпляра</Typography></div>
      <div><span>Стоимость ремонтов</span><strong>{formatRubles(totalRepairCost)}</strong></div>
    </div>
    <div className="manager-instance-list">
      {props.product.instances.map((instance) => <InstanceCard
        key={instance.id}
        instance={instance}
        onAction={() => props.onAction(instance)}
      />)}
      {props.product.instances.length === 0 ? <Paper variant="outlined" className="manager-empty"><Typography>У товара пока нет экземпляров.</Typography></Paper> : null}
    </div>
  </section>;
}

function InstanceCard(props: { instance: ManagerInstance; onAction: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const actionable = props.instance.status === "AVAILABLE" || props.instance.status === "MAINTENANCE";
  return <Paper variant="outlined" className={`manager-instance-card${expanded ? " is-expanded" : ""}`}>
    <button className="manager-instance-toggle" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
      <span className="manager-instance-identity"><span className="manager-instance-icon"><BoxIcon /></span><span><strong>{props.instance.inventory_number}</strong><small>{props.instance.created_at ? `Добавлен ${formatDate(props.instance.created_at)}` : "Экземпляр товара"}</small></span></span>
      <span className={`manager-instance-status manager-instance-status--${props.instance.status.toLowerCase()}`}>{instanceStatusLabel(props.instance.status)}</span>
      <span className="manager-instance-metric"><span>История</span><strong>{historySummary(props.instance)}</strong></span>
      <span className={`manager-instance-chevron${expanded ? " is-open" : ""}`}><ChevronDownIcon /></span>
    </button>
    {expanded ? <div className="manager-instance-content">
      {actionable ? <div className="manager-instance-actions"><Button variant="contained" color={props.instance.status === "MAINTENANCE" ? "warning" : "primary"} startIcon={<ToolIcon />} onClick={props.onAction}>{props.instance.status === "MAINTENANCE" ? "Завершить обслуживание" : "Отправить на обслуживание"}</Button></div> : null}
      <div className="manager-instance-stats"><div><span>Повреждения</span><strong>{props.instance.history.filter((item) => item.kind === "DAMAGE").length}</strong></div><div><span>Обслуживания</span><strong>{props.instance.history.filter((item) => item.kind === "MAINTENANCE").length}</strong></div><div><span>Стоимость ремонтов</span><strong>{formatRubles(Number(props.instance.repair_total))}</strong></div></div>
      <InstanceTimeline history={props.instance.history} />
    </div> : null}
  </Paper>;
}

function InstanceTimeline({ history }: { history: InstanceHistory[] }) {
  const [photoAct, setPhotoAct] = useState<InstanceHistory | null>(null);
  if (!history.length) return <Typography className="manager-instance-empty">Повреждений и обслуживаний пока нет.</Typography>;
  return <div className="manager-timeline">{history.map((item) => <article className={`manager-timeline-item manager-timeline-item--${item.kind.toLowerCase()}`} key={`${item.kind}-${item.id}`}>
    <span className="manager-timeline-dot" aria-hidden="true">{item.kind === "MAINTENANCE" ? <ToolIcon /> : "!"}</span>
    <div className="manager-timeline-card">
      <div className="manager-timeline-title"><div><Typography component="h3" variant="h6">{item.kind === "MAINTENANCE" ? item.reason : "Повреждение при возврате"}</Typography><small>{formatDate(item.occurred_at)}</small></div>{item.repair_cost !== undefined ? <strong>{item.repair_cost === null ? "В работе" : formatRubles(Number(item.repair_cost))}</strong> : <Chip size="small" color="error" variant="outlined" label="После возврата" />}</div>
      <p>{item.damage_description}</p>
      {item.kind === "DAMAGE" && item.damage_amount ? <small>Возврат аренды · расчёт повреждения {formatRubles(Number(item.damage_amount))}</small> : null}
      {item.kind === "MAINTENANCE" && item.source_return_id ? <small>После возврата аренды · акт №{item.source_return_id}</small> : null}
      {item.kind === "MAINTENANCE" ? <PhotoActEntry history={item} onOpen={() => setPhotoAct(item)} /> : null}
    </div>
  </article>)}
    {photoAct ? <PhotoCarousel history={photoAct} onClose={() => setPhotoAct(null)} /> : null}
  </div>;
}

function PhotoActEntry(props: { history: InstanceHistory; onOpen: () => void }) {
  if (!props.history.photos.length) return <div className="manager-photo-empty"><SadImageIcon /><span><strong>Фотоакт не проводился</strong><small>Для этого обслуживания фотографий нет</small></span></div>;
  return <button className="manager-photo-reel" onClick={props.onOpen} aria-label={`Открыть фотоакт обслуживания от ${formatDate(props.history.occurred_at)}`}>
    {props.history.photos.slice(0, 3).map((photo, index) => <img key={photo.id} src={photo.url} alt={`Состояние экземпляра после ремонта, фото ${index + 1}`} width="180" height="120" loading="lazy" />)}
    {props.history.photos.length > 3 ? <span>+{props.history.photos.length - 3} фото</span> : null}
  </button>;
}

function PhotoCarousel(props: { history: InstanceHistory; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const photos = props.history.photos;
  function move(delta: number): void {
    setIndex((current) => (current + delta + photos.length) % photos.length);
  }
  return <Dialog open onClose={props.onClose} fullWidth maxWidth="md" aria-labelledby="photo-carousel-title" onKeyDown={(event) => {
    if (event.key === "ArrowLeft" && photos.length) move(-1);
    if (event.key === "ArrowRight" && photos.length) move(1);
  }}>
    <DialogTitle id="photo-carousel-title" className="maintenance-dialog-title">Фотоакт обслуживания<Button className="maintenance-close" onClick={props.onClose} aria-label="Закрыть фотоакт"><CloseIcon /></Button></DialogTitle>
    <DialogContent className="manager-carousel">
      {photos[index] ? <img src={photos[index].url} alt={`Состояние экземпляра после ремонта, фото ${index + 1} из ${photos.length}`} width="900" height="600" /> : null}
      <div className="manager-carousel-caption">
        <strong>{props.history.damage_description}</strong>
        <span>{formatDate(props.history.occurred_at)}</span>
      </div>
      {photos.length > 1 ? <div className="manager-carousel-thumbnails" aria-label="Миниатюры фотоакта">
        {photos.map((photo, photoIndex) => <button
          className={photoIndex === index ? "is-active" : ""}
          key={photo.id}
          onClick={() => setIndex(photoIndex)}
          aria-label={`Показать фото ${photoIndex + 1}`}
          aria-pressed={photoIndex === index}
        >
          <img src={photo.url} alt="" width="96" height="64" />
        </button>)}
      </div> : null}
      <div className="manager-carousel-controls"><Button onClick={() => move(-1)} disabled={photos.length < 2} startIcon={<ArrowLeftIcon />}>Предыдущее фото</Button><span>{index + 1} из {photos.length}</span><Button onClick={() => move(1)} disabled={photos.length < 2} endIcon={<ArrowRightIcon />}>Следующее фото</Button></div>
    </DialogContent>
  </Dialog>;
}

function countInstanceStatuses(instances: ManagerInstance[]): Record<ManagerInstance["status"], number> {
  const counts = { AVAILABLE: 0, RESERVED: 0, PICKUP_IN_PROGRESS: 0, RENTED: 0, RETURN_INSPECTION: 0, MAINTENANCE: 0, DELETED: 0 };
  instances.forEach((instance) => { counts[instance.status] += 1; });
  return counts;
}

function historySummary(instance: ManagerInstance): string {
  if (!instance.history_count) return "Без повреждений";
  return `${instance.history_count} ${pluralize(instance.history_count, "запись", "записи", "записей")} · ${formatRubles(Number(instance.repair_total))}`;
}

function pluralize(value: number, one: string, few: string, many: string): string {
  const mod100 = value % 100;
  const mod10 = value % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

function productStatusLabel(status: ManagerProduct["status"]): string {
  const labels: Record<ManagerProduct["status"], string> = { DRAFT: "Черновик", PUBLISHED: "Опубликован", FROZEN: "Заморожен", ON_MODERATION: "На модерации", REJECTED: "Отклонён", HIDDEN_BY_ADMIN: "Скрыт" };
  return labels[status];
}

const rubleFormatter = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", minimumFractionDigits: 0, maximumFractionDigits: 2 });
function formatRubles(value: number): string { return rubleFormatter.format(value); }
function formatDate(value: string): string { return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Moscow" }).format(new Date(value)); }
