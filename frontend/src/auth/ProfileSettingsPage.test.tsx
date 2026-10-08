import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CURRENT_USER_QUERY_KEY, type CurrentUser } from "../api/auth";
import { ProfileSettingsPage } from "./ProfileSettingsPage";

const user: CurrentUser = {
  email: "anna@example.com",
  name: "Анна Смирнова",
  role: "RENTER",
  avatar: null,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.cookie = "csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
});

function mockImageEditor(): { drawImage: ReturnType<typeof vi.fn> } {
  const context = {
    clearRect: vi.fn(),
    drawImage: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );
  class MockImage {
    naturalWidth = 1200;
    naturalHeight = 800;
    onload: (() => void) | null = null;

    set src(_value: string) {
      queueMicrotask(() => this.onload?.());
    }
  }
  vi.stubGlobal("Image", MockImage);
  return context;
}

describe("profile settings", () => {
  it("keeps email and role read-only and saves the visible name", async () => {
    document.cookie = "csrftoken=test-token; path=/";
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, options?: RequestInit) => {
      const body = options?.body as FormData;
      return new Response(JSON.stringify({ ...user, name: String(body.get("name")) }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }));

    render(
      <QueryClientProvider client={queryClient}>
        <ProfileSettingsPage user={user} />
      </QueryClientProvider>,
    );

    expect(screen.getByLabelText("Email")).toBeDisabled();
    expect(screen.getByLabelText("Роль")).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: /^Имя/ }), {
      target: { value: "Анна Петрова" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить изменения" }));

    expect(await screen.findByText("Профиль сохранён.")).toBeInTheDocument();
    await waitFor(() => {
      expect(queryClient.getQueryData(CURRENT_USER_QUERY_KEY)).toMatchObject({
        name: "Анна Петрова",
      });
    });
  });

  it("previews the real square crop and allows positioning by drag", async () => {
    const queryClient = new QueryClient();
    const context = mockImageEditor();

    render(
      <QueryClientProvider client={queryClient}>
        <ProfileSettingsPage user={user} />
      </QueryClientProvider>,
    );

    const avatar = new File(["avatar"], "avatar.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Выбрать фотографию для аватара"), {
      target: { files: [avatar] },
    });

    expect(await screen.findByRole("dialog", { name: "Обрезать аватар" })).toBeVisible();
    expect(screen.getByRole("slider", { name: "Масштаб" })).toHaveAttribute(
      "aria-valuemin",
      "1",
    );
    expect(screen.getByRole("slider", { name: "Масштаб" })).toHaveAttribute(
      "aria-valuemax",
      "3",
    );
    expect(
      screen.getByRole("slider", { name: "Положение по горизонтали" }),
    ).toBeVisible();
    expect(
      screen.getByRole("slider", { name: "Положение по вертикали" }),
    ).toBeVisible();
    expect(
      screen.getByText(/Перетаскивайте фото в рамке/),
    ).toBeVisible();

    const preview = await screen.findByRole("img", {
      name: "Предпросмотр обрезки аватара",
    });
    vi.spyOn(preview, "getBoundingClientRect").mockReturnValue({
      width: 360,
      height: 360,
      top: 0,
      right: 360,
      bottom: 360,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    await waitFor(() => expect(context.drawImage).toHaveBeenCalled());
    const initialSourceX = context.drawImage.mock.calls[0][1] as number;

    fireEvent.pointerDown(preview, { pointerId: 1, clientX: 180, clientY: 180 });
    fireEvent.pointerMove(preview, { pointerId: 1, clientX: 240, clientY: 180 });
    fireEvent.pointerUp(preview, { pointerId: 1, clientX: 240, clientY: 180 });

    const horizontalSlider = screen.getByRole("slider", {
      name: "Положение по горизонтали",
    });
    await waitFor(() => {
      expect(Number(horizontalSlider.getAttribute("aria-valuenow"))).toBeLessThan(0);
    });
    const latestSourceX = context.drawImage.mock.lastCall?.[1] as number;
    expect(latestSourceX).toBeLessThan(initialSourceX);
  });
});
