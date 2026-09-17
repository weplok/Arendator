import {
  Box,
  Button,
  Container,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";

import { getProducts, type PaginatedProducts } from "../api/catalog";
import { buildCategoryTree, getCategories, type CategoryNode } from "../api/categories";
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
      <header className="catalog-page__header">
        <Typography component="h1">Каталог оборудования</Typography>
        <Typography color="text.secondary">
          Найдите оборудование для работы, дома и важных проектов.
        </Typography>
        <TextField
          label="Поиск по названию"
          placeholder="Например, перфоратор"
          disabled
          helperText="Поиск появится позже"
          className="catalog-search"
        />
      </header>
      <Box className="catalog-layout">
        <CatalogFilters resultCount={productsQuery.data?.count} />
        <section className="catalog-results" aria-label="Результаты каталога">
          <div className="catalog-results__toolbar">
            <Typography component="h2" variant="body1">
              {productsQuery.data
                ? `Найдено объявлений: ${productsQuery.data.count}`
                : "Объявления"}
            </Typography>
            <FormControl size="small" className="catalog-sort" disabled>
              <InputLabel id="catalog-sort-label">Сортировка</InputLabel>
              <Select labelId="catalog-sort-label" label="Сортировка" value="new">
                <MenuItem value="new">Сначала новые</MenuItem>
                <MenuItem value="old">Сначала старые</MenuItem>
                <MenuItem value="cheap">Сначала дешевле</MenuItem>
                <MenuItem value="expensive">Сначала дороже</MenuItem>
              </Select>
            </FormControl>
          </div>
          <CatalogContent
            query={productsQuery}
            page={page}
            onPageChange={changePage}
          />
        </section>
      </Box>
    </Container>
  );
}

function CatalogFilters({ resultCount }: { resultCount?: number }) {
  const categoriesQuery = useQuery({
    queryKey: ["catalog", "categories"],
    queryFn: getCategories,
    staleTime: 60_000,
  });

  return (
    <Paper component="aside" className="catalog-filters" elevation={0}>
      <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center" }}>
        <Typography component="h2" variant="h6">Фильтры</Typography>
        <Typography className="catalog-filters__reset">Сбросить всё</Typography>
      </Stack>
      <FormControl fullWidth size="small" disabled>
        <InputLabel id="catalog-category-label">Категория</InputLabel>
        <Select labelId="catalog-category-label" label="Категория" value="all">
          <MenuItem value="all">Все категории</MenuItem>
        </Select>
      </FormControl>
      {categoriesQuery.data?.length ? (
        <div className="catalog-filters__tree" aria-label="Дерево категорий">
          {buildCategoryTree(categoriesQuery.data).map((category) => (
            <CategoryBranch key={category.id} category={category} />
          ))}
        </div>
      ) : null}
      <div className="catalog-filters__characteristics">
        <Typography component="h3" variant="body2">Характеристики</Typography>
        <Typography color="text.secondary" variant="body2">
          Появятся после выбора категории
        </Typography>
      </div>
      <Typography className="catalog-filters__note" variant="caption">
        Поиск, фильтры и сортировка пока недоступны
      </Typography>
      <Button className="catalog-filters__apply" variant="contained" disabled>
        Показать объявлений: {resultCount ?? "—"}
      </Button>
    </Paper>
  );
}

function CategoryBranch({ category }: { category: CategoryNode }) {
  return (
    <div className="catalog-filters__branch">
      <Typography variant="body2">{category.name}</Typography>
      {category.children.map((child) => (
        <CategoryBranch key={child.id} category={child} />
      ))}
    </div>
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
    return <CatalogError message="Не удалось загрузить каталог." onRetry={() => query.refetch()} />;
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
      variant="catalog"
    />
  );
}

function readPage(value: string | null): number {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}
