import {
  Avatar,
  Box,
  Container,
  Paper,
  Tab,
  Tabs,
  Typography,
} from "@mui/material";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useParams, useSearchParams } from "react-router-dom";

import {
  getManagerProducts,
  getManagerProfile,
  type ManagerProductSection,
  type PaginatedProducts,
} from "../api/catalog";
import { CatalogEmpty, CatalogError, CatalogLoading } from "./CatalogState";
import { ProductGrid } from "./ProductGrid";

export function ManagerProfilePage() {
  const managerId = Number(useParams().managerId);
  const [searchParams, setSearchParams] = useSearchParams();
  const section = readSection(searchParams.get("section"));
  const page = readPage(searchParams.get("page"));
  const profileQuery = useQuery({
    queryKey: ["catalog", "manager", managerId],
    queryFn: () => getManagerProfile(managerId),
    enabled: Number.isInteger(managerId) && managerId > 0,
  });
  const productsQuery = useQuery({
    queryKey: ["catalog", "manager", managerId, section, page],
    queryFn: () => getManagerProducts(managerId, section, page),
    enabled: Number.isInteger(managerId) && managerId > 0,
  });

  if (profileQuery.isPending) {
    return <CatalogLoading label="Загрузка профиля менеджера…" />;
  }
  if (profileQuery.isError) {
    return (
      <CatalogError
        message="Не удалось загрузить профиль менеджера."
        onRetry={() => profileQuery.refetch()}
      />
    );
  }

  function changeSection(nextSection: ManagerProductSection): void {
    setSearchParams(nextSection === "active" ? {} : { section: nextSection });
  }

  function changePage(nextPage: number): void {
    const params: Record<string, string> = {};
    if (section !== "active") {
      params.section = section;
    }
    if (nextPage !== 1) {
      params.page = String(nextPage);
    }
    setSearchParams(params);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const profile = profileQuery.data;
  return (
    <Container maxWidth="lg" className="manager-page">
      <Paper className="manager-profile-header" elevation={0}>
        <Avatar src={profile.avatar ?? undefined} alt="" className="manager-avatar">
          {profile.name.slice(0, 1)}
        </Avatar>
        <Box>
          <Typography component="p" className="page-eyebrow">
            Каталог менеджера
          </Typography>
          <Typography component="h1" variant="h3">
            {profile.name}
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 1 }}>
            {profile.active_products_count} активных · {profile.frozen_products_count} в архиве
          </Typography>
        </Box>
      </Paper>
      <Tabs
        value={section}
        onChange={(_, value: ManagerProductSection) => changeSection(value)}
        aria-label="Разделы каталога менеджера"
        className="manager-tabs"
      >
        <Tab value="active" label={`Активные ${profile.active_products_count}`} />
        <Tab value="frozen" label={`Архив ${profile.frozen_products_count}`} />
      </Tabs>
      <ManagerProducts
        query={productsQuery}
        section={section}
        page={page}
        onPageChange={changePage}
      />
    </Container>
  );
}

interface ManagerProductsProps {
  query: UseQueryResult<PaginatedProducts, Error>;
  section: ManagerProductSection;
  page: number;
  onPageChange: (page: number) => void;
}

function ManagerProducts({ query, section, page, onPageChange }: ManagerProductsProps) {
  if (query.isPending) {
    return <CatalogLoading label="Загрузка товаров менеджера…" />;
  }
  if (query.isError) {
    return <CatalogError message="Не удалось загрузить товары менеджера." onRetry={() => query.refetch()} />;
  }
  if (query.data.results.length === 0) {
    return (
      <CatalogEmpty
        title={section === "active" ? "Нет активных товаров" : "Архив пуст"}
        description={section === "active" ? "У менеджера пока нет опубликованных товаров." : "У менеджера нет замороженных товаров."}
      />
    );
  }
  return <ProductGrid products={query.data} page={page} onPageChange={onPageChange} />;
}

function readSection(value: string | null): ManagerProductSection {
  return value === "frozen" ? "frozen" : "active";
}

function readPage(value: string | null): number {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}
