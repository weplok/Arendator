import { zodResolver } from "@hookform/resolvers/zod";
import { Alert, Button, Link, Stack, TextField, Typography } from "@mui/material";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import { z } from "zod";

import { CURRENT_USER_QUERY_KEY, login } from "../api/auth";
import { AuthLayout } from "./AuthLayout";
import { applyApiFieldErrors, getSubmitErrorMessage } from "./formErrors";

const loginFormSchema = z.object({
  email: z.email("Введите корректный email."),
  password: z.string().min(1, "Введите пароль."),
});

type LoginFormValues = z.infer<typeof loginFormSchema>;
const LOGIN_FIELDS: readonly (keyof LoginFormValues)[] = ["email", "password"];

export function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginFormSchema),
    defaultValues: { email: "", password: "" },
  });
  const loginMutation = useMutation({
    mutationFn: login,
    onSuccess: (user) => {
      queryClient.setQueryData(CURRENT_USER_QUERY_KEY, user);
      navigate("/", { replace: true });
    },
  });

  useEffect(() => {
    if (loginMutation.isError) {
      errorSummaryRef.current?.focus();
    }
  }, [loginMutation.isError]);

  async function submit(values: LoginFormValues): Promise<void> {
    try {
      await loginMutation.mutateAsync(values);
    } catch (error) {
      applyApiFieldErrors(error, form.setError, LOGIN_FIELDS);
    }
  }

  return (
    <AuthLayout>
      <Stack spacing={3} sx={{ width: "100%", maxWidth: 430 }}>
        <header>
          <Typography component="p" color="primary" sx={{ fontWeight: 700 }}>
            С возвращением
          </Typography>
          <Typography component="h2" variant="h4" sx={{ mt: 1 }}>
            Вход в аккаунт
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 1 }}>
            Продолжите работу со своими заявками и оборудованием.
          </Typography>
        </header>

        {loginMutation.isError ? (
          <Alert ref={errorSummaryRef} tabIndex={-1} severity="error">
            {getSubmitErrorMessage(loginMutation.error)}
          </Alert>
        ) : null}

        <Stack
          component="form"
          spacing={2.5}
          noValidate
          onSubmit={form.handleSubmit(submit)}
        >
          <TextField
            label="Email"
            type="email"
            autoComplete="email"
            spellCheck={false}
            error={Boolean(form.formState.errors.email)}
            helperText={form.formState.errors.email?.message}
            {...form.register("email")}
          />
          <TextField
            label="Пароль"
            type="password"
            autoComplete="current-password"
            error={Boolean(form.formState.errors.password)}
            helperText={form.formState.errors.password?.message}
            {...form.register("password")}
          />
          <Button
            type="submit"
            variant="contained"
            size="large"
            disabled={loginMutation.isPending}
          >
            {loginMutation.isPending ? "Входим…" : "Войти"}
          </Button>
        </Stack>

        <Typography color="text.secondary">
          Ещё нет аккаунта?{" "}
          <Link component={RouterLink} to="/register" sx={{ fontWeight: 700 }}>
            Зарегистрироваться
          </Link>
        </Typography>
      </Stack>
    </AuthLayout>
  );
}
