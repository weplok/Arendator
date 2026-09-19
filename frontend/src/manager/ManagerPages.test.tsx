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
  published_at: null, pickup_point: null, photos: [], instances: [], available_instances_count: 0,
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
  fireEvent.click(screen.getByRole("link", { name: "Редактировать Дрель" }));
  expect(await screen.findByRole("heading", { name: "Редактирование товара" })).toBeInTheDocument();
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
  fireEvent.click(await screen.findByRole("button", { name: "Заморозить" }));
  expect(screen.getByRole("dialog", { name: "Заморозить товар?" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Заморозить товар" }));
  expect(await screen.findByRole("heading", { name: "Архив товаров" })).toBeInTheDocument();
  expect(frozen).toBe(true);
});
