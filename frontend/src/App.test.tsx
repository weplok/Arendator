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
  it("shows login when a guest opens the login page", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(unauthenticatedResponse()));

    renderApp("/login");

    expect(
      await screen.findByRole("heading", { name: "Вход в аккаунт" }),
    ).toBeInTheDocument();
  });

  it("restores the current user from the cookie session", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(renter)));

    renderApp("/account");

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

  it("logs out and returns to the public catalog", async () => {
    document.cookie = "csrftoken=logout-token; path=/";
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(renter));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValueOnce(jsonResponse({
      count: 0,
      next: null,
      previous: null,
      results: [],
    }));
    renderApp("/account");

    fireEvent.click(await screen.findByRole("button", { name: "Выйти" }));

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Каталог оборудования" }),
      ).toBeInTheDocument();
    });
  });
});

describe("category tree", () => {
  it("announces category loading", () => {
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => undefined)));

    renderApp("/categories");

    expect(screen.getByRole("status")).toHaveTextContent("Загрузка категорий");
  });

  it("renders categories with their hierarchy", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse([
          {
            id: 1,
            name: "Инструменты",
            parent_id: null,
            characteristics: [],
          },
          {
            id: 2,
            name: "Электроинструменты",
            parent_id: 1,
            characteristics: [],
          },
          {
            id: 3,
            name: "Дрели",
            parent_id: 2,
            characteristics: [],
          },
        ]),
      ),
    );

    renderApp("/categories");

    expect(await screen.findByText("Инструменты")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Дерево категорий" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Электроинструменты")).toBeInTheDocument();
    expect(screen.getByText("Дрели")).toBeInTheDocument();
    expect(screen.getAllByRole("list")).toHaveLength(3);
  });

  it("shows an empty state when no categories exist", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse([])));

    renderApp("/categories");

    expect(
      await screen.findByText("Категории пока не созданы."),
    ).toBeInTheDocument();
  });

  it("shows an error and retry action when loading fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 500 })),
    );

    renderApp("/categories");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Не удалось загрузить категории.",
    );
    expect(screen.getByRole("button", { name: "Повторить" })).toBeEnabled();
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
