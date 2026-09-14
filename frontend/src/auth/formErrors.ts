import type { FieldValues, Path, UseFormSetError } from "react-hook-form";

import { ApiError } from "../api/client";

export function applyApiFieldErrors<TFields extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<TFields>,
  supportedFields: readonly Path<TFields>[],
): void {
  if (!(error instanceof ApiError)) {
    return;
  }
  for (const field of supportedFields) {
    const message = error.fieldErrors[field]?.[0];
    if (message) {
      setError(field, { type: "server", message });
    }
  }
}

export function getSubmitErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  return "Не удалось связаться с сервером. Повторите попытку.";
}
