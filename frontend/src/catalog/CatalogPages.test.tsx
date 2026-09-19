import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "../App";

const publicProduct = {
  id: 7,
  name: "Перфоратор Bosch GBH 2-26",
  minute_rate: "8.00",
  status: "PUBLISHED",
  category: { id: 3, name: "Перфораторы" },
  manager: { id: 4, name: "Алексей Петров", avatar: null },
  pickup_point: { city: "Москва", district: "Хамовники" },
  primary_photo: {
    id: 10,
    url: "/media/catalog/products/7/main.jpg",
    display_order: 0,
    is_primary: true,
  },
  available_instances_count: 3,
};

const publicProductDetail = {
  ...publicProduct,
  description: "Надёжный перфоратор для монтажных и ремонтных работ.",
  photos: [
    publicProduct.primary_photo,
    {
      id: 11,
      url: "/media/catalog/products/7/side.jpg",
      display_order: 1,
      is_primary: false,
    },
  ],
  characteristics: [
    { characteristic_id: 11, option_id: 101, number_value: null, boolean_value: null },
    { characteristic_id: 12, option_id: null, number_value: "26.000000", boolean_value: null },
    { characteristic_id: 13, option_id: null, number_value: null, boolean_value: false },
  ],
  created_at: "2026-09-10T10:00:00+03:00",
  published_at: "2026-09-12T10:00:00+03:00",
};

const renter = {
  email: "anna@example.com",
  name: "Анна Смирнова",
  role: "RENTER" as const,
  avatar: null,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("public catalog", () => {
  it("shows products and public pickup information to a guest", async () => {
    stubCatalogApi();

    renderApp("/");

    const productCard = await screen.findByRole(
      "link",
      { name: publicProduct.name },
      { timeout: 3_000 },
    );
    expect(productCard).toHaveClass("product-card", "product-card--clickable");
    expect(productCard).toHaveAttribute("href", "/products/7");
    expect(screen.queryByText(publicProduct.category.name)).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Каталог оборудования" })).not.toBeInTheDocument();
    expect(screen.getByText("Москва · Хамовники")).toBeInTheDocument();
    expect(screen.getByText("Свободно: 3")).toBeInTheDocument();
    expect(screen.getAllByRole("textbox", { name: "Поиск по названию" })[0]).toBeDisabled();
    expect(screen.getByText("Найдено 1 объявление")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Показать 1 объявление" })).toBeDisabled();
    const categoryTree = await screen.findByLabelText("Дерево категорий");
    expect(categoryTree).toHaveTextContent("Инструменты");
    expect(categoryTree).not.toHaveTextContent("Электроинструменты");
    fireEvent.click(screen.getByRole("button", { name: "Инструменты" }));
    expect(categoryTree).toHaveTextContent("Электроинструменты");
    fireEvent.click(screen.getByRole("button", { name: "Электроинструменты" }));
    expect(categoryTree).toHaveTextContent("Перфораторы");
    expect(screen.queryByText("ул. Усачёва, 22")).not.toBeInTheDocument();
  });

  it("opens marketplace navigation from the mobile menu", async () => {
    stubCatalogApi();

    renderApp("/");
    fireEvent.click(await screen.findByRole("button", { name: "Открыть меню" }));

    expect(screen.getByRole("menuitem", { name: "Зарегистрироваться" })).toHaveAttribute("href", "/register");
  });

  it("opens an accessible photo viewer from product details", async () => {
    stubCatalogApi();

    renderApp("/products/7");

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Открыть фотографию 1 из 2",
      }),
    );

    expect(screen.getByRole("dialog", { name: "Фотографии товара" })).toBeInTheDocument();
    expect(screen.getByText("1 из 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Увеличить" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Следующая фотография" }));
    expect(screen.getByText("2 из 2")).toBeInTheDocument();
  });

  it("hides the exact address from a guest and shows the planned sections", async () => {
    stubCatalogApi();

    renderApp("/products/7");

    expect(
      await screen.findByRole("heading", { name: publicProduct.name }),
    ).toBeInTheDocument();
    expect(screen.getByText("Точный адрес доступен после входа")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Подать заявку" })[0]).toBeDisabled();
    expect(
      screen.getByRole("heading", { name: "Характеристики" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Bosch")).toBeInTheDocument();
    expect(screen.getByText("26 дюйм")).toBeInTheDocument();
    expect(screen.getByText("Нет")).toBeInTheDocument();
    expect(screen.getAllByText(">").length).toBeGreaterThan(0);
  });

  it("shows the exact address and request action to an authenticated renter", async () => {
    stubCatalogApi(renter);

    renderApp("/products/7");

    expect(await screen.findByText("ул. Усачёва, 22")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Открыть в Яндекс.Картах" }),
    ).toHaveAttribute("href", "https://yandex.ru/maps/?pt=37.56,55.73&z=16&l=map");
    expect(
      screen.getAllByRole("button", { name: "Подать заявку" })[0],
    ).toBeDisabled();
    expect(
      screen.getAllByText("Подача заявки пока недоступна")[0],
    ).toBeInTheDocument();
  });
});

describe("manager profile", () => {
  it("separates active and archived products", async () => {
    stubCatalogApi();

    renderApp("/managers/4");

    expect(
      await screen.findByRole("heading", { name: "Алексей Петров" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Архив 1" }));

    expect(await screen.findByText("В архиве")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: publicProduct.name })).toBeInTheDocument();
  });
});

function stubCatalogApi(currentUser: typeof renter | null = null): void {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path === "/api/v1/auth/me/") {
      return currentUser ? jsonResponse(currentUser) : unauthenticatedResponse();
    }
    if (path === "/api/v1/products/?page=1") {
      return paginatedResponse([publicProduct]);
    }
    if (path === "/api/v1/categories/") {
      return jsonResponse([
        { id: 1, name: "Инструменты", parent_id: null, characteristics: [] },
        { id: 2, name: "Электроинструменты", parent_id: 1, characteristics: [] },
        {
          id: 3,
          name: "Перфораторы",
          parent_id: 2,
          characteristics: [
            {
              id: 11,
              name: "Производитель",
              type: "LIST",
              is_required: false,
              unit: "",
              display_order: 0,
              options: [{ id: 101, value: "Bosch", display_order: 0 }],
            },
            {
              id: 12,
              name: "Диаметр",
              type: "NUMBER",
              is_required: false,
              unit: "дюйм",
              display_order: 1,
              options: [],
            },
            {
              id: 13,
              name: "Реверс",
              type: "BOOLEAN",
              is_required: false,
              unit: "",
              display_order: 2,
              options: [],
            },
          ],
        },
      ]);
    }
    if (path === "/api/v1/products/7/") {
      const pickupPoint = currentUser
        ? {
            ...publicProduct.pickup_point,
            full_address: "ул. Усачёва, 22",
            latitude: "55.73",
            longitude: "37.56",
            yandex_maps_url:
              "https://yandex.ru/maps/?pt=37.56,55.73&z=16&l=map",
          }
        : publicProduct.pickup_point;
      return jsonResponse({ ...publicProductDetail, pickup_point: pickupPoint });
    }
    if (path === "/api/v1/managers/4/") {
      return jsonResponse({
        id: 4,
        name: "Алексей Петров",
        avatar: null,
        active_products_count: 1,
        frozen_products_count: 1,
      });
    }
    if (path.includes("/api/v1/managers/4/products/active/")) {
      return paginatedResponse([publicProduct]);
    }
    if (path.includes("/api/v1/managers/4/products/frozen/")) {
      return paginatedResponse([{ ...publicProduct, status: "FROZEN" }]);
    }
    return new Response(null, { status: 404 });
  }));
}

function renderApp(initialEntry: string): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function paginatedResponse(results: unknown[]): Response {
  return jsonResponse({ count: results.length, next: null, previous: null, results });
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function unauthenticatedResponse(): Response {
  return jsonResponse(
    {
      code: "not_authenticated",
      message: "Учетные данные не были предоставлены.",
      field_errors: {},
    },
    401,
  );
}
