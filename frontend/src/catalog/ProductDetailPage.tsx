import {
  Alert,
  Avatar,
  Box,
  Breadcrumbs,
  Button,
  Chip,
  Container,
  Divider,
  Link,
  Paper,
  Snackbar,
  Stack,
  Typography,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link as RouterLink, useLocation, useParams } from "react-router-dom";

import { getProduct, type ProductDetail } from "../api/catalog";
import type { CurrentUser } from "../api/auth";
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
  const [noticeOpen, setNoticeOpen] = useState(false);

  return (
    <Container maxWidth="lg" className="product-page">
      <Breadcrumbs aria-label="Навигационная цепочка" sx={{ mb: 3 }}>
        <Link component={RouterLink} to="/" color="inherit">
          Каталог
        </Link>
        <Typography color="text.primary">{product.name}</Typography>
      </Breadcrumbs>
      {product.status === "FROZEN" ? (
        <Alert severity="info" className="archive-alert">
          Товар находится в архиве. Новые заявки не принимаются.
        </Alert>
      ) : null}
      <Box className="product-hero">
        <ProductGallery photos={product.photos} productName={product.name} />
        <Paper className="product-summary" elevation={0}>
          <Stack spacing={2.5}>
            <Typography className="page-eyebrow">{product.category.name}</Typography>
            <Typography component="h1" variant="h3">
              {product.name}
            </Typography>
            <ProductAvailability product={product} />
            <Box>
              <Typography className="product-summary__rate">
                {formatRate(product.minute_rate)} ₽
              </Typography>
              <Typography color="text.secondary">за минуту аренды</Typography>
            </Box>
            <Divider />
            <PickupPoint product={product} user={user} />
            <ManagerSummary product={product} />
            <RequestAction
              product={product}
              user={user}
              onPreview={() => setNoticeOpen(true)}
            />
          </Stack>
        </Paper>
      </Box>
      <Box className="product-details-grid">
        <section aria-labelledby="description-heading">
          <Typography id="description-heading" component="h2" variant="h4">
            Описание
          </Typography>
          <Typography className="product-description">
            {product.description || "Описание пока не добавлено."}
          </Typography>
        </section>
        <CharacteristicsPlaceholder />
      </Box>
      <Snackbar
        open={noticeOpen}
        autoHideDuration={5000}
        onClose={() => setNoticeOpen(false)}
        message="Форма заявки будет подключена на следующем этапе."
      />
    </Container>
  );
}

function ProductAvailability({ product }: { product: ProductDetail }) {
  if (product.status === "FROZEN") {
    return <Chip label="В архиве" className="availability availability--archived" />;
  }
  if (product.available_instances_count === 0) {
    return <Chip label="Сейчас нет доступных экземпляров" className="availability availability--empty" />;
  }
  return <Chip label={`Свободно: ${product.available_instances_count}`} className="availability availability--available" />;
}

function PickupPoint({ product, user }: ProductDetailContentProps) {
  const pickup = product.pickup_point;
  return (
    <Stack spacing={1.25}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <LocationIcon />
        <Typography component="h2" variant="h6">Точка самовывоза</Typography>
      </Stack>
      <Typography>{pickup.city} · {pickup.district}</Typography>
      {user && pickup.full_address ? (
        <>
          <Typography color="text.secondary">{pickup.full_address}</Typography>
          {pickup.yandex_maps_url ? (
            <Button
              component="a"
              href={pickup.yandex_maps_url}
              target="_blank"
              rel="noreferrer"
              variant="outlined"
              endIcon={<LaunchIcon />}
            >
              Открыть в Яндекс.Картах
            </Button>
          ) : null}
        </>
      ) : (
        <Typography className="private-address-note">
          Точный адрес доступен после входа
        </Typography>
      )}
    </Stack>
  );
}

function ManagerSummary({ product }: { product: ProductDetail }) {
  return (
    <Link component={RouterLink} to={`/managers/${product.manager.id}`} underline="none" className="manager-summary">
      <Avatar src={product.manager.avatar ?? undefined} alt="">
        {product.manager.name.slice(0, 1)}
      </Avatar>
      <Box>
        <Typography variant="caption" color="text.secondary">Менеджер</Typography>
        <Typography sx={{ fontWeight: 700 }}>{product.manager.name}</Typography>
      </Box>
    </Link>
  );
}

interface RequestActionProps extends ProductDetailContentProps {
  onPreview: () => void;
}

function RequestAction({ product, user, onPreview }: RequestActionProps) {
  const location = useLocation();
  if (product.status === "FROZEN") {
    return <Button variant="contained" disabled>Товар в архиве</Button>;
  }
  if (!user) {
    const next = encodeURIComponent(`${location.pathname}${location.search}`);
    return (
      <Button component={RouterLink} to={`/login?next=${next}`} variant="contained">
        Войти, чтобы оставить заявку
      </Button>
    );
  }
  if (user.role !== "RENTER") {
    return <Button variant="contained" disabled>Заявки доступны арендаторам</Button>;
  }
  return <Button variant="contained" onClick={onPreview}>Оставить заявку</Button>;
}

function CharacteristicsPlaceholder() {
  return (
    <section aria-labelledby="characteristics-heading">
      <Typography id="characteristics-heading" component="h2" variant="h4">
        Характеристики
      </Typography>
      <Paper className="characteristics-placeholder" elevation={0}>
        <Typography sx={{ fontWeight: 700 }}>
          Блок подготовлен для характеристик категории
        </Typography>
        <Typography color="text.secondary">
          Здесь появятся параметры товара после подключения динамических характеристик.
        </Typography>
        {[1, 2, 3].map((item) => (
          <Box className="placeholder-row" key={item} aria-hidden="true">
            <span />
            <span />
          </Box>
        ))}
      </Paper>
    </section>
  );
}
