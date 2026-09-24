import {
  Alert,
  Button,
  Chip,
  CircularProgress,
  Container,
  Paper,
  TextField,
  Typography,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import {
  Link as RouterLink,
  NavLink,
  Outlet,
  useLocation,
  useSearchParams,
} from "react-router-dom";

import {
  getOwnProducts,
  OWN_PRODUCTS_KEY,
  type ManagerProduct,
} from "../api/manager";
import { formatRate } from "../catalog/formatting";
import { ImageIcon } from "../ui/Icons";
import "./manager.css";

type ManagerSection = "overview" | "products" | "rejected" | "archive";

export function ManagerLayout() {
  const location = useLocation();
  return <Container maxWidth={false} className="manager-layout">
    <nav className="manager-sidebar" aria-label="Кабинет менеджера">
      <span className="manager-sidebar__caption">Управление</span>
      <NavLink to="/account" end>Обзор</NavLink>
      <NavLink to="/manager/products">Мои товары</NavLink>
      <NavLink to="/manager/applications">Заявки</NavLink>
      <NavLink to="/manager/bookings">Брони</NavLink>
      <NavLink to="/manager/rejected">Отклонённые</NavLink>
      <NavLink to="/manager/archive">Архив</NavLink>
      <p>Здесь вы управляете только своим каталогом, заявками и бронями на свои товары.</p>
    </nav>
    <div className="manager-main" key={location.pathname}><Outlet /></div>
  </Container>;
}

export function ManagerListPage({ section }: { section: ManagerSection }) {
  const query = useQuery({ queryKey: OWN_PRODUCTS_KEY, queryFn: getOwnProducts });
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = searchParams.get("status") ?? "all";
  const search = searchParams.get("search") ?? "";
  if (query.isPending) return <div className="manager-state" role="status"><CircularProgress /> Загрузка товаров…</div>;
  if (query.isError) return <Alert severity="error" action={<Button onClick={() => query.refetch()}>Повторить</Button>}>Не удалось загрузить ваши товары.</Alert>;
  const products = query.data;
  const archive = products.filter((product) => product.status === "FROZEN");
  const rejected = products.filter((product) => product.status === "REJECTED");
  const active = products.filter((product) =>
    product.status !== "FROZEN" && product.status !== "REJECTED"
  );
  const sectionProducts = getSectionProducts(section, active, rejected, archive);
  const visible = sectionProducts.filter((product) =>
    (section !== "products" || filter === "all" || product.status === filter) &&
    product.name.toLocaleLowerCase("ru").includes(search.toLocaleLowerCase("ru"))
  );
  function updateSearchParam(name: string, value: string): void {
    const nextParams = new URLSearchParams(searchParams);
    if (value) nextParams.set(name, value);
    else nextParams.delete(name);
    setSearchParams(nextParams, { replace: true });
  }
  return <>
    <ManagerPageHeader section={section} />
    {section === "overview" ? <ManagerStats products={products} /> : null}
    {section === "products" ? <ProductFilters
      active={active}
      archiveCount={archive.length}
      filter={filter}
      rejectedCount={rejected.length}
      search={search}
      onFilterChange={(value) => updateSearchParam("status", value === "all" ? "" : value)}
      onSearchChange={(value) => updateSearchParam("search", value)}
    /> : null}
    {section === "archive" ? <Alert severity="info" sx={{ mb: 2 }}>Замороженный товар не виден в общем каталоге. Его карточка доступна в отдельном архиве публичного профиля.</Alert> : null}
    {section === "rejected" ? <Alert severity="warning" sx={{ mb: 2 }}>Откройте карточку, чтобы увидеть причину отклонения. После исправлений её можно отправить повторно без обязательных изменений.</Alert> : null}
    <ProductTable filter={filter} products={visible} search={search} section={section} />
    {section === "overview" ? <Alert severity="info" sx={{ mt: 2 }}>В каталог попадают только товары, одобренные модератором. Новые заявки доступны в отдельной очереди.</Alert> : null}
  </>;
}

function ManagerPageHeader({ section }: { section: ManagerSection }) {
  const titles: Record<ManagerSection, string> = {
    overview: "Кабинет менеджера",
    products: "Мои товары",
    rejected: "Отклонённые товары",
    archive: "Архив товаров",
  };
  const subtitles: Record<ManagerSection, string> = {
    overview: "Короткая сводка по вашим товарам",
    products: "Создавайте карточки и управляйте собственными экземплярами",
    rejected: "Исправьте замечания модератора или удалите неопубликованную карточку",
    archive: "Замороженные карточки вашего каталога",
  };
  const secondarySection = section === "archive" || section === "rejected";
  return <div className="manager-head"><div>
    <Typography variant="h3" component="h1">{titles[section]}</Typography>
    <Typography color="text.secondary">{subtitles[section]}</Typography>
  </div>{secondarySection
    ? <Button component={RouterLink} to="/manager/products" variant="outlined">К активным товарам</Button>
    : <Button component={RouterLink} to="/manager/products/new" variant="contained">+ Добавить товар</Button>}
  </div>;
}

function ManagerStats({ products }: { products: ManagerProduct[] }) {
  const stats = [
    ["Всего товаров", products.length, "total"],
    ["Опубликовано", countStatus(products, "PUBLISHED"), "published"],
    ["Черновики", countStatus(products, "DRAFT"), "draft"],
    ["В архиве", countStatus(products, "FROZEN"), "archived"],
  ];
  return <div className="manager-stats">{stats.map(([label, count, tone]) =>
    <Paper key={label} variant="outlined" className={`manager-stat manager-stat--${tone}`}>
      <span>{label}</span><strong>{count}</strong>
    </Paper>)}</div>;
}

interface ProductFiltersProps {
  active: ManagerProduct[];
  archiveCount: number;
  filter: string;
  rejectedCount: number;
  search: string;
  onFilterChange: (value: string) => void;
  onSearchChange: (value: string) => void;
}

function ProductFilters(props: ProductFiltersProps) {
  const filters = [
    ["all", `Все активные · ${props.active.length}`],
    ["PUBLISHED", `Опубликованы · ${countStatus(props.active, "PUBLISHED")}`],
    ["ON_MODERATION", `На модерации · ${countStatus(props.active, "ON_MODERATION")}`],
    ["DRAFT", `Черновики · ${countStatus(props.active, "DRAFT")}`],
  ];
  return <div className="manager-filters">
    {filters.map(([value, label]) => <Button
      key={value}
      variant={props.filter === value ? "contained" : "outlined"}
      onClick={() => props.onFilterChange(value)}
    >{label}</Button>)}
    <Button component={RouterLink} to="/manager/rejected" variant="outlined">Отклонённые · {props.rejectedCount}</Button>
    <Button component={RouterLink} to="/manager/archive" variant="outlined">Архив · {props.archiveCount}</Button>
    <TextField
      name="manager-product-search"
      autoComplete="off"
      size="small"
      label="Поиск по своим товарам"
      value={props.search}
      onChange={(event) => props.onSearchChange(event.target.value)}
    />
  </div>;
}

interface ProductTableProps {
  filter: string;
  products: ManagerProduct[];
  search: string;
  section: ManagerSection;
}

function ProductTable({ filter, products, search, section }: ProductTableProps) {
  return <Paper variant="outlined" className="manager-surface">
    {section === "overview" ? <div className="manager-surface__head"><Typography variant="h6">Продолжить работу</Typography><Button component={RouterLink} to="/manager/products">Все товары →</Button></div> : null}
    {products.length ? <div className="manager-table-wrap"><table className="manager-table"><thead><tr><th>Товар</th><th>Ставка</th><th>Экземпляры</th><th>Статус</th></tr></thead><tbody>
      {products.map((product) => <ProductRow product={product} key={product.id} />)}
    </tbody></table></div> : <div className="manager-empty">
      <Typography variant="h6">{emptyTitle(section, search, filter)}</Typography>
      <Typography color="text.secondary">{emptyDescription(section)}</Typography>
    </div>}
  </Paper>;
}

function ProductRow({ product }: { product: ManagerProduct }) {
  const labels: Record<ManagerProduct["status"], string> = {
    DRAFT: "Черновик", PUBLISHED: "Опубликован", FROZEN: "Заморожен",
    ON_MODERATION: "На модерации", REJECTED: "Отклонён", HIDDEN_BY_ADMIN: "Скрыт",
  };
  const totalInstances = product.instances.length;
  const availabilityTone = product.available_instances_count === 0
    ? "empty"
    : product.available_instances_count === totalInstances
      ? "full"
      : "partial";
  const editorPath = `/manager/products/${product.id}/basic`;
  const chipColor = product.status === "PUBLISHED"
    ? "success"
    : product.status === "REJECTED"
      ? "error"
      : product.status === "ON_MODERATION"
        ? "warning"
        : "default";
  return <tr className="manager-product-row"><td data-label="Товар"><RouterLink className="manager-row-link" to={editorPath} aria-label={`Открыть ${product.name}`}><div className="manager-product-cell">
    <div className="manager-thumb">{product.photos[0] ? <img src={product.photos.find((photo) => photo.is_primary)?.url ?? product.photos[0].url} alt="" width="56" height="56" loading="lazy" /> : <ImageIcon width="28" height="28" />}</div>
    <div><strong>{product.name}</strong><small>{product.category_name}{product.pickup_point ? ` · ${product.pickup_point.city}, ${product.pickup_point.district}` : ""}</small></div></div></RouterLink></td>
    <td data-label="Ставка">{formatRate(product.minute_rate)} ₽/мин</td>
    <td data-label="Экземпляры"><span className={`manager-instances manager-instances--${availabilityTone}`} aria-label={`${product.available_instances_count} свободно из ${totalInstances}`}>{product.available_instances_count}/{totalInstances}</span></td>
    <td data-label="Статус"><Chip size="small" color={chipColor} label={labels[product.status]} /></td></tr>;
}

function getSectionProducts(
  section: ManagerSection,
  active: ManagerProduct[],
  rejected: ManagerProduct[],
  archive: ManagerProduct[],
): ManagerProduct[] {
  if (section === "archive") return archive;
  if (section === "rejected") return rejected;
  return active;
}

function countStatus(
  products: ManagerProduct[],
  status: ManagerProduct["status"],
): number {
  return products.filter((product) => product.status === status).length;
}

function emptyTitle(section: ManagerSection, search: string, filter: string): string {
  if (search || filter !== "all") return "Ничего не найдено";
  if (section === "archive") return "Архив пока пуст";
  if (section === "rejected") return "Отклонённых карточек нет";
  return "Товаров пока нет";
}

function emptyDescription(section: ManagerSection): string {
  if (section === "archive") return "Здесь появятся замороженные товары.";
  if (section === "rejected") return "Здесь появятся карточки с замечаниями модератора.";
  return "Добавьте первый товар, чтобы начать работу с каталогом.";
}
