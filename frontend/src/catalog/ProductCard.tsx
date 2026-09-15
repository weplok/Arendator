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
}

export function ProductCard({ product }: ProductCardProps) {
  return (
    <Card className="product-card" elevation={0}>
      <ProductImage product={product} />
      <CardContent className="product-card__content">
        <Stack spacing={1.5} sx={{ height: "100%" }}>
          <Typography className="product-card__category">
            {product.category.name}
          </Typography>
          <Typography component="h2" variant="h6">
            <Link
              component={RouterLink}
              to={`/products/${product.id}`}
              className="product-card__title"
              underline="none"
            >
              {product.name}
            </Link>
          </Typography>
          <ManagerLink product={product} />
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
      </CardContent>
    </Card>
  );
}

function ProductImage({ product }: ProductCardProps) {
  return (
    <RouterLink
      to={`/products/${product.id}`}
      className="product-card__image-link"
      aria-label={`Открыть товар «${product.name}»`}
    >
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
    </RouterLink>
  );
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

function AvailabilityLabel({ product }: ProductCardProps) {
  if (product.status === "FROZEN") {
    return <Chip label="В архиве" className="availability availability--archived" />;
  }
  if (product.available_instances_count === 0) {
    return (
      <Chip
        label="Сейчас нет доступных экземпляров"
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
