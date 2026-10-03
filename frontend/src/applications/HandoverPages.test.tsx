import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HandoverPage } from "./HandoverPage";

const booking = {
  id: 184,
  application_id: 42,
  status: "ARRIVED",
  pickup_deadline_at: "2026-09-25T18:00:00+03:00",
  planned_return_at: "2026-09-27T18:00:00+03:00",
  minute_rate_snapshot: "8.00",
  starting_price_snapshot: "80.00",
  arrival_confirmed_at: "2026-09-25T16:00:00+03:00",
  cancellation_reason: "",
  ended_at: null,
  created_at: "2026-09-24T12:24:00+03:00",
  updated_at: "2026-09-25T16:00:00+03:00",
  product: {
    id: 7,
    name: "Перфоратор Bosch",
    description: "Инструмент",
    minute_rate: "8.00",
    primary_photo: null,
    pickup_point: {
      city: "Москва",
      district: "Хамовники",
      full_address: "ул. Усачёва, 22",
    },
    available_instances_count: 0,
    total_instances_count: 1,
  },
  renter: { id: 8, name: "Анна Смирнова", avatar: null },
  manager: { id: 4, name: "Алексей Петров", avatar: null },
  instance: null,
  handover: {
    id: 12,
    renter: {
      role: "RENTER",
      name: "Анна Смирнова",
      avatar: null,
      comment: "",
      photos: [],
      is_completed: false,
      completed_at: null,
      is_confirmed: false,
      confirmed_at: null,
    },
    manager: {
      role: "MANAGER",
      name: "Алексей Петров",
      avatar: null,
      comment: "Без замечаний",
      photos: [],
      is_completed: true,
      completed_at: "2026-09-25T16:05:00+03:00",
      is_confirmed: false,
      confirmed_at: null,
    },
    can_review: false,
    updated_at: "2026-09-25T16:05:00+03:00",
  },
  rental: null,
  history: [],
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.cookie = "csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
});

describe("handover", () => {
  it("keeps renter completion disabled until two photos exist", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(booking)));

    renderPage("renter");

    expect(await screen.findByRole("heading", { name: "Фиксация состояния" })).toBeInTheDocument();
    expect(screen.getByLabelText("Сделать фото")).toHaveAttribute("capture", "environment");
    expect(screen.getByRole("button", { name: "Завершить фиксацию" })).toBeDisabled();
    expect(screen.getByText("Добавьте ещё 2 фото")).toBeInTheDocument();
    expect(screen.getByText("Без замечаний")).toBeInTheDocument();
  });

  it("uploads dropped files independently and preserves a failed file for retry", async () => {
    document.cookie = "csrftoken=test-token; path=/";
    let uploads = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith("/photos/")) {
        uploads += 1;
        return uploads === 1
          ? jsonResponse({ id: 1, url: "/photo/1", created_at: "2026-09-25T16:10:00+03:00" }, 201)
          : jsonResponse({ code: "api_error", message: "Ошибка", field_errors: {} }, 500);
      }
      return jsonResponse(booking);
    }));
    renderPage("renter");
    await screen.findByRole("heading", { name: "Фиксация состояния" });

    const files = [
      new File(["first"], "first.png", { type: "image/png" }),
      new File(["second"], "second.png", { type: "image/png" }),
    ];
    fireEvent.drop(screen.getByText("Перетащите фото сюда или выберите способ загрузки").parentElement!, {
      dataTransfer: { files },
    });

    expect(await screen.findByText("Не удалось загрузить second.png")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Повторить загрузку second.png" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Сохранить комментарий" })).not.toBeInTheDocument();
  });

  it("shows review actions only after both sets are completed", async () => {
    const reviewBooking = {
      ...booking,
      handover: {
        ...booking.handover,
        renter: {
          ...booking.handover.renter,
          photos: [
            { id: 1, url: "/photo/1", created_at: "2026-09-25T16:10:00+03:00" },
            { id: 2, url: "/photo/2", created_at: "2026-09-25T16:11:00+03:00" },
          ],
          is_completed: true,
          completed_at: "2026-09-25T16:12:00+03:00",
        },
        can_review: true,
      },
    };
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(reviewBooking)));

    renderPage("manager");

    expect(await screen.findByRole("button", { name: "Подтвердить фиксацию" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Попросить арендатора изменить" })).toBeInTheDocument();
  });

  it("keeps the completed party photos and comment visible", async () => {
    const completedBooking = {
      ...booking,
      handover: {
        ...booking.handover,
        renter: {
          ...booking.handover.renter,
          comment: "Корпус без повреждений",
          photos: [
            { id: 1, url: "/photo/1", created_at: "2026-09-25T16:10:00+03:00" },
            { id: 2, url: "/photo/2", created_at: "2026-09-25T16:11:00+03:00" },
          ],
          is_completed: true,
          completed_at: "2026-09-25T16:12:00+03:00",
        },
      },
    };
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(completedBooking)));

    renderPage("renter");

    expect(await screen.findByRole("button", { name: "Открыть фотография 1, анна смирнова" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Открыть фотография 2, анна смирнова" })).toBeInTheDocument();
    expect(screen.getByText("Корпус без повреждений")).toBeInTheDocument();
  });
});

function renderPage(audience: "manager" | "renter"): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const path = audience === "manager"
    ? "/manager/bookings/184/handover"
    : "/account/bookings/184/handover";
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path={audience === "manager"
              ? "/manager/bookings/:bookingId/handover"
              : "/account/bookings/:bookingId/handover"}
            element={<HandoverPage audience={audience} />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
