import { z } from "zod";

import { ApiError, getJson, postJson } from "./client";

export const registrationRoleSchema = z.enum(["RENTER", "MANAGER"]);
const accountRoleSchema = z.enum(["RENTER", "MANAGER", "ADMIN"]);

export const currentUserSchema = z.object({
  email: z.email(),
  name: z.string(),
  role: accountRoleSchema,
  avatar: z.string().nullable(),
});

export type CurrentUser = z.infer<typeof currentUserSchema>;
export type RegistrationRole = z.infer<typeof registrationRoleSchema>;

export interface LoginInput {
  email: string;
  password: string;
}

export interface RegistrationInput extends LoginInput {
  name: string;
  role: RegistrationRole;
  avatar?: File;
}

export const CURRENT_USER_QUERY_KEY = ["auth", "current-user"] as const;

export async function getCurrentUser(): Promise<CurrentUser | null> {
  try {
    return currentUserSchema.parse(await getJson("/api/v1/auth/me/"));
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return null;
    }
    throw error;
  }
}

export async function login(input: LoginInput): Promise<CurrentUser> {
  const payload = JSON.stringify(input);
  return currentUserSchema.parse(await postJson("/api/v1/auth/login/", payload));
}

export async function registerUser(
  input: RegistrationInput,
): Promise<CurrentUser> {
  const formData = new FormData();
  formData.set("email", input.email);
  formData.set("password", input.password);
  formData.set("name", input.name);
  formData.set("role", input.role);
  if (input.avatar) {
    formData.set("avatar", input.avatar);
  }
  return currentUserSchema.parse(
    await postJson("/api/v1/auth/register/", formData),
  );
}

export async function logout(): Promise<void> {
  await postJson("/api/v1/auth/logout/");
}
