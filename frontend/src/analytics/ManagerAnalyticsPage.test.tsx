import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";

import { ManagerAnalyticsPage } from "./ManagerAnalyticsPage";

const analytics = {
  period: { key: "week", date_from: "2026-09-27", date_to: "2026-10-03", label: "27 сентября 2026 — 3 октября 2026", days: 7, timezone: "Europe/Moscow" },
  snapshot_at: "2026-10-04T12:00:00+03:00",
  snapshot_label: "04.10.2026, 12:00 МСК",
  financials: { rental_income: "1000.00", overdue_income: "200.00", damage_income: "50.00", income: "1250.00", completed_rentals: 4, expenses: "300.00", completed_maintenances: 2, net: "950.00" },
  utilization: { average_percent: 62.5, daily: [{ date: "2026-10-03", label: "03.10", percent: 62.5 }] },
  active_overdues: { rentals: 2, products: 1 },
  park: { total: 5, in_work: 3, items: [{ key: "available", label: "Доступно", count: 2 }, { key: "reserved", label: "Забронировано", count: 1 }, { key: "rented", label: "В аренде", count: 1 }, { key: "return_inspection", label: "На осмотре", count: 1 }, { key: "maintenance", label: "Обслуживание", count: 0 }] },
  categories: [{ id: 1, name: "Инструменты", income: "1250.00", completed_rentals: 4 }],
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("renders scoped KPI, three chart types, units, and table alternatives", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(analytics)));
  renderPage("/manager/analytics?period=week");

  expect(await screen.findByText("Расчётный итог")).toBeInTheDocument();
  expect(screen.getByText("+950 ₽")).toBeInTheDocument();
  expect(screen.getByRole("img", { name: /Столбчатая диаграмма/ })).toBeInTheDocument();
  expect(screen.getByRole("img", { name: /Кольцевая диаграмма/ })).toBeInTheDocument();
  expect(screen.getByRole("img", { name: /Линейная диаграмма/ })).toBeInTheDocument();
  expect(screen.getByText("27 сентября 2026 — 3 октября 2026 · ₽")).toBeInTheDocument();
  expect(screen.getByText("Таблица дохода по категориям")).toBeInTheDocument();
  expect(screen.getByText("Таблица состояния парка")).toBeInTheDocument();
  expect(screen.getByText("Таблица загрузки по дням")).toBeInTheDocument();
});

it("requests an inclusive custom date range after explicit submit", async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json({
    ...analytics,
    period: { ...analytics.period, key: "custom" },
  }));
  vi.stubGlobal("fetch", fetchMock);
  renderPage("/manager/analytics?period=custom&date_from=2026-09-05&date_to=2026-10-04");
  await screen.findByText("Расчётный итог");

  fireEvent.change(screen.getByLabelText(/Дата от/), { target: { value: "2026-09-10" } });
  fireEvent.click(screen.getByRole("button", { name: "Показать" }));

  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
    "/api/v1/manager/analytics/?period=custom&date_from=2026-09-10&date_to=2026-10-04",
    expect.objectContaining({ credentials: "include" }),
  ));
});

it("replaces stale metrics with a retryable error", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
    code: "api_error", message: "Ошибка", field_errors: {},
  }), { status: 500, headers: { "Content-Type": "application/json" } })));
  renderPage("/manager/analytics");

  expect(await screen.findByText("Не удалось загрузить аналитику. Проверьте соединение и повторите.")).toBeInTheDocument();
  expect(screen.queryByText("Расчётный итог")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Повторить" })).toBeInTheDocument();
});

function renderPage(path: string): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><Routes><Route path="/manager/analytics" element={<ManagerAnalyticsPage />} /></Routes></MemoryRouter></QueryClientProvider>);
}
