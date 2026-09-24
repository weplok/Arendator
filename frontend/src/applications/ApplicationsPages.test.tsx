import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "../App";

const renter = {
  email: "anna@example.com",
  name: "Анна Смирнова",
  role: "RENTER",
  avatar: null,
};
const manager = {
  email: "manager@example.com",
  name: "Алексей Петров",
  role: "MANAGER",
  avatar: null,
};
const product = {
  id: 7,
  name: "Перфоратор Bosch GBH 2-26",
  description: "Надёжный перфоратор для монтажных и ремонтных работ.",
  minute_rate: "8.00",
  status: "PUBLISHED",
  category: { id: 3, name: "Перфораторы" },
  manager: { id: 4, name: "Алексей Петров", avatar: null },
  pickup_point: {
    city: "Москва",
    district: "Хамовники",
    full_address: "ул. Усачёва, 22",
    latitude: "55.73",
    longitude: "37.56",
    yandex_maps_url: "https://yandex.ru/maps/?pt=37.56,55.73&z=16&l=map",
  },
  primary_photo: null,
  available_instances_count: 1,
  total_instances_count: 3,
  current_user_pending_applications_count: 1,
  photos: [],
  characteristics: [],
  created_at: "2026-09-10T10:00:00+03:00",
  published_at: "2026-09-12T10:00:00+03:00",
};
const application = {
  id: 42,
  status: "WAITING",
  pickup_deadline_at: "2026-09-25T18:00:00+03:00",
  planned_return_at: "2026-09-26T18:00:00+03:00",
  created_at: "2026-09-21T10:00:00+03:00",
  updated_at: "2026-09-21T10:00:00+03:00",
  cancellation_reason: "",
  estimated_cost: "11532.00",
  product: {
    id: product.id,
    name: product.name,
    description: product.description,
    minute_rate: product.minute_rate,
    primary_photo: null,
    pickup_point: product.pickup_point,
    available_instances_count: 1,
    total_instances_count: 3,
  },
  renter: { id: 8, name: renter.name, avatar: null },
  history: [{
    event: "CREATED",
    actor: "RENTER",
    created_at: "2026-09-21T10:00:00+03:00",
    note: "",
  }],
};
const instanceId = "11111111-1111-4111-8111-111111111111";
const booking = {
  id: 184,
  application_id: application.id,
  status: "ACTIVE",
  pickup_deadline_at: application.pickup_deadline_at,
  planned_return_at: application.planned_return_at,
  minute_rate_snapshot: "8.00",
  starting_price_snapshot: "80.00",
  arrival_confirmed_at: null,
  cancellation_reason: "",
  ended_at: null,
  created_at: "2026-09-24T12:24:00+03:00",
  updated_at: "2026-09-24T12:24:00+03:00",
  product: application.product,
  renter: application.renter,
  manager: { id: 4, name: manager.name, avatar: null },
  instance: {
    id: instanceId,
    inventory_number: "D-1042",
    instance_number: 1,
    status: "RESERVED",
    status_label: "Забронирован",
  },
  history: [{
    event: "CREATED",
    actor: "MANAGER",
    created_at: "2026-09-24T12:24:00+03:00",
    note: "",
  }],
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.cookie = "csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
});

describe("renter applications", () => {
  it("keeps duration linked and submits an application", async () => {
    document.cookie = "csrftoken=test-token; path=/";
    const requests: Array<{ path: string; options?: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const path = String(input);
      requests.push({ path, options });
      if (path === "/api/v1/auth/me/") return jsonResponse(renter);
      if (path === "/api/v1/products/7/") return jsonResponse(product);
      if (path === "/api/v1/products/7/applications/") return jsonResponse(application, 201);
      if (path === "/api/v1/applications/42/") return jsonResponse(application);
      return jsonResponse([]);
    }));

    renderApp("/products/7/apply");

    expect(await screen.findByRole("heading", { name: "Подать заявку" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("spinbutton", { name: "Дней" }), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByRole("checkbox", {
      name: /Понимаю, что товар нужно забрать/,
    }));
    fireEvent.click(screen.getByRole("button", { name: "Подать заявку" }));

    expect(await screen.findByText(/Заявка создана и ожидает решения/)).toBeInTheDocument();
    const createRequest = requests.find(({ path }) =>
      path === "/api/v1/products/7/applications/"
    );
    const body = JSON.parse(String(createRequest?.options?.body));
    expect(
      new Date(body.planned_return_at).getTime() -
      new Date(body.pickup_deadline_at).getTime(),
    ).toBe(48 * 3_600_000);
  });

  it("confirms cancellation and keeps the completed application visible", async () => {
    document.cookie = "csrftoken=test-token; path=/";
    let currentApplication = application;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const path = String(input);
      if (path === "/api/v1/auth/me/") return jsonResponse(renter);
      if (path === "/api/v1/applications/" && !options?.method) {
        return jsonResponse([currentApplication]);
      }
      if (path === "/api/v1/applications/42/cancel/") {
        currentApplication = {
          ...application,
          status: "CANCELLED",
          cancellation_reason: "Планы изменились",
        };
        return jsonResponse(currentApplication);
      }
      return jsonResponse(currentApplication);
    }));

    renderApp("/account");

    fireEvent.click(await screen.findByRole("button", { name: "Отменить" }));
    const dialog = screen.getByRole("dialog", { name: "Отменить заявку?" });
    fireEvent.change(within(dialog).getByLabelText("Причина отмены (необязательно)"), {
      target: { value: "Планы изменились" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Отменить заявку" }));

    expect(await screen.findByText("Завершены · 1")).toBeInTheDocument();
    expect(screen.getByText("Отменена")).toBeInTheDocument();
  });
});

describe("manager application queue", () => {
  it("shows availability priority and persists queue settings", async () => {
    document.cookie = "csrftoken=test-token; path=/";
    const unavailable = {
      ...application,
      id: 43,
      product: {
        ...application.product,
        id: 9,
        name: "Стремянка",
        available_instances_count: 0,
      },
    };
    let preferences = { ordering: "EARLIEST", hide_unavailable: false };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const path = String(input);
      if (path === "/api/v1/auth/me/") return jsonResponse(manager);
      if (path === "/api/v1/manager/application-preferences/") {
        preferences = JSON.parse(String(options?.body));
        return jsonResponse(preferences);
      }
      if (path === "/api/v1/manager/applications/") {
        return jsonResponse({
          preferences,
          results: preferences.hide_unavailable ? [application] : [application, unavailable],
        });
      }
      return jsonResponse([]);
    }));

    renderApp("/manager/applications");

    expect(await screen.findByRole("heading", { name: "Очередь заявок" })).toBeInTheDocument();
    expect(screen.getByText("Есть свободные экземпляры")).toBeInTheDocument();
    expect(screen.getByText("Нет свободных экземпляров")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", {
      name: "Скрыть товары без свободных экземпляров",
    }));

    expect(await screen.findByText("Настройки сохранены")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Стремянка")).not.toBeInTheDocument());
  });

  it("requires a manual instance choice and creates a booking", async () => {
    document.cookie = "csrftoken=test-token; path=/";
    const readyApplication = {
      ...application,
      instances: [{
        id: instanceId,
        inventory_number: "D-1042",
        instance_number: 1,
        status: "AVAILABLE",
        status_label: "Свободен",
      }],
    };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === "/api/v1/auth/me/") return jsonResponse(manager);
      if (path === "/api/v1/manager/applications/42/") return jsonResponse(readyApplication);
      if (path === "/api/v1/manager/applications/42/book/") return jsonResponse(booking, 201);
      if (path === "/api/v1/manager/bookings/184/") return jsonResponse(booking);
      return jsonResponse([]);
    }));

    renderApp("/manager/applications/42");

    expect(await screen.findByText("Можно забронировать · 1 свободно")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Проверить и создать бронь" })).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: "D-1042 · Свободен" }));
    fireEvent.click(screen.getByRole("button", { name: "Проверить и создать бронь" }));
    const dialog = screen.getByRole("dialog", { name: "Проверить бронь" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Создать бронь" }));

    expect(await screen.findByText(/Бронь создана. Экземпляр удерживается/)).toBeInTheDocument();
    expect(screen.getByText("D-1042", { exact: false })).toBeInTheDocument();
  });

  it("confirms arrival without starting a rental", async () => {
    document.cookie = "csrftoken=test-token; path=/";
    let currentBooking: unknown = booking;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === "/api/v1/auth/me/") return jsonResponse(manager);
      if (path === "/api/v1/manager/bookings/184/arrival/") {
        currentBooking = {
          ...booking,
          status: "ARRIVED",
          arrival_confirmed_at: "2026-09-24T16:07:00+03:00",
          instance: { ...booking.instance, status: "PICKUP_IN_PROGRESS" },
          history: [...booking.history, {
            event: "ARRIVAL_CONFIRMED",
            actor: "MANAGER",
            created_at: "2026-09-24T16:07:00+03:00",
            note: "",
          }],
        };
        return jsonResponse(currentBooking);
      }
      if (path === "/api/v1/manager/bookings/184/") return jsonResponse(currentBooking);
      return jsonResponse([]);
    }));

    renderApp("/manager/bookings/184");

    fireEvent.click(await screen.findByRole("button", { name: "Подтвердить прибытие" }));
    const dialog = screen.getByRole("dialog", { name: "Арендатор уже прибыл?" });
    expect(within(dialog).getByText(/аренда и расчёт времени не начнутся/i)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Подтвердить прибытие" }));

    expect(await screen.findByText(/Автоматическое истечение остановлено/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Арендатор уже прибыл?" })).not.toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Получение оформляется" })).toBeInTheDocument();
  });
});

describe("renter bookings", () => {
  it("never exposes the inventory number and cancels without a penalty", async () => {
    document.cookie = "csrftoken=test-token; path=/";
    let currentBooking = { ...booking, instance: null };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === "/api/v1/auth/me/") return jsonResponse(renter);
      if (path === "/api/v1/bookings/184/cancel/") {
        currentBooking = {
          ...currentBooking,
          status: "CANCELLED",
          cancellation_reason: "Планы изменились",
        };
        return jsonResponse(currentBooking);
      }
      if (path === "/api/v1/bookings/184/") return jsonResponse(currentBooking);
      if (path === "/api/v1/bookings/") return jsonResponse([currentBooking]);
      return jsonResponse([]);
    }));

    renderApp("/account/bookings/184");

    expect(await screen.findByText(/Товар гарантирован до/)).toBeInTheDocument();
    expect(screen.queryByText("D-1042")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Отменить бронь" }));
    const dialog = screen.getByRole("dialog", { name: "Отменить бронь?" });
    expect(within(dialog).getByText(/без штрафа/i)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Отменить бронь" }));

    expect(await screen.findByRole("heading", { name: "Мои брони" })).toBeInTheDocument();
    expect(screen.getByText("Завершённые · 1")).toBeInTheDocument();
  });
});

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

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
