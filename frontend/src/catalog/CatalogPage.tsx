import { Box, Container, Stack, Typography } from "@mui/material";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";

import { getProducts, type PaginatedProducts } from "../api/catalog";
import { CatalogEmpty, CatalogError, CatalogLoading } from "./CatalogState";
import { ProductGrid } from "./ProductGrid";

export function CatalogPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const page = readPage(searchParams.get("page"));
  const productsQuery = useQuery({
    queryKey: ["catalog", "products", page],
    queryFn: () => getProducts(page),
    staleTime: 60_000,
  });

  function changePage(nextPage: number): void {
    setSearchParams(nextPage === 1 ? {} : { page: String(nextPage) });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <Container maxWidth="lg" className="catalog-page">
      <Stack className="catalog-heading" spacing={1}>
        <Typography component="p" className="page-eyebrow">
          Оборудование рядом
        </Typography>
        <Typography component="h1" variant="h2">
          Каталог оборудования
        </Typography>
        <Typography color="text.secondary" className="catalog-intro">
          Выберите подходящую модель, проверьте свободные экземпляры и точку
          самовывоза.
        </Typography>
      </Stack>
      <Box sx={{ mt: { xs: 4, md: 6 } }}>
        <CatalogContent
          query={productsQuery}
          page={page}
          onPageChange={changePage}
        />
      </Box>
    </Container>
  );
}

interface CatalogContentProps {
  query: UseQueryResult<PaginatedProducts, Error>;
  page: number;
  onPageChange: (page: number) => void;
}

function CatalogContent({ query, page, onPageChange }: CatalogContentProps) {
  if (query.isPending) {
    return <CatalogLoading label="Загрузка каталога…" />;
  }
  if (query.isError) {
    return (
      <CatalogError
        message="Не удалось загрузить каталог."
        onRetry={() => query.refetch()}
      />
    );
  }
  if (query.data.results.length === 0) {
    return (
      <CatalogEmpty
        title="Каталог пока пуст"
        description="Опубликованные товары появятся здесь."
      />
    );
  }
  return (
    <ProductGrid
      products={query.data}
      page={page}
      onPageChange={onPageChange}
    />
  );
}

function readPage(value: string | null): number {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}
