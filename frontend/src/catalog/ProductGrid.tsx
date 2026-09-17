import { Box, Pagination } from "@mui/material";

import { CATALOG_PAGE_SIZE, type PaginatedProducts } from "../api/catalog";
import { ProductCard } from "./ProductCard";

interface ProductGridProps {
  page: number;
  products: PaginatedProducts;
  onPageChange: (page: number) => void;
  variant?: "catalog" | "profile";
}

export function ProductGrid({ page, products, onPageChange, variant = "profile" }: ProductGridProps) {
  const totalPages = Math.ceil(products.count / CATALOG_PAGE_SIZE);

  return (
    <>
      <Box className="product-grid">
        {products.results.map((product) => (
          <ProductCard key={product.id} product={product} variant={variant} />
        ))}
      </Box>
      {totalPages > 1 ? (
        <Pagination
          className="catalog-pagination"
          page={page}
          count={totalPages}
          color="primary"
          onChange={(_, nextPage) => onPageChange(nextPage)}
          aria-label="Страницы каталога"
        />
      ) : null}
    </>
  );
}
