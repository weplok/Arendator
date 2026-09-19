import {
  Avatar,
  Box,
  Card,
  CardContent,
  Chip,
  Link,
  Stack,
  Typography,
} from "@mui/material";
import { Link as RouterLink } from "react-router-dom";

import type { ProductSummary } from "../api/catalog";
import { ImageIcon, LocationIcon } from "../ui/Icons";
import { formatRate } from "./formatting";

interface ProductCardProps {
  product: ProductSummary;
  variant?: "catalog" | "profile";
}

export function ProductCard({ product, variant = "profile" }: ProductCardProps) {
  if (variant === "catalog") {
    return (
      <Card
        component={RouterLink}
        to={`/products/${product.id}`}
        aria-label={product.name}
        className="product-card product-card--clickable"
        elevation={0}
      >
        <ProductImage product={product} linked={false} />
        <CardContent className="product-card__content">
          <CatalogCardContent product={product} />
        </CardContent>
      </Card>
    );
  }
  return (
    <Card className="product-card" elevation={0}>
      <ProductImage product={product} />
      <CardContent className="product-card__content">
        <ProfileCardContent product={product} />
      </CardContent>
    </Card>
  );
}

function ProductTitle({ product, linked = true }: ProductCardProps & { linked?: boolean }) {
  return (
    <Typography component="h2" variant="h6" className={linked ? undefined : "product-card__title"}>
      {linked ? <Link
        component={RouterLink}
        to={`/products/${product.id}`}
        className="product-card__title"
        underline="none"
      >
        {product.name}
      </Link> : product.name}
    </Typography>
  );
}

function ProductLocation({ product }: ProductCardProps) {
  return (
    <Stack
      direction="row"
      spacing={0.75}
      sx={{ alignItems: "center", color: "text.secondary" }}
    >
      <LocationIcon width="18" height="18" />
      <Typography variant="body2">
        {product.pickup_point.city} · {product.pickup_point.district}
      </Typography>
    </Stack>
  );
}

function CatalogCardContent({ product }: ProductCardProps) {
  return (
    <Stack spacing={0.75} sx={{ height: "100%" }}>
      <ProductTitle product={product} linked={false} />
      <Typography className="product-card__rate">
        {formatRate(product.minute_rate)} ₽/мин
      </Typography>
      <ProductLocation product={product} />
      <Box sx={{ flexGrow: 1 }} />
      <Stack className="product-card__footer" direction="row">
        <AvailabilityLabel product={product} variant="catalog" />
        <ManagerIdentity product={product} />
      </Stack>
    </Stack>
  );
}

function ProfileCardContent({ product }: ProductCardProps) {
  return (
    <Stack spacing={1.5} sx={{ height: "100%" }}>
      <Typography className="product-card__category">
        {product.category.name}
      </Typography>
      <ProductTitle product={product} />
      <ManagerLink product={product} />
      <ProductLocation product={product} />
      <Box sx={{ flexGrow: 1 }} />
      <Stack
        direction="row"
        sx={{
          alignItems: "flex-end",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 1,
        }}
      >
        <Box>
          <Typography className="product-card__rate">
            {formatRate(product.minute_rate)} ₽
          </Typography>
          <Typography variant="caption" color="text.secondary">
            за минуту
          </Typography>
        </Box>
        <AvailabilityLabel product={product} />
      </Stack>
    </Stack>
  );
}

function ProductImage({ product, linked = true }: ProductCardProps & { linked?: boolean }) {
  const image = (
    <>
      {product.primary_photo ? (
        <img
          className="product-card__image"
          src={product.primary_photo.url}
          alt=""
          width="800"
          height="600"
          loading="lazy"
        />
      ) : (
        <Box className="product-image-placeholder">
          <ImageIcon width="42" height="42" />
          <Typography variant="body2">Фотография не добавлена</Typography>
        </Box>
      )}
    </>
  );
  if (!linked) return <Box className="product-card__image-link">{image}</Box>;
  return <RouterLink to={`/products/${product.id}`} className="product-card__image-link" aria-label={`Открыть товар «${product.name}»`}>{image}</RouterLink>;
}

function ManagerIdentity({ product }: ProductCardProps) {
  return <Box component="span" className="manager-link">
    <Avatar src={product.manager.avatar ?? undefined} alt="" sx={{ width: 24, height: 24 }}>
      {product.manager.name.slice(0, 1)}
    </Avatar>
    {product.manager.name}
  </Box>;
}

function ManagerLink({ product }: ProductCardProps) {
  return (
    <Link
      component={RouterLink}
      to={`/managers/${product.manager.id}`}
      underline="hover"
      className="manager-link"
    >
      <Avatar src={product.manager.avatar ?? undefined} alt="" sx={{ width: 24, height: 24 }}>
        {product.manager.name.slice(0, 1)}
      </Avatar>
      {product.manager.name}
    </Link>
  );
}

function AvailabilityLabel({ product, variant = "profile" }: ProductCardProps) {
  if (product.status === "FROZEN") {
    return <Chip label="В архиве" className="availability availability--archived" />;
  }
  if (product.available_instances_count === 0) {
    return (
      <Chip
        label={variant === "catalog" ? "Сейчас нет свободных экземпляров" : "Сейчас нет доступных экземпляров"}
        className="availability availability--empty"
      />
    );
  }
  return (
    <Chip
      label={`Свободно: ${product.available_instances_count}`}
      className="availability availability--available"
    />
  );
}
