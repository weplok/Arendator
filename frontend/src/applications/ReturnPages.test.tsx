import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RentalDetailPage, RenterRentalsPage } from "./RentalPages";
import { ReturnPage } from "./ReturnPage";

const party = {
  role: "RENTER",
  name: "Анна Смирнова",
  avatar: null,
  comment: "",
  photos: [],
  is_completed: false,
  completed_at: null,
  is_confirmed: false,
  confirmed_at: null,
};

const rental = {
  id: 31,
  booking_id: 184,
  status: "RETURN_INSPECTION",
  minute_rate_snapshot: "8.00",
  starting_price_snapshot: "80.00",
  planned_return_at: "2026-09-27T18:00:00+03:00",
  rental_started_at: "2026-09-25T16:00:00+03:00",
  return_received_at: "2026-09-27T18:24:00+03:00",
  ended_at: null,
  calculated_at: "2026-09-27T18:24:00+03:00",
  duration_minutes: 3024,
  timely_minutes: 3000,
  late_minutes: 24,
  timely_cost: "24000.00",
  late_base_cost: "192.00",
  late_surcharge: "192.00",
  late_surcharge_waived: false,
  late_cost: "384.00",
  damage_amount: "0.00",
  current_cost: "24464.00",
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
  return_act: {
    id: 9,
    renter: party,
    manager: { ...party, role: "MANAGER", name: "Алексей Петров" },
    can_review: false,
    manager_amount_only: false,
    late_surcharge_waived: false,
    late_surcharge_waiver_reason: "",
    late_surcharge_waived_at: null,
    damage_enabled: false,
    damage_description: "",
    damage_amount: "0.00",
    damage_decision: "NONE",
    next_instance_status: "",
    updated_at: "2026-09-27T18:24:00+03:00",
  },
  history: [],
  waiting_applications: [],
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.cookie = "csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
});

describe("return flow", () => {
  it("shows stopped accrual and requires one renter photo", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(rental)));

    renderReturnPage("renter");

    expect(await screen.findByRole("heading", { name: "Перфоратор Bosch" })).toBeInTheDocument();
    expect(screen.getByText("Начисление остановлено")).toBeInTheDocument();
    expect(screen.getByLabelText("Сделать фото")).toHaveAttribute("capture", "environment");
    expect(screen.getByRole("button", { name: "Завершить фиксацию" })).toBeDisabled();
    expect(screen.getByText("Добавьте минимум одно фото")).toBeInTheDocument();
  });

  it("uploads a return photo dropped onto the upload area", async () => {
    document.cookie = "csrftoken=test-token; path=/";
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/return/photos/")) {
        return jsonResponse({ id: 11, url: "/photo/11", created_at: "2026-09-27T18:25:00+03:00" }, 201);
      }
      return jsonResponse(rental);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderReturnPage("renter");
    await screen.findByRole("heading", { name: "Перфоратор Bosch" });

    fireEvent.drop(screen.getByText("Перетащите фото сюда или выберите способ загрузки").parentElement!, {
      dataTransfer: { files: [new File(["photo"], "return.jpg", { type: "image/jpeg" })] },
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/rentals/31/return/photos/",
      expect.objectContaining({ method: "POST", body: expect.any(FormData) }),
    ));
  });

  it("shows the completed rental cost details and actual return time", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(completedRental())));
    renderRentalDetail();

    expect(await screen.findByText(/Просроченные минуты · 24/)).toBeInTheDocument();
    expect(screen.getByText("Штраф за повреждение")).toBeInTheDocument();
    expect(screen.getByText("Фактически вернули")).toBeInTheDocument();
  });

  it("separates completed rentals and opens them from the whole card", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([rental, completedRental()])));
    renderRentalsList();

    fireEvent.click(await screen.findByRole("button", { name: "Завершённые · 1" }));
    const completedLink = screen.getByRole("link", { name: /Аренда завершена/ });
    expect(completedLink).toHaveAttribute("href", "/account/rentals/31");
    expect(completedLink.querySelector(".rental-hero")).toHaveClass("is-completed");
  });

  it("keeps damage and overdue decisions in a separate manager panel", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(rental)));

    renderReturnPage("manager");

    expect(await screen.findByRole("heading", { name: "Расчёт и штрафы" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Отменить повышающий коэффициент просрочки" })).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: "Зафиксировать повреждение" })).toBeEnabled();
    expect(screen.getByText("Реального списания", { exact: false })).toBeInTheDocument();
  });

  it("prefills the maintenance reason from the damage description", async () => {
    document.cookie = "csrftoken=test-token; path=/";
    const reviewed = agreedRental();
    let submittedBody = "";
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      if (String(input).endsWith("/return/finish/")) submittedBody = String(options?.body);
      return jsonResponse(reviewed);
    }));
    renderReturnPage("manager");

    await screen.findByRole("heading", { name: "Согласование результатов" });
    fireEvent.click(screen.getByRole("radio", { name: "На обслуживании" }));
    fireEvent.click(screen.getByRole("button", { name: "Завершить возврат" }));

    const reason = screen.getByRole("textbox", { name: "Причина обслуживания" });
    expect(reason).toHaveValue("Трещина на корпусе");
    fireEvent.click(screen.getByRole("button", { name: "Отправить на обслуживание" }));
    await waitFor(() => expect(submittedBody).toContain(
      '"maintenance_reason":"Трещина на корпусе"',
    ));
    expect(await screen.findByRole("heading", { name: "Отправлено на обслуживание" })).toBeInTheDocument();
    expect(screen.getByText("Экземпляр исключён из доступности", { exact: false })).toBeInTheDocument();
  });

  it("requires manager agreement before exposing the instance state", async () => {
    document.cookie = "csrftoken=test-token; path=/";
    const reviewed = reviewRental();
    const managerConfirmed = {
      ...reviewed,
      return_act: {
        ...reviewed.return_act,
        manager: {
          ...reviewed.return_act.manager,
          is_confirmed: true,
          confirmed_at: "2026-09-27T18:31:00+03:00",
        },
      },
    };
    let current: unknown = reviewed;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/return/confirm/")) current = managerConfirmed;
      return jsonResponse(current);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderReturnPage("manager");

    expect(await screen.findByRole("button", { name: "Согласиться с результатами возврата" })).toBeEnabled();
    expect(screen.queryByRole("radio", { name: "Доступен" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Согласиться с результатами возврата" }));

    expect(await screen.findByText("Ожидаем согласия арендатора.")).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Доступен" })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/rentals/31/return/confirm/",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("keeps renter in the return flow until the manager finishes it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(agreedRental())));

    renderReturnPage("renter");

    expect(await screen.findByText("Ожидаем завершения возврата менеджером.")).toBeInTheDocument();
    expect(screen.queryByText("Возврат завершён")).not.toBeInTheDocument();
  });

  it("lets renter explicitly reject the current damage amount", async () => {
    document.cookie = "csrftoken=test-token; path=/";
    const reviewed = reviewRental();
    const rejected = {
      ...reviewed,
      return_act: {
        ...reviewed.return_act,
        can_review: false,
        manager_amount_only: true,
        damage_decision: "REJECTED",
        manager: {
          ...reviewed.return_act.manager,
          is_completed: false,
          completed_at: null,
        },
      },
    };
    let current: unknown = reviewed;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("damage-decision")) {
        current = rejected;
      }
      return jsonResponse(current);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderReturnPage("renter");

    fireEvent.click(await screen.findByRole("button", { name: "Отказаться от штрафа" }));

    expect(await screen.findByText("Вы отказались от штрафа. Ожидайте новую сумму от менеджера.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Сохранить новую сумму" })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/rentals/31/return/damage-decision/",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ accepted: false }) }),
    );
  });

  it("locks everything except the amount after rejection", async () => {
    const reviewed = reviewRental();
    const amountOnly = {
      ...reviewed,
      return_act: {
        ...reviewed.return_act,
        can_review: false,
        manager_amount_only: true,
        damage_decision: "REJECTED",
        manager: {
          ...reviewed.return_act.manager,
          is_completed: false,
          completed_at: null,
        },
      },
    };
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(amountOnly)));
    renderReturnPage("manager");

    expect(await screen.findByText("Арендатор отказался от штрафа", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Описание повреждения" })).toBeDisabled();
    expect(screen.getByRole("spinbutton", { name: "Сумма штрафа, ₽" })).toBeEnabled();
    expect(screen.queryByLabelText("Сделать фото")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Сохранить новую сумму" })).toBeEnabled();
  });

  it("explains the consequence before manager stops accrual", async () => {
    const active = {
      ...rental,
      status: "OVERDUE",
      return_received_at: null,
      return_act: null,
    };
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(active)));
    renderRentalDetail();

    fireEvent.click(await screen.findByRole("button", { name: "Оборудование принесено на возврат" }));

    expect(screen.getByRole("dialog", { name: "Подтвердить физический возврат?" })).toBeInTheDocument();
    expect(screen.getByText("Осмотр и фотофиксация не оплачиваются", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Отмена" })).toBeInTheDocument();
  });
});

function reviewRental() {
  return {
    ...rental,
    damage_amount: "500.00",
    current_cost: "24964.00",
    return_act: {
      ...rental.return_act,
      can_review: true,
      damage_enabled: true,
      damage_description: "Трещина на корпусе",
      damage_amount: "500.00",
      damage_decision: "PENDING",
      renter: {
        ...rental.return_act.renter,
        photos: [{ id: 1, url: "/photo/1", created_at: "2026-09-27T18:26:00+03:00" }],
        is_completed: true,
        completed_at: "2026-09-27T18:27:00+03:00",
      },
      manager: {
        ...rental.return_act.manager,
        photos: [{ id: 2, url: "/photo/2", created_at: "2026-09-27T18:28:00+03:00" }],
        is_completed: true,
        completed_at: "2026-09-27T18:29:00+03:00",
      },
    },
  };
}

function agreedRental() {
  const reviewed = reviewRental();
  return {
    ...reviewed,
    return_act: {
      ...reviewed.return_act,
      damage_decision: "ACCEPTED",
      renter: {
        ...reviewed.return_act.renter,
        is_confirmed: true,
        confirmed_at: "2026-09-27T18:30:00+03:00",
      },
      manager: {
        ...reviewed.return_act.manager,
        is_confirmed: true,
        confirmed_at: "2026-09-27T18:31:00+03:00",
      },
    },
  };
}

function completedRental() {
  return {
    ...rental,
    status: "COMPLETED",
    damage_amount: "500.00",
    current_cost: "24964.00",
    ended_at: "2026-09-27T18:40:00+03:00",
    return_act: reviewRental().return_act,
  };
}

function renderReturnPage(audience: "manager" | "renter"): void {
  const path = audience === "manager"
    ? "/manager/rentals/31/return"
    : "/account/rentals/31/return";
  renderWithRouter(
    path,
    audience === "manager"
      ? "/manager/rentals/:rentalId/return"
      : "/account/rentals/:rentalId/return",
    <ReturnPage audience={audience} />,
  );
}

function renderRentalDetail(): void {
  renderWithRouter(
    "/manager/rentals/31",
    "/manager/rentals/:rentalId",
    <RentalDetailPage audience="manager" />,
  );
}

function renderRentalsList(): void {
  renderWithRouter(
    "/account/rentals",
    "/account/rentals",
    <RenterRentalsPage />,
  );
}

function renderWithRouter(path: string, route: string, element: React.ReactNode): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path={route} element={element} /></Routes>
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
