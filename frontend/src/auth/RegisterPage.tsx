import { zodResolver } from "@hookform/resolvers/zod";
import {
  Alert,
  Button,
  FormControl,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  Link,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { Controller, useForm } from "react-hook-form";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import { z } from "zod";

import {
  CURRENT_USER_QUERY_KEY,
  registerUser,
  registrationRoleSchema,
} from "../api/auth";
import { AuthLayout } from "./AuthLayout";
import { applyApiFieldErrors, getSubmitErrorMessage } from "./formErrors";

const registrationFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Укажите имя.")
    .max(150, "Имя не должно быть длиннее 150 символов."),
  email: z.email("Введите корректный email."),
  password: z.string().min(8, "Пароль должен содержать минимум 8 символов."),
  role: registrationRoleSchema,
  avatar: z.custom<FileList>().optional(),
});

type RegistrationFormValues = z.infer<typeof registrationFormSchema>;
const REGISTRATION_FIELDS: readonly (keyof RegistrationFormValues)[] = [
  "name",
  "email",
  "password",
  "role",
  "avatar",
];

export function RegisterPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const form = useForm<RegistrationFormValues>({
    resolver: zodResolver(registrationFormSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      role: "RENTER",
    },
  });
  const registrationMutation = useMutation({
    mutationFn: registerUser,
    onSuccess: (user) => {
      queryClient.setQueryData(CURRENT_USER_QUERY_KEY, user);
      navigate("/", { replace: true });
    },
  });

  useEffect(() => {
    if (registrationMutation.isError) {
      errorSummaryRef.current?.focus();
    }
  }, [registrationMutation.isError]);

  async function submit(values: RegistrationFormValues): Promise<void> {
    const avatar = values.avatar?.item(0) ?? undefined;
    try {
      await registrationMutation.mutateAsync({ ...values, avatar });
    } catch (error) {
      applyApiFieldErrors(error, form.setError, REGISTRATION_FIELDS);
    }
  }

  return (
    <AuthLayout>
      <Stack spacing={2.5} sx={{ width: "100%", maxWidth: 460 }}>
        <header>
          <Typography component="p" color="primary" sx={{ fontWeight: 700 }}>
            Новый аккаунт
          </Typography>
          <Typography component="h2" variant="h4" sx={{ mt: 1 }}>
            Регистрация
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 1 }}>
            Выберите роль сейчас — после регистрации её нельзя изменить.
          </Typography>
        </header>

        {registrationMutation.isError ? (
          <Alert ref={errorSummaryRef} tabIndex={-1} severity="error">
            {getSubmitErrorMessage(registrationMutation.error)}
          </Alert>
        ) : null}

        <Stack
          component="form"
          spacing={2}
          noValidate
          onSubmit={form.handleSubmit(submit)}
        >
          <TextField
            label="Имя"
            autoComplete="name"
            error={Boolean(form.formState.errors.name)}
            helperText={form.formState.errors.name?.message}
            {...form.register("name")}
          />
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
            autoComplete="new-password"
            error={Boolean(form.formState.errors.password)}
            helperText={
              form.formState.errors.password?.message ??
              "Минимум 8 символов; не используйте слишком простой пароль."
            }
            {...form.register("password")}
          />
          <Controller
            name="role"
            control={form.control}
            render={({ field, fieldState }) => (
              <FormControl error={Boolean(fieldState.error)}>
                <FormLabel id="role-label">Роль</FormLabel>
                <RadioGroup row aria-labelledby="role-label" {...field}>
                  <FormControlLabel
                    value="RENTER"
                    control={<Radio />}
                    label="Арендатор"
                  />
                  <FormControlLabel
                    value="MANAGER"
                    control={<Radio />}
                    label="Менеджер"
                  />
                </RadioGroup>
                <FormHelperText>
                  {fieldState.error?.message ??
                    "Арендатор берёт оборудование, менеджер размещает его."}
                </FormHelperText>
              </FormControl>
            )}
          />
          <Button component="label" variant="outlined" size="large">
            Добавить аватар (необязательно)
            <input
              className="visually-hidden"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              {...form.register("avatar")}
            />
          </Button>
          {form.formState.errors.avatar ? (
            <FormHelperText error>
              {form.formState.errors.avatar.message}
            </FormHelperText>
          ) : null}
          <Button
            type="submit"
            variant="contained"
            size="large"
            disabled={registrationMutation.isPending}
          >
            {registrationMutation.isPending
              ? "Создаём аккаунт…"
              : "Создать аккаунт"}
          </Button>
        </Stack>

        <Typography color="text.secondary">
          Уже зарегистрированы?{" "}
          <Link component={RouterLink} to="/login" sx={{ fontWeight: 700 }}>
            Войти
          </Link>
        </Typography>
      </Stack>
    </AuthLayout>
  );
}
