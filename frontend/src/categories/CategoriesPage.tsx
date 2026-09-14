import { useQuery } from "@tanstack/react-query";

import {
  type CategoryNode,
  buildCategoryTree,
  getCategories,
} from "../api/categories";

const CATEGORIES_QUERY_KEY = ["categories"] as const;

export function CategoriesPage() {
  const categoriesQuery = useQuery({
    queryKey: CATEGORIES_QUERY_KEY,
    queryFn: getCategories,
    staleTime: 60_000,
  });

  if (categoriesQuery.isPending) {
    return <CategoryPageMessage role="status" message="Загрузка категорий…" />;
  }

  if (categoriesQuery.isError) {
    return (
      <main>
        <h1>Дерево категорий</h1>
        <p role="alert">Не удалось загрузить категории.</p>
        <button type="button" onClick={() => categoriesQuery.refetch()}>
          Повторить
        </button>
      </main>
    );
  }

  const roots = buildCategoryTree(categoriesQuery.data);
  return (
    <main>
      <h1>Дерево категорий</h1>
      {roots.length === 0 ? (
        <p>Категории пока не созданы.</p>
      ) : (
        <CategoryList categories={roots} />
      )}
    </main>
  );
}

interface CategoryPageMessageProps {
  message: string;
  role: "status";
}

function CategoryPageMessage({ message, role }: CategoryPageMessageProps) {
  return (
    <main>
      <h1>Дерево категорий</h1>
      <p role={role}>{message}</p>
    </main>
  );
}

interface CategoryListProps {
  categories: CategoryNode[];
}

function CategoryList({ categories }: CategoryListProps) {
  return (
    <ul>
      {categories.map((category) => (
        <li key={category.id}>
          {category.name}
          {category.children.length > 0 ? (
            <CategoryList categories={category.children} />
          ) : null}
        </li>
      ))}
    </ul>
  );
}
