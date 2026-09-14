import { z } from "zod";

const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  field_errors: z.record(z.string(), z.array(z.string())),
});

type RequestOptions = Omit<RequestInit, "credentials">;

export class ApiError extends Error {
  readonly code: string;
  readonly fieldErrors: Record<string, string[]>;
  readonly status: number;

  constructor(status: number, payload: z.infer<typeof apiErrorSchema>) {
    super(payload.message);
    this.name = "ApiError";
    this.status = status;
    this.code = payload.code;
    this.fieldErrors = payload.field_errors;
  }
}

export async function getJson(path: string): Promise<unknown> {
  return requestJson(path, {
    headers: { Accept: "application/json" },
  });
}

export async function postJson(
  path: string,
  body?: BodyInit,
): Promise<unknown> {
  const csrfToken = await getCsrfToken();
  const headers = new Headers({
    Accept: "application/json",
    "X-CSRFToken": csrfToken,
  });
  if (typeof body === "string") {
    headers.set("Content-Type", "application/json");
  }
  return requestJson(path, { method: "POST", body, headers });
}

async function requestJson(
  path: string,
  options: RequestOptions,
): Promise<unknown> {
  const response = await fetch(path, { ...options, credentials: "include" });
  if (!response.ok) {
    throw await createApiError(response);
  }
  if (response.status === 204) {
    return undefined;
  }
  return response.json();
}

async function getCsrfToken(): Promise<string> {
  const existingToken = readCookie("csrftoken");
  if (existingToken) {
    return existingToken;
  }

  await requestJson("/api/v1/auth/csrf/", {
    headers: { Accept: "application/json" },
  });
  const initializedToken = readCookie("csrftoken");
  if (!initializedToken) {
    throw new Error("Backend не установил CSRF cookie.");
  }
  return initializedToken;
}

async function createApiError(response: Response): Promise<ApiError> {
  try {
    const payload = apiErrorSchema.parse(await response.json());
    return new ApiError(response.status, payload);
  } catch {
    return new ApiError(response.status, {
      code: "unexpected_response",
      message: "Сервер вернул непредвиденный ответ.",
      field_errors: {},
    });
  }
}

function readCookie(name: string): string | undefined {
  const prefix = `${encodeURIComponent(name)}=`;
  return document.cookie
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(prefix))
    ?.slice(prefix.length);
}
