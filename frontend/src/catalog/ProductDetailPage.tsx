import {
  Alert,
  Avatar,
  Box,
  Breadcrumbs,
  Button,
  Container,
  Link,
  Paper,
  Typography,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { Link as RouterLink, useParams } from "react-router-dom";

import type { CurrentUser } from "../api/auth";
import { getProduct, type ProductDetail } from "../api/catalog";
import { LaunchIcon, LocationIcon } from "../ui/Icons";
import { CatalogError, CatalogLoading } from "./CatalogState";
import { formatRate } from "./formatting";
import { ProductGallery } from "./ProductGallery";

interface ProductDetailPageProps {
  user: CurrentUser | null;
}

export function ProductDetailPage({ user }: ProductDetailPageProps) {
  const productId = Number(useParams().productId);
  const productQuery = useQuery({
    queryKey: ["catalog", "product", productId],
    queryFn: () => getProduct(productId),
    enabled: Number.isInteger(productId) && productId > 0,
  });

  if (productQuery.isPending) {
    return <CatalogLoading label="Загрузка товара…" />;
  }
  if (productQuery.isError) {
    return (
      <CatalogError
        message="Не удалось загрузить карточку товара."
        onRetry={() => productQuery.refetch()}
      />
    );
  }
  return <ProductDetailContent product={productQuery.data} user={user} />;
}

interface ProductDetailContentProps {
  product: ProductDetail;
  user: CurrentUser | null;
}

function ProductDetailContent({ product, user }: ProductDetailContentProps) {
  return (
    <Container maxWidth="lg" className="product-page">
      <Breadcrumbs aria-label="Навигационная цепочка" className="product-breadcrumbs">
        <Link component={RouterLink} to="/" color="inherit">Каталог</Link>
        <Typography color="text.secondary">{product.category.name}</Typography>
        <Typography color="text.primary">{product.name}</Typography>
      </Breadcrumbs>
      {product.status === "FROZEN" ? (
        <Alert severity="info" className="archive-alert">
          Товар находится в архиве. Новые заявки не принимаются.
        </Alert>
      ) : null}
      <Box className="product-layout">
        <div className="product-content">
          <Typography component="h1" className="product-title">{product.name}</Typography>
          <ProductGallery photos={product.photos} productName={product.name} />
          <PickupPoint product={product} user={user} />
          <Characteristics />
          <Paper component="section" className="product-information" elevation={0}>
            <Typography component="h2" variant="h6">Описание</Typography>
            <Typography className="product-description">
              {product.description || "Описание пока не добавлено."}
            </Typography>
          </Paper>
          <div className="product-mobile-manager">
            <ManagerSummary product={product} />
            <ProductAvailability product={product} />
          </div>
        </div>
        <Paper component="aside" className="product-summary" elevation={0}>
          <div className="product-summary__action">
            <Rate product={product} />
            <RequestAction product={product} user={user} />
          </div>
          <div className="product-summary__seller">
            <ManagerSummary product={product} />
            <ProductAvailability product={product} />
          </div>
        </Paper>
      </Box>
      <div className="product-mobile-action">
        <Rate product={product} />
        <RequestAction product={product} user={user} />
      </div>
    </Container>
  );
}

function Rate({ product }: { product: ProductDetail }) {
  return <Typography className="product-summary__rate">{formatRate(product.minute_rate)} ₽/мин</Typography>;
}

function ProductAvailability({ product }: { product: ProductDetail }) {
  const archived = product.status === "FROZEN";
  const available = product.available_instances_count > 0 && !archived;
  const label = archived
    ? "В архиве"
    : available
      ? `Свободно: ${product.available_instances_count}`
      : "Сейчас нет свободных экземпляров";
  return (
    <span className={`availability ${available ? "availability--available" : "availability--empty"}`}>
      {label}
    </span>
  );
}

function PickupPoint({ product, user }: ProductDetailContentProps) {
  const pickup = product.pickup_point;
  return (
    <Paper component="section" className="product-information pickup-point" elevation={0}>
      <Typography component="h2" variant="h6">Точка самовывоза</Typography>
      <div className="pickup-point__location">
        <LocationIcon />
        <Typography>{pickup.city} · {pickup.district}</Typography>
      </div>
      {user && pickup.full_address ? (
        <div className="pickup-point__address">
          <Typography color="text.secondary">{pickup.full_address}</Typography>
          {pickup.yandex_maps_url ? (
            <Button
              component="a"
              href={pickup.yandex_maps_url}
              target="_blank"
              rel="noopener noreferrer"
              endIcon={<LaunchIcon />}
            >
              Открыть в Яндекс.Картах
            </Button>
          ) : null}
        </div>
      ) : (
        <Typography color="text.secondary">Точный адрес доступен после входа</Typography>
      )}
    </Paper>
  );
}

function Characteristics() {
  return (
    <Paper component="section" className="product-information" elevation={0}>
      <Typography component="h2" variant="h6">Характеристики</Typography>
      <table className="product-characteristics">
        <thead><tr><th scope="col">Параметр</th><th scope="col">Значение</th></tr></thead>
        <tbody><tr><td colSpan={2}>Характеристики пока недоступны</td></tr></tbody>
      </table>
    </Paper>
  );
}

function ManagerSummary({ product }: { product: ProductDetail }) {
  return (
    <Link
      component={RouterLink}
      to={`/managers/${product.manager.id}`}
      underline="none"
      className="manager-summary"
    >
      <Avatar src={product.manager.avatar ?? undefined} alt="">
        {product.manager.name.slice(0, 1)}
      </Avatar>
      <Box>
        <Typography variant="caption" color="text.secondary">Менеджер</Typography>
        <Typography className="manager-summary__name">{product.manager.name}</Typography>
      </Box>
    </Link>
  );
}

function RequestAction({ product, user }: ProductDetailContentProps) {
  if (product.status === "FROZEN") {
    return <Typography color="text.secondary">Новые заявки не принимаются</Typography>;
  }
  if (user && user.role !== "RENTER") {
    return <Typography color="text.secondary">Заявки доступны арендаторам</Typography>;
  }
  return (
    <div className="product-request-unavailable">
      <Button variant="contained" disabled>Подать заявку</Button>
      <Typography variant="caption" color="text.secondary">
        Подача заявки пока недоступна
      </Typography>
    </div>
  );
}
