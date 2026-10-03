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

it("opens the published product overview and expands instance history", async () => {
  const published = {
    ...product,
    status: "PUBLISHED",
    published_at: "2026-09-20T10:00:00+03:00",
    description: "Профессиональная дрель для продолжительных работ и точного сверления.",
    pickup_point: {
      city: "Москва", district: "Хамовники", full_address: "ул. Усачёва, 22",
      latitude: "55.730000", longitude: "37.570000", yandex_maps_url: "https://yandex.ru/maps/",
    },
    photos: [{ id: 20, url: "/drill.jpg", display_order: 0, is_primary: true }],
    instances: [{
      id: "20a3d31e-7121-42e8-ad38-fecfbed13c11",
      inventory_number: "MK-014", status: "MAINTENANCE",
      created_at: "2026-05-21T10:00:00+03:00", repair_total: "750.00",
      history_count: 2, active_maintenance: null,
      history: [{
        id: 4, kind: "MAINTENANCE", reason: "Ремонт корпуса",
        damage_description: "Корпус закреплён", repair_cost: "750.00",
        started_at: "2026-06-02T10:00:00+03:00",
        completed_at: "2026-06-03T10:00:00+03:00",
        occurred_at: "2026-06-03T10:00:00+03:00",
        source_return_id: null, photos: [],
      }, {
        id: 3, kind: "MAINTENANCE", reason: "Замена патрона",
        damage_description: "Патрон заменён", repair_cost: "0.00",
        started_at: "2026-05-02T10:00:00+03:00",
        completed_at: "2026-05-03T10:00:00+03:00",
        occurred_at: "2026-05-03T10:00:00+03:00",
        source_return_id: 9, photos: [
          { id: 31, url: "/repair-1.jpg", created_at: "2026-05-03T10:00:00+03:00" },
          { id: 32, url: "/repair-2.jpg", created_at: "2026-05-03T10:01:00+03:00" },
        ],
      }],
    }],
    available_instances_count: 0,
  };
  vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => Promise.resolve(
    Response.json(url.includes("auth/me") ? manager : url.endsWith("/8/") ? published : [published]),
  )));

  renderPage("/manager/products");
  fireEvent.click(await screen.findByRole("link", { name: "Открыть Дрель" }));

  expect(
    await screen.findByRole("heading", { name: "Дрель", level: 1 }),
  ).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Редактировать" })).toHaveAttribute(
    "href", "/manager/products/8/basic",
  );
  fireEvent.click(screen.getByRole("button", { name: /MK-014/ }));
  expect(screen.getByText("Ремонт корпуса")).toBeInTheDocument();
  expect(screen.getByText("Фотоакт не проводился")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Фотоакт не проводился/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Открыть фотоакт обслуживания/ }));
  expect(screen.getByRole("dialog", { name: "Фотоакт обслуживания" })).toBeInTheDocument();
  expect(screen.getByText("1 из 2")).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowRight" });
  expect(screen.getByText("2 из 2")).toBeInTheDocument();
});

it("searches an instance by exact inventory number and offers maintenance", async () => {
  document.cookie = "csrftoken=manager-token; path=/";
  const found = {
    id: "20a3d31e-7121-42e8-ad38-fecfbed13c11",
    inventory_number: "MK-014", status: "AVAILABLE",
    created_at: "2026-05-21T10:00:00+03:00",
    repair_total: "0.00", history_count: 0, history: [], active_maintenance: null,
    product: { id: 8, name: "Дрель" },
  };
  vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
    if (url.includes("auth/me")) return Promise.resolve(Response.json(manager));
    if (url.includes("instances/search")) return Promise.resolve(Response.json(found));
    return Promise.resolve(Response.json([product]));
  }));

  renderPage("/manager/products");
  fireEvent.click(await screen.findByRole("button", { name: "Найти экземпляр" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Инвентарный номер" }), {
    target: { value: "MK-014" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Найти" }));

  expect(await screen.findByText("Свободен")).toBeInTheDocument();
  expect(screen.getByText("Дрель · MK-014")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Отправить на обслуживание" })).toBeInTheDocument();
});

it("keeps the completion success state after returning an instance to service", async () => {
  document.cookie = "csrftoken=manager-token; path=/";
  const activeMaintenance = {
    id: 41,
    reason: "Трещина на корпусе",
    damage_description: "Трещина на корпусе",
    repair_cost: null,
    started_at: "2026-09-20T10:00:00+03:00",
    completed_at: null,
    source_return_id: null,
    photos: [],
  };
  const found = {
    id: "20a3d31e-7121-42e8-ad38-fecfbed13c11",
    inventory_number: "MK-014",
    status: "MAINTENANCE",
    created_at: "2026-05-21T10:00:00+03:00",
    repair_total: "0.00",
    history_count: 1,
    history: [],
    active_maintenance: activeMaintenance,
    product: { id: 8, name: "Дрель" },
  };
  vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
    if (url.includes("auth/me")) return Promise.resolve(Response.json(manager));
    if (url.includes("instances/search")) return Promise.resolve(Response.json(found));
    if (url.includes("maintenances/41/complete")) {
      return Promise.resolve(Response.json({
        ...activeMaintenance,
        damage_description: "Корпус заменён",
        repair_cost: "640.00",
        completed_at: "2026-09-21T10:00:00+03:00",
      }));
    }
    return Promise.resolve(Response.json([product]));
  }));

  renderPage("/manager/products");
  fireEvent.click(await screen.findByRole("button", { name: "Найти экземпляр" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Инвентарный номер" }), {
    target: { value: "MK-014" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Найти" }));
  fireEvent.click(await screen.findByRole("button", { name: "Завершить обслуживание" }));
  expect(screen.queryByRole("dialog", { name: "Найти экземпляр" })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("spinbutton", { name: "Стоимость ремонта, ₽" }), {
    target: { value: "640" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Описание повреждения" }), {
    target: { value: "Корпус заменён" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Завершить обслуживание" }));

  expect(await screen.findByText("Обслуживание завершено", { exact: true })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Вернуться к товарам" })).toBeInTheDocument();
});

it("creates a draft then opens its photo step", async () => {
  document.cookie = "csrftoken=manager-token; path=/";
  const requests: { url: string; options?: RequestInit }[] = [];
  const childCategory = { ...category, id: 2, parent_id: 1, name: "Дрели" };
  vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string, options?: RequestInit) => {
    requests.push({ url, options });
    if (url.includes("auth/me")) return Promise.resolve(Response.json(manager));
    if (url.includes("categories")) return Promise.resolve(Response.json([category, childCategory]));
    if (options?.method === "POST") return Promise.resolve(Response.json(product, { status: 201 }));
    if (url.endsWith("/8/")) return Promise.resolve(Response.json(product));
    return Promise.resolve(Response.json([]));
  }));
  renderPage("/manager/products/new");
  await screen.findByRole("heading", { name: "Новый товар" });
  const rootCategorySelect = await screen.findByRole("combobox", { name: /^Основная категория/ });
  expect(rootCategorySelect).toHaveValue("");
  expect(rootCategorySelect.querySelector("option:checked")).toBeEmptyDOMElement();
  fireEvent.change(rootCategorySelect, { target: { value: "1" } });
  fireEvent.change(await screen.findByRole("combobox", { name: /^Подкатегория/ }), { target: { value: "2" } });
  fireEvent.change(screen.getByRole("textbox", { name: /^Название/ }), { target: { value: "Дрель" } });
  fireEvent.change(screen.getByRole("textbox", { name: /^Описание/ }), { target: { value: "Для ремонта" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: /^Ставка/ }), { target: { value: "3" } });
  fireEvent.click(screen.getByRole("button", { name: "Сохранить и продолжить" }));
  expect(await screen.findByRole("heading", { name: "Фотографии товара" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Отправить на модерацию" })).toBeDisabled();
  expect(screen.getByText("Заполните основные сведения о товаре, прежде чем отправить на модерацию")).toBeInTheDocument();
  await waitFor(() => expect(requests.some(({ url, options }) =>
    url === "/api/v1/manager/products/" && options?.method === "POST" &&
    new Headers(options.headers).get("X-CSRFToken") === "manager-token" &&
    JSON.parse(String(options.body)).category === 2,
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
  const freezeButton = await screen.findByRole("button", { name: "Заморозить" });
  expect(freezeButton.closest(".manager-editor-status-actions")).not.toBeNull();
  fireEvent.click(freezeButton);
  expect(screen.getByRole("dialog", { name: "Заморозить товар?" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Заморозить товар" }));
  expect(await screen.findByRole("heading", { name: "Архив товаров" })).toBeInTheDocument();
  expect(frozen).toBe(true);
});

it("keeps rejected category editable and shows the rejection dialog only once", async () => {
  const rejected = {
    ...product,
    status: "REJECTED",
    rejection_reason: "Выберите точную категорию.",
  };
  const childCategory = { ...category, id: 2, parent_id: 1, name: "Дрели" };
  vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
    if (url.includes("auth/me")) return Promise.resolve(Response.json(manager));
    if (url.includes("categories")) return Promise.resolve(Response.json([category, childCategory]));
    if (url.includes("characteristics")) return Promise.resolve(Response.json([]));
    if (url.endsWith("/8/")) return Promise.resolve(Response.json(rejected));
    return Promise.resolve(Response.json([rejected]));
  }));

  renderPage("/manager/products/8/basic");
  fireEvent.click(await screen.findByRole("button", { name: "Перейти к редактированию" }));

  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Карточка отклонена" })).not.toBeInTheDocument());
  expect(screen.getByRole("combobox", { name: "Основная категория" })).toBeEnabled();
  fireEvent.click(screen.getByRole("link", { name: "Фото" }));
  expect(await screen.findByRole("heading", { name: "Фотографии товара" })).toBeInTheDocument();
  expect(screen.queryByRole("dialog", { name: "Карточка отклонена" })).not.toBeInTheDocument();
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
  const submitButton = await screen.findByRole("button", { name: "Отправить на модерацию" });
  expect(submitButton.closest(".manager-checklist")).not.toBeNull();
  expect(screen.queryByText("Заполните основные сведения о товаре, прежде чем отправить на модерацию")).not.toBeInTheDocument();
  fireEvent.click(submitButton);

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

it("keeps an empty characteristic select visually blank", async () => {
  const categoryWithCharacteristics = {
    ...category,
    characteristics: [{
      id: 12, category_id: 1, name: "Производитель", type: "LIST",
      is_required: false, unit: "", display_order: 0,
      options: [{ id: 101, value: "Bosch", display_order: 0 }],
    }],
  };
  vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
    if (url.includes("auth/me")) return Promise.resolve(Response.json(manager));
    if (url.includes("categories")) {
      return Promise.resolve(Response.json([categoryWithCharacteristics]));
    }
    if (url.includes("characteristics")) return Promise.resolve(Response.json([]));
    if (url.endsWith("/8/")) return Promise.resolve(Response.json(product));
    return Promise.resolve(Response.json([product]));
  }));

  renderPage("/manager/products/8/features");

  const manufacturerSelect = await screen.findByRole("combobox", {
    name: "Производитель",
  });
  expect(manufacturerSelect).toHaveValue("");
  expect(manufacturerSelect.querySelector("option:checked")).toBeEmptyDOMElement();
});

it("moves a selected photo to the first position", async () => {
  document.cookie = "csrftoken=manager-token; path=/";
  const photos = [
    { id: 20, url: "/first.jpg", display_order: 0, is_primary: true },
    { id: 21, url: "/second.jpg", display_order: 1, is_primary: false },
  ];
  let currentProduct = { ...product, photos };
  let uploadedFileName = "";
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
    if (url.endsWith("photos/") && options?.method === "POST") {
      uploadedFileName = (options.body as FormData).get("image") instanceof File
        ? ((options.body as FormData).get("image") as File).name
        : "";
      return Promise.resolve(Response.json({}));
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
  fireEvent.drop(screen.getByText("Перетащите фотографии сюда или выберите файлы").parentElement!, {
    dataTransfer: { files: [new File(["photo"], "drill.png", { type: "image/png" })] },
  });
  await waitFor(() => expect(uploadedFileName).toBe("drill.png"));
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
