import {
  Box,
  Container,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Typography,
  type SelectChangeEvent,
} from "@mui/material";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";

import {
  getProducts,
  type CatalogOrdering,
  type PaginatedProducts,
} from "../api/catalog";
import { CatalogEmpty, CatalogError, CatalogLoading } from "./CatalogState";
import { CatalogFilters } from "./CatalogFilters";
import { CatalogSearchForm } from "./CatalogSearchForm";
import { formatAdvertisementCount } from "./formatting";
import { ProductGrid } from "./ProductGrid";

const ORDERING_LABELS: Record<CatalogOrdering, string> = {
  newest: "Сначала новые",
  oldest: "Сначала старые",
  rate_asc: "Сначала дешевле",
  rate_desc: "Сначала дороже",
};

export function CatalogPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const page = readPage(searchParams.get("page"));
  const ordering = readOrdering(searchParams.get("ordering"));
  const requestParams = useMemo(
    () => buildRequestParams(searchParams, page, ordering),
    [ordering, page, searchParams],
  );
  const productsQuery = useQuery({
    queryKey: ["catalog", "products", requestParams.toString()],
    queryFn: () => getProducts(requestParams),
    staleTime: 60_000,
  });

  function changePage(nextPage: number): void {
    const nextParams = new URLSearchParams(searchParams);
    if (nextPage === 1) nextParams.delete("page");
    else nextParams.set("page", String(nextPage));
    setSearchParams(nextParams);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function changeOrdering(event: SelectChangeEvent): void {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("ordering", event.target.value);
    nextParams.delete("page");
    setSearchParams(nextParams);
  }

  return (
    <Container maxWidth="lg" className="catalog-page">
      <CatalogSearchForm className="catalog-search" />
      <Box className="catalog-layout">
        <CatalogFilters
          appliedParams={searchParams}
          onApply={(filters) => {
            setSearchParams(replaceCatalogFilters(searchParams, filters));
          }}
        />
        <section className="catalog-results" aria-label="Результаты каталога">
          <div className="catalog-results__toolbar">
            <Typography component="h1" variant="body1">
              {productsQuery.data
                ? `Найдено ${formatAdvertisementCount(productsQuery.data.count)}`
                : "Объявления"}
            </Typography>
            <FormControl size="small" className="catalog-sort">
              <InputLabel id="catalog-sort-label">Сортировка</InputLabel>
              <Select
                labelId="catalog-sort-label"
                label="Сортировка"
                value={ordering}
                onChange={changeOrdering}
              >
                {Object.entries(ORDERING_LABELS).map(([value, label]) => (
                  <MenuItem key={value} value={value}>
                    {label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </div>
          <CatalogContent
            query={productsQuery}
            page={page}
            hasCriteria={hasCatalogCriteria(searchParams)}
            onPageChange={changePage}
          />
        </section>
      </Box>
    </Container>
  );
}

interface CatalogContentProps {
  query: UseQueryResult<PaginatedProducts, Error>;
  page: number;
  hasCriteria: boolean;
  onPageChange: (page: number) => void;
}

function CatalogContent(props: CatalogContentProps) {
  if (props.query.isPending) {
    return <CatalogLoading label="Загрузка каталога…" />;
  }
  if (props.query.isError) {
    return (
      <CatalogError
        message="Не удалось загрузить каталог."
        onRetry={() => props.query.refetch()}
      />
    );
  }
  if (props.query.data.results.length === 0) {
    return props.hasCriteria ? (
      <CatalogEmpty
        title="Ничего не найдено"
        description="Измените поисковый запрос или фильтры и попробуйте снова."
      />
    ) : (
      <CatalogEmpty
        title="Каталог пока пуст"
        description="Опубликованные товары появятся здесь."
      />
    );
  }
  return (
    <ProductGrid
      products={props.query.data}
      page={props.page}
      onPageChange={props.onPageChange}
      variant="catalog"
    />
  );
}

function buildRequestParams(
  searchParams: URLSearchParams,
  page: number,
  ordering: CatalogOrdering,
): URLSearchParams {
  const params = new URLSearchParams(searchParams);
  params.set("page", String(page));
  params.set("ordering", ordering);
  return params;
}

function readPage(value: string | null): number {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function readOrdering(value: string | null): CatalogOrdering {
  return value && value in ORDERING_LABELS
    ? (value as CatalogOrdering)
    : "newest";
}

function hasCatalogCriteria(params: URLSearchParams): boolean {
  return [...params.keys()].some(
    (key) =>
      key === "search" ||
      key === "category" ||
      key === "price_min" ||
      key === "price_max" ||
      key.startsWith("characteristic_"),
  );
}

function replaceCatalogFilters(
  appliedParams: URLSearchParams,
  filters: URLSearchParams,
): URLSearchParams {
  const next = new URLSearchParams(appliedParams);
  for (const key of [...next.keys()]) {
    if (isFilterKey(key)) next.delete(key);
  }
  for (const [key, value] of filters) next.set(key, value);
  next.delete("page");
  return next;
}

function isFilterKey(key: string): boolean {
  return (
    key === "category" ||
    key === "price_min" ||
    key === "price_max" ||
    key.startsWith("characteristic_")
  );
}
