import { Alert, Button, Chip, CircularProgress, Container, Paper, TextField, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link as RouterLink, NavLink, Outlet, useLocation } from "react-router-dom";

import { getOwnProducts, OWN_PRODUCTS_KEY, type ManagerProduct } from "../api/manager";
import { formatRate } from "../catalog/formatting";
import { ImageIcon } from "../ui/Icons";
import "./manager.css";

export function ManagerLayout() {
  const location = useLocation();
  return <Container maxWidth={false} className="manager-layout">
    <nav className="manager-sidebar" aria-label="Кабинет менеджера">
      <span className="manager-sidebar__caption">Управление</span>
      <NavLink to="/account" end>Обзор</NavLink>
      <NavLink to="/manager/products">Мои товары</NavLink>
      <NavLink to="/manager/archive">Архив</NavLink>
      <p>Здесь вы управляете только своим каталогом. Заявки и аналитика появятся позже.</p>
    </nav>
    <div className="manager-main" key={location.pathname}><Outlet /></div>
  </Container>;
}

export function ManagerListPage({ section }: { section: "overview" | "products" | "archive" }) {
  const query = useQuery({ queryKey: OWN_PRODUCTS_KEY, queryFn: getOwnProducts });
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  if (query.isPending) return <div className="manager-state" role="status"><CircularProgress /> Загрузка товаров…</div>;
  if (query.isError) return <Alert severity="error" action={<Button onClick={() => query.refetch()}>Повторить</Button>}>Не удалось загрузить ваши товары.</Alert>;
  const products = query.data;
  const archive = products.filter((product) => product.status === "FROZEN");
  const active = products.filter((product) => product.status !== "FROZEN");
  const visible = (section === "archive" ? archive : active).filter((product) =>
    (section !== "products" || filter === "all" || product.status === filter) &&
    product.name.toLocaleLowerCase("ru").includes(search.toLocaleLowerCase("ru")),
  );
  const title = { overview: "Кабинет менеджера", products: "Мои товары", archive: "Архив товаров" }[section];
  return <>
    <div className="manager-head"><div><Typography variant="h3" component="h1">{title}</Typography>
      <Typography color="text.secondary">{section === "overview" ? "Короткая сводка по вашим товарам" : section === "archive" ? "Замороженные карточки вашего каталога" : "Создавайте карточки и управляйте собственными экземплярами"}</Typography></div>
      {section === "archive" ? <Button component={RouterLink} to="/manager/products" variant="outlined">К активным товарам</Button> :
        <Button component={RouterLink} to="/manager/products/new" variant="contained">+ Добавить товар</Button>}
    </div>
    {section === "overview" ? <div className="manager-stats">
      {[["Всего товаров", products.length], ["Опубликовано", products.filter((item) => item.status === "PUBLISHED").length], ["Черновики", products.filter((item) => item.status === "DRAFT").length], ["В архиве", archive.length]].map(([label, count]) =>
        <Paper key={label} variant="outlined" className="manager-stat"><span>{label}</span><strong>{count}</strong></Paper>)}
    </div> : null}
    {section === "products" ? <div className="manager-filters">
      {[["all", `Все активные · ${active.length}`], ["PUBLISHED", `Опубликованы · ${active.filter((item) => item.status === "PUBLISHED").length}`], ["DRAFT", `Черновики · ${active.filter((item) => item.status === "DRAFT").length}`]].map(([value, label]) =>
        <Button key={value} variant={filter === value ? "contained" : "outlined"} onClick={() => setFilter(value)}>{label}</Button>)}
      <Button component={RouterLink} to="/manager/archive" variant="outlined">Архив · {archive.length}</Button>
      <TextField name="manager-product-search" size="small" label="Поиск по своим товарам" value={search} onChange={(event) => setSearch(event.target.value)} />
    </div> : null}
    {section === "archive" ? <Alert severity="info" sx={{ mb: 2 }}>Замороженный товар не виден в общем каталоге. Его карточка доступна в отдельном архиве публичного профиля.</Alert> : null}
    <Paper variant="outlined" className="manager-surface">
      {section === "overview" ? <div className="manager-surface__head"><Typography variant="h6">Продолжить работу</Typography><Button component={RouterLink} to="/manager/products">Все товары →</Button></div> : null}
      {visible.length ? <div className="manager-table-wrap"><table className="manager-table"><thead><tr><th>Товар</th><th>Статус</th><th>Ставка</th><th>Экземпляры</th><th>Действие</th></tr></thead><tbody>
        {visible.map((product) => <ProductRow product={product} key={product.id} />)}
      </tbody></table></div> : <div className="manager-empty"><Typography variant="h6">{search || filter !== "all" ? "Ничего не найдено" : section === "archive" ? "Архив пока пуст" : "Товаров пока нет"}</Typography><Typography color="text.secondary">{section === "archive" ? "Здесь появятся замороженные товары." : "Добавьте первый товар, чтобы начать работу с каталогом."}</Typography></div>}
    </Paper>
    {section === "overview" ? <Alert severity="info" sx={{ mt: 2 }}>После публикации товар появляется в каталоге автоматически. Приём заявок пока недоступен.</Alert> : null}
  </>;
}

function ProductRow({ product }: { product: ManagerProduct }) {
  const labels: Record<ManagerProduct["status"], string> = {
    DRAFT: "Черновик", PUBLISHED: "Опубликован", FROZEN: "Заморожен",
    ON_MODERATION: "На модерации", REJECTED: "Отклонён", HIDDEN_BY_ADMIN: "Скрыт",
  };
  return <tr><td data-label="Товар"><div className="manager-product-cell">
    <div className="manager-thumb">{product.photos[0] ? <img src={product.photos.find((photo) => photo.is_primary)?.url ?? product.photos[0].url} alt="" width="56" height="56" loading="lazy" /> : <ImageIcon width="28" height="28" />}</div>
    <div><strong>{product.name}</strong><small>{product.category_name}{product.pickup_point ? ` · ${product.pickup_point.city}, ${product.pickup_point.district}` : ""}</small></div></div></td>
    <td data-label="Статус"><Chip size="small" color={product.status === "PUBLISHED" ? "success" : "default"} label={labels[product.status]} /></td>
    <td data-label="Ставка">{formatRate(product.minute_rate)} ₽/мин</td>
    <td data-label="Экземпляры">{product.instances.length} всего · {product.available_instances_count} свободно</td>
    <td data-label="Действие">{product.status === "FROZEN" ? <Button component={RouterLink} to={`/manager/products/${product.id}/basic`}>Просмотр</Button> :
      <Button component={RouterLink} to={`/manager/products/${product.id}/basic`} aria-label={`Редактировать ${product.name}`}>{product.status === "DRAFT" ? "Продолжить" : "Редактировать"}</Button>}</td></tr>;
}
