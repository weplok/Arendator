import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { NotificationCard } from "../api/notifications";
import { NotificationProvider } from "./NotificationProvider";
import {
  NotificationCenterPage,
  NotificationSettingsPage,
} from "./NotificationPages";
import { NotificationToasts } from "./NotificationToasts";

const renter = {
  email: "marina@example.com",
  name: "Марина Волкова",
  role: "RENTER" as const,
  avatar: null,
};

const notification = {
  id: 7,
  event_type: "BOOKING_CREATED" as const,
  level: "INFO" as const,
  title: "Бронь подтверждена",
  message: "Для заявки назначен экземпляр товара Дрель.",
  target_url: "/account/bookings/2",
  target_label: "К брони",
  is_read: false,
  created_at: "2026-10-03T09:20:00+03:00",
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.cookie = "csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
});

describe("notification center", () => {
  it("marks all notifications read after three seconds on the page", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    document.cookie = "csrftoken=test-token; path=/";
    const fetchMock = notificationFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    renderCenter();

    expect(await screen.findByText("Бронь подтверждена")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(3_000));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/notifications/read-all/",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  it("cancels delayed reading when the page is left early", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    document.cookie = "csrftoken=test-token; path=/";
    const fetchMock = notificationFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    const rendered = renderCenter();
    expect(await screen.findByText("Бронь подтверждена")).toBeInTheDocument();

    rendered.unmount();
    act(() => vi.advanceTimersByTime(3_000));

    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/v1/notifications/read-all/",
      expect.anything(),
    );
  });

  it("removes existing toast cards when the center marks them read", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    document.cookie = "csrftoken=test-token; path=/";
    const fetchMock = notificationFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    const socket = {
      close: vi.fn(),
      onclose: null,
      onerror: null,
      onmessage: null,
      onopen: null,
      readyState: WebSocket.OPEN,
      send: vi.fn(),
    } as unknown as WebSocket;
    const createSocket = vi.fn(() => socket);

    renderCenter(createSocket);
    await waitFor(() => expect(createSocket).toHaveBeenCalledOnce());
    act(() => socket.onopen?.(new Event("open")));
    act(() =>
      socket.onmessage?.(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "notifications.backlog",
            cards: [makeCard(7)],
          }),
        }),
      ),
    );

    const toastRegion = screen.getByRole("region", { name: "Новые уведомления" });
    expect(within(toastRegion).getByRole("article")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(3_000));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/notifications/read-all/",
        expect.objectContaining({ method: "POST" }),
      );
      expect(within(toastRegion).queryByRole("article")).not.toBeInTheDocument();
    });
  });
});

describe("notification toast queue", () => {
  it("shows three cards and exposes the remaining queue", () => {
    const onCloseAll = vi.fn();
    const onRead = vi.fn();
    render(
      <MemoryRouter>
        <NotificationToasts
          cards={[1, 2, 3, 4].map(makeCard)}
          onClose={vi.fn()}
          onCloseAll={onCloseAll}
          onRead={onRead}
          onTarget={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.getAllByRole("article")).toHaveLength(3);
    expect(screen.getByText("И ещё 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Закрыть все" }));
    expect(onCloseAll).toHaveBeenCalledOnce();
    expect(onRead).not.toHaveBeenCalled();
  });

  it("acknowledges only the three rendered cards after a stable frame", () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", notificationFetchMock());
    const socket = {
      close: vi.fn(),
      onclose: null,
      onerror: null,
      onmessage: null,
      onopen: null,
      readyState: WebSocket.OPEN,
      send: vi.fn(),
    } as unknown as WebSocket;
    const createSocket = vi.fn(() => socket);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <NotificationProvider user={renter} createSocket={createSocket}>
            <div>Кабинет</div>
          </NotificationProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(createSocket).toHaveBeenCalledOnce();
    act(() => socket.onopen?.(new Event("open")));
    act(() =>
      socket.onmessage?.(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "notifications.backlog",
            cards: [1, 2, 3, 4].map(makeCard),
          }),
        }),
      ),
    );

    expect(screen.getAllByRole("article")).toHaveLength(3);
    act(() => vi.advanceTimersByTime(2_999));
    expect(socket.send).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(socket.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: "notifications.delivered",
        notification_ids: [1, 2, 3],
      }),
    );
  });

  it("marks one card read from the eye action", () => {
    const onClose = vi.fn();
    const onRead = vi.fn();
    const card = makeCard(1);
    render(
      <MemoryRouter>
        <NotificationToasts
          cards={[card]}
          onClose={onClose}
          onCloseAll={vi.fn()}
          onRead={onRead}
          onTarget={vi.fn()}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Отметить прочитанным" }));

    expect(onRead).toHaveBeenCalledWith(card);
    expect(onClose).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: /Закрыть всплывающее/i }),
    ).not.toBeInTheDocument();
  });

  it("closes one card by swiping it to the right", () => {
    const onClose = vi.fn();
    const card = makeCard(1);
    render(
      <MemoryRouter>
        <NotificationToasts
          cards={[card]}
          onClose={onClose}
          onCloseAll={vi.fn()}
          onRead={vi.fn()}
          onTarget={vi.fn()}
        />
      </MemoryRouter>,
    );

    const toast = screen.getByRole("article");
    fireEvent.pointerDown(toast, { clientX: 10, pointerId: 1 });
    fireEvent.pointerMove(toast, { clientX: 110, pointerId: 1 });
    fireEvent.pointerUp(toast, { clientX: 110, pointerId: 1 });

    expect(onClose).toHaveBeenCalledWith(card.id);
  });

  it("closes a focused card with Escape as a keyboard alternative", () => {
    const onClose = vi.fn();
    const card = makeCard(1);
    render(
      <MemoryRouter>
        <NotificationToasts
          cards={[card]}
          onClose={onClose}
          onCloseAll={vi.fn()}
          onRead={vi.fn()}
          onTarget={vi.fn()}
        />
      </MemoryRouter>,
    );

    const toast = screen.getByRole("article");
    expect(toast).toHaveAttribute("tabindex", "0");
    toast.focus();
    fireEvent.keyDown(toast, { key: "Escape" });

    expect(onClose).toHaveBeenCalledWith(card.id);
  });
});


describe("notification settings", () => {
  it("uses the concise event types heading without a total count", async () => {
    vi.stubGlobal("fetch", notificationFetchMock());

    renderSettings();

    expect(await screen.findByText("Типы событий")).toBeInTheDocument();
    expect(screen.queryByText(/типов уведомлений/i)).not.toBeInTheDocument();
  });
});
function renderCenter(createSocket?: (url: string) => WebSocket | null) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <NotificationProvider
          user={renter}
          createSocket={createSocket ?? (() => null)}
        >
          <NotificationCenterPage />
        </NotificationProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderSettings() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <NotificationProvider user={renter} createSocket={() => null}>
          <NotificationSettingsPage user={renter} />
        </NotificationProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function notificationFetchMock() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path === "/api/v1/notifications/") {
      return jsonResponse({ unread_count: 1, results: [notification] });
    }
    if (path === "/api/v1/notifications/settings/") {
      return jsonResponse({
        sound_enabled: false,
        enabled_events: ["BOOKING_CREATED"],
        available_events: ["BOOKING_CREATED"],
      });
    }
    return jsonResponse({ updated: 1, unread_count: 0 });
  });
}

function makeCard(id: number): NotificationCard {
  return {
    ...notification,
    id,
    notification_ids: [id],
    is_aggregate: false,
  };
}

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
