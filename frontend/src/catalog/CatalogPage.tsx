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
  Typography,
} from "@mui/material";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";

import { getProducts, type PaginatedProducts } from "../api/catalog";
import { buildCategoryTree, getCategories, type CategoryNode } from "../api/categories";
import { ArrowRightIcon } from "../ui/Icons";
import { CatalogEmpty, CatalogError, CatalogLoading } from "./CatalogState";
import { formatAdvertisementCount } from "./formatting";
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
      <Box className="catalog-layout">
        <CatalogFilters resultCount={productsQuery.data?.count} />
        <section className="catalog-results" aria-label="Результаты каталога">
          <div className="catalog-results__toolbar">
            <Typography component="h2" variant="body1">
              {productsQuery.data
                ? `Найдено ${formatAdvertisementCount(productsQuery.data.count)}`
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
  const [expandedCategories, setExpandedCategories] = useState<Set<number>>(new Set());
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const categoriesQuery = useQuery({
    queryKey: ["catalog", "categories"],
    queryFn: getCategories,
    staleTime: 60_000,
  });

  return (
    <Paper component="aside" className="catalog-filters" elevation={0}>
      <Stack direction="row" className="catalog-filters__heading">
        <Typography component="h2" variant="h6">Фильтры</Typography>
        <button
          className="catalog-filters__reset"
          type="button"
          onClick={() => {
            setExpandedCategories(new Set());
            setSelectedCategory(null);
          }}
        >
          Сбросить
        </button>
      </Stack>
      {categoriesQuery.data?.length ? (
        <div className="catalog-filters__tree" aria-label="Дерево категорий">
          {buildCategoryTree(categoriesQuery.data).map((category) => (
            <CategoryBranch
              key={category.id}
              category={category}
              expandedCategories={expandedCategories}
              selectedCategory={selectedCategory}
              onSelect={(categoryId, hasChildren) => {
                setSelectedCategory(categoryId);
                if (hasChildren) {
                  setExpandedCategories((current) => {
                    const next = new Set(current);
                    if (next.has(categoryId)) next.delete(categoryId);
                    else next.add(categoryId);
                    return next;
                  });
                }
              }}
            />
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
        {resultCount === undefined
          ? "Показать — объявлений"
          : `Показать ${formatAdvertisementCount(resultCount)}`}
      </Button>
    </Paper>
  );
}

interface CategoryBranchProps {
  category: CategoryNode;
  expandedCategories: Set<number>;
  selectedCategory: number | null;
  onSelect: (categoryId: number, hasChildren: boolean) => void;
}

function CategoryBranch({
  category,
  expandedCategories,
  selectedCategory,
  onSelect,
}: CategoryBranchProps) {
  const hasChildren = category.children.length > 0;
  const expanded = expandedCategories.has(category.id);
  return (
    <div className="catalog-filters__branch">
      <button
        aria-expanded={hasChildren ? expanded : undefined}
        aria-pressed={selectedCategory === category.id}
        className="catalog-filters__category"
        type="button"
        onClick={() => onSelect(category.id, hasChildren)}
      >
        {hasChildren ? <ArrowRightIcon className={expanded ? "is-expanded" : ""} /> : <span />}
        {category.name}
      </button>
      {expanded ? (
        <div className="catalog-filters__children">
          {category.children.map((child) => (
            <CategoryBranch
              key={child.id}
              category={child}
              expandedCategories={expandedCategories}
              selectedCategory={selectedCategory}
              onSelect={onSelect}
            />
          ))}
        </div>
      ) : null}
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
