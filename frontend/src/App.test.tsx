import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "./App";

const renter = {
  email: "anna@example.com",
  name: "Анна Смирнова",
  role: "RENTER",
  avatar: null,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.cookie = "csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
});

describe("authentication flow", () => {
  it("shows login when there is no active session", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(unauthenticatedResponse()));

    renderApp("/");

    expect(
      await screen.findByRole("heading", { name: "Вход в аккаунт" }),
    ).toBeInTheDocument();
  });

  it("restores the current user from the cookie session", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(renter)));

    renderApp("/");

    expect(
      await screen.findByRole("heading", {
        name: "Добро пожаловать, Анна Смирнова",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Сессия активна")).toBeInTheDocument();
  });

  it("logs in and sends the CSRF token", async () => {
    document.cookie = "csrftoken=login-token; path=/";
    const fetchMock = vi.fn().mockResolvedValueOnce(unauthenticatedResponse());
    fetchMock.mockResolvedValueOnce(jsonResponse(renter));
    vi.stubGlobal("fetch", fetchMock);
    renderApp("/login");

    fireEvent.change(await screen.findByLabelText("Email"), {
      target: { value: "anna@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Пароль"), {
      target: { value: "Strong-test-pass-937!" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Войти" }));

    expect(
      await screen.findByRole("heading", {
        name: "Добро пожаловать, Анна Смирнова",
      }),
    ).toBeInTheDocument();
    const loginOptions = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(new Headers(loginOptions.headers).get("X-CSRFToken")).toBe(
      "login-token",
    );
  });

  it("registers a manager with the entered profile data", async () => {
    document.cookie = "csrftoken=registration-token; path=/";
    const manager = { ...renter, role: "MANAGER", name: "Илья Петров" };
    const fetchMock = vi.fn().mockResolvedValueOnce(unauthenticatedResponse());
    fetchMock.mockResolvedValueOnce(jsonResponse(manager, 201));
    vi.stubGlobal("fetch", fetchMock);
    renderApp("/register");

    fireEvent.change(await screen.findByLabelText("Имя"), {
      target: { value: "Илья Петров" },
    });
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "ilya@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Пароль"), {
      target: { value: "Strong-test-pass-937!" },
    });
    fireEvent.click(screen.getByLabelText("Менеджер"));
    fireEvent.click(screen.getByRole("button", { name: "Создать аккаунт" }));

    expect(
      await screen.findByRole("heading", {
        name: "Добро пожаловать, Илья Петров",
      }),
    ).toBeInTheDocument();
    const registrationOptions = fetchMock.mock.calls[1]?.[1] as RequestInit;
    const body = registrationOptions.body as FormData;
    expect(body.get("role")).toBe("MANAGER");
    expect(body.get("name")).toBe("Илья Петров");
  });

  it("keeps invalid registration data and shows inline errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(unauthenticatedResponse()));
    renderApp("/register");

    fireEvent.change(await screen.findByLabelText("Имя"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "не-email" },
    });
    fireEvent.change(screen.getByLabelText("Пароль"), {
      target: { value: "123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Создать аккаунт" }));

    expect(
      await screen.findByText("Укажите имя."),
    ).toBeInTheDocument();
    expect(screen.getByText("Введите корректный email.")).toBeInTheDocument();
    expect(screen.getByDisplayValue("не-email")).toBeInTheDocument();
  });

  it("logs out and returns to login", async () => {
    document.cookie = "csrftoken=logout-token; path=/";
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(renter));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    renderApp("/");

    fireEvent.click(await screen.findByRole("button", { name: "Выйти" }));

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Вход в аккаунт" }),
      ).toBeInTheDocument();
    });
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
