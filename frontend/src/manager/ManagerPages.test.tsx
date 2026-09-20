import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";

import App from "../App";

const manager = { email: "manager@example.com", name: "Алексей", role: "MANAGER", avatar: null };
const category = { id: 1, parent_id: null, name: "Инструменты", characteristics: [] };
const product = {
  id: 8, catalog_number: 1, category: 1, category_name: "Инструменты",
  name: "Дрель", description: "Для ремонта", minute_rate: "3.00", status: "DRAFT",
  rejection_reason: "", published_at: null, pickup_point: null, photos: [], instances: [], available_instances_count: 0,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.cookie = "csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
});

function renderPage(path: string) {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[path]}><App /></MemoryRouter>
  </QueryClientProvider>);
}

it("shows only own products and navigates to the editor", async () => {
  vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => Promise.resolve(
    Response.json(url.includes("auth/me") ? manager : url.includes("categories") ? [category] : url.endsWith("/8/") ? product : [product]),
  )));
  renderPage("/account");
  expect(await screen.findByRole("heading", { name: "Кабинет менеджера" })).toBeInTheDocument();
  expect(screen.getByText("Дрель")).toBeInTheDocument();
  expect(screen.getByText("Опубликовано").closest(".manager-stat")).toHaveClass("manager-stat--published");
  expect(screen.getByText("Черновики").closest(".manager-stat")).toHaveClass("manager-stat--draft");
  expect(screen.getByText("В архиве").closest(".manager-stat")).toHaveClass("manager-stat--archived");
  expect(screen.getByLabelText("0 свободно из 0")).toHaveTextContent("0/0");
  fireEvent.click(screen.getByRole("link", { name: "Открыть Дрель" }));
  expect(await screen.findByRole("heading", { name: "Редактирование товара" })).toBeInTheDocument();
  expect(screen.getAllByRole("link", { name: "Мои товары" })).toHaveLength(2);
  expect(screen.queryByText("1 Основное")).not.toBeInTheDocument();
});

it("creates a draft then opens its photo step", async () => {
  document.cookie = "csrftoken=manager-token; path=/";
  const requests: { url: string; options?: RequestInit }[] = [];
  vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string, options?: RequestInit) => {
    requests.push({ url, options });
    if (url.includes("auth/me")) return Promise.resolve(Response.json(manager));
    if (url.includes("categories")) return Promise.resolve(Response.json([category]));
    if (options?.method === "POST") return Promise.resolve(Response.json(product, { status: 201 }));
    if (url.endsWith("/8/")) return Promise.resolve(Response.json(product));
    return Promise.resolve(Response.json([]));
  }));
  renderPage("/manager/products/new");
  await screen.findByRole("heading", { name: "Новый товар" });
  fireEvent.change(await screen.findByRole("combobox", { name: /^Категория/ }), { target: { value: "1" } });
  fireEvent.change(screen.getByRole("textbox", { name: /^Название/ }), { target: { value: "Дрель" } });
  fireEvent.change(screen.getByRole("textbox", { name: /^Описание/ }), { target: { value: "Для ремонта" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: /^Ставка/ }), { target: { value: "3" } });
  fireEvent.click(screen.getByRole("button", { name: "Сохранить и продолжить" }));
  expect(await screen.findByRole("heading", { name: "Фотографии товара" })).toBeInTheDocument();
  await waitFor(() => expect(requests.some(({ url, options }) =>
    url === "/api/v1/manager/products/" && options?.method === "POST" &&
    new Headers(options.headers).get("X-CSRFToken") === "manager-token",
  )).toBe(true));
});

it("shows rejected products in a separate section", async () => {
  const rejected = {
    ...product,
    status: "REJECTED",
    rejection_reason: "Добавьте фото серийного номера.",
  };
  vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => Promise.resolve(
    Response.json(url.includes("auth/me") ? manager : [rejected]),
  )));

  renderPage("/manager/rejected");

  expect(await screen.findByRole("heading", { name: "Отклонённые товары" })).toBeInTheDocument();
  expect(screen.getByText("Дрель")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Отклонённые/ })).toHaveAttribute("aria-current", "page");
});

it("shows the rejection reason and confirms permanent deletion in the same dialog", async () => {
  document.cookie = "csrftoken=manager-token; path=/";
  const rejected = {
    ...product,
    status: "REJECTED",
    rejection_reason: "Добавьте фото серийного номера.",
  };
  let deleted = false;
  vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string, options?: RequestInit) => {
    if (url.includes("auth/me")) return Promise.resolve(Response.json(manager));
    if (url.includes("categories")) return Promise.resolve(Response.json([category]));
    if (url.includes("characteristics")) return Promise.resolve(Response.json([]));
    if (url.endsWith("/8/") && options?.method === "DELETE") {
      deleted = true;
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (url.endsWith("/8/")) return Promise.resolve(Response.json(rejected));
    return Promise.resolve(Response.json(deleted ? [] : [rejected]));
  }));

  renderPage("/manager/products/8/basic");

  expect(await screen.findByRole("dialog", { name: "Карточка отклонена" })).toHaveTextContent(
    "Добавьте фото серийного номера.",
  );
  fireEvent.click(screen.getByRole("button", { name: "Удалить карточку" }));
  expect(screen.getByRole("dialog", { name: "Удалить карточку безвозвратно?" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Удалить безвозвратно" }));

  expect(await screen.findByRole("heading", { name: "Отклонённые товары" })).toBeInTheDocument();
  expect(deleted).toBe(true);
});

it("confirms freezing and moves the product into the archive", async () => {
  document.cookie = "csrftoken=manager-token; path=/";
  const published = { ...product, status: "PUBLISHED", published_at: "2026-09-17T10:00:00Z" };
  const archived = { ...published, status: "FROZEN" };
  let frozen = false;
  const fetchMock = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
    if (url.includes("auth/me")) return Promise.resolve(Response.json(manager));
    if (url.includes("categories")) return Promise.resolve(Response.json([category]));
    if (url.includes("characteristics")) return Promise.resolve(Response.json([]));
    if (url.endsWith("freeze/")) { frozen = true; return Promise.resolve(Response.json(archived)); }
    if (url.endsWith("/8/")) return Promise.resolve(Response.json(frozen ? archived : published));
    if (options?.method) throw new Error("Unexpected mutation");
    return Promise.resolve(Response.json([frozen ? archived : published]));
  });
  vi.stubGlobal("fetch", fetchMock);
  renderPage("/manager/products/8/instances");
  const editorGrid = (await screen.findByRole("heading", { name: "Экземпляры товара" }))
    .closest(".manager-main")
    ?.querySelector(".manager-editor-grid");
  expect(editorGrid).toHaveClass("manager-editor-grid--wide");
  expect(screen.queryByRole("heading", { name: "Перед публикацией" })).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole("button", { name: "Заморозить" }));
  expect(screen.getByRole("dialog", { name: "Заморозить товар?" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Заморозить товар" }));
  expect(await screen.findByRole("heading", { name: "Архив товаров" })).toBeInTheDocument();
  expect(frozen).toBe(true);
});

it("sends a completed draft to moderation without publishing it", async () => {
  document.cookie = "csrftoken=manager-token; path=/";
  const completeDraft = {
    ...product,
    pickup_point: {
      city: "Москва", district: "Центр", full_address: "Тверская, 1",
      latitude: "55.750000", longitude: "37.610000", yandex_maps_url: "https://yandex.ru/maps/",
    },
    photos: [{ id: 20, url: "/drill.jpg", display_order: 0, is_primary: true }],
    instances: [{ id: "instance-1", inventory_number: "1-1", status: "AVAILABLE" }],
    available_instances_count: 1,
  };
  const pending = { ...completeDraft, status: "ON_MODERATION" };
  let submitted = false;
  vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
    if (url.includes("auth/me")) return Promise.resolve(Response.json(manager));
    if (url.includes("categories")) return Promise.resolve(Response.json([category]));
    if (url.includes("characteristics")) return Promise.resolve(Response.json([]));
    if (url.endsWith("submit/")) {
      submitted = true;
      return Promise.resolve(Response.json(pending));
    }
    if (url.endsWith("/8/")) return Promise.resolve(Response.json(submitted ? pending : completeDraft));
    return Promise.resolve(Response.json([submitted ? pending : completeDraft]));
  }));

  renderPage("/manager/products/8/instances");
  fireEvent.click(await screen.findByRole("button", { name: "Отправить на модерацию" }));

  expect(await screen.findByRole("heading", { name: "Мои товары" })).toBeInTheDocument();
  expect(screen.getByText("На модерации")).toBeInTheDocument();
  expect(submitted).toBe(true);
});

it("formats characteristic numbers and continues to the pickup step after saving", async () => {
  document.cookie = "csrftoken=manager-token; path=/";
  const categoryWithCharacteristics = {
    ...category,
    characteristics: [
      {
        id: 11, category_id: 1, name: "Диаметр", type: "NUMBER",
        is_required: true, unit: "дюйм", display_order: 0, options: [],
      },
      {
        id: 12, category_id: 1, name: "Производитель", type: "LIST",
        is_required: false, unit: "", display_order: 1,
        options: [{ id: 101, value: "Bosch", display_order: 0 }],
      },
    ],
  };
  const values = [
    { characteristic_id: 11, option_id: null, number_value: "26.000000", boolean_value: null },
    { characteristic_id: 12, option_id: 101, number_value: null, boolean_value: null },
  ];
  let savedBody: string | undefined;
  vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string, options?: RequestInit) => {
    if (url.includes("auth/me")) return Promise.resolve(Response.json(manager));
    if (url.includes("categories")) return Promise.resolve(Response.json([categoryWithCharacteristics]));
    if (url.includes("characteristics")) {
      if (options?.method === "PUT") savedBody = String(options.body);
      return Promise.resolve(Response.json(values));
    }
    if (url.endsWith("/8/")) return Promise.resolve(Response.json(product));
    return Promise.resolve(Response.json([product]));
  }));

  renderPage("/manager/products/8/features");

  expect(await screen.findByRole("spinbutton", { name: /^Диаметр/ })).toHaveValue(26);
  expect(screen.queryByRole("option", { name: "Выберите значение" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Сохранить характеристики" }));
  expect(await screen.findByRole("heading", { name: "Точка самовывоза", level: 1 })).toBeInTheDocument();
  expect(savedBody).toContain('"number_value":"26"');
  expect(screen.getByRole("link", { name: "Назад" })).toHaveAttribute(
    "href",
    "/manager/products/8/features",
  );
});

it("moves a selected photo to the first position", async () => {
  document.cookie = "csrftoken=manager-token; path=/";
  const photos = [
    { id: 20, url: "/first.jpg", display_order: 0, is_primary: true },
    { id: 21, url: "/second.jpg", display_order: 1, is_primary: false },
  ];
  let currentProduct = { ...product, photos };
  let submittedOrder: number[] = [];
  vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string, options?: RequestInit) => {
    if (url.includes("auth/me")) return Promise.resolve(Response.json(manager));
    if (url.includes("categories")) return Promise.resolve(Response.json([category]));
    if (url.endsWith("photos/order/") && options?.method === "PUT") {
      submittedOrder = JSON.parse(String(options.body)).photo_ids;
      currentProduct = {
        ...currentProduct,
        photos: submittedOrder.map((id, index) => ({
          ...photos.find((photo) => photo.id === id)!,
          display_order: index,
          is_primary: index === 0,
        })),
      };
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (url.endsWith("/8/")) return Promise.resolve(Response.json(currentProduct));
    if (url.includes("characteristics")) return Promise.resolve(Response.json([]));
    return Promise.resolve(Response.json([currentProduct]));
  }));

  renderPage("/manager/products/8/photos");
  fireEvent.click(await screen.findByRole("button", { name: "Сделать главным" }));

  await waitFor(() => expect(submittedOrder).toEqual([21, 20]));
  expect(screen.getByText("Главное фото").closest(".manager-photo")).toHaveTextContent(
    "Главное фото",
  );
  expect(screen.getByRole("button", { name: "Выбрать файлы" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Раньше|Позже/ })).not.toBeInTheDocument();
});

it("previews a dragged photo in its new place and saves the order on drop", async () => {
  document.cookie = "csrftoken=manager-token; path=/";
  const photos = [
    { id: 20, url: "/first.jpg", display_order: 0, is_primary: true },
    { id: 21, url: "/second.jpg", display_order: 1, is_primary: false },
  ];
  let submittedOrder: number[] = [];
  vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string, options?: RequestInit) => {
    if (url.includes("auth/me")) return Promise.resolve(Response.json(manager));
    if (url.includes("categories")) return Promise.resolve(Response.json([category]));
    if (url.endsWith("photos/order/") && options?.method === "PUT") {
      submittedOrder = JSON.parse(String(options.body)).photo_ids;
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (url.endsWith("/8/")) return Promise.resolve(Response.json({ ...product, photos }));
    if (url.includes("characteristics")) return Promise.resolve(Response.json([]));
    return Promise.resolve(Response.json([{ ...product, photos }]));
  }));

  renderPage("/manager/products/8/photos");
  const firstPhoto = await screen.findByRole("listitem", { name: "Фото 1 товара Дрель" });
  const secondPhoto = screen.getByRole("listitem", { name: "Фото 2 товара Дрель" });

  fireEvent.dragStart(secondPhoto);
  fireEvent.dragEnter(firstPhoto);
  expect(screen.getByRole("list", { name: "Фотографии товара" }).firstElementChild)
    .toBe(secondPhoto);
  fireEvent.drop(firstPhoto);

  await waitFor(() => expect(submittedOrder).toEqual([21, 20]));
});
