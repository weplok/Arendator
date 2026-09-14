import {
  Alert,
  AppBar,
  Box,
  Button,
  Chip,
  Container,
  Paper,
  Stack,
  Toolbar,
  Typography,
} from "@mui/material";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import {
  CURRENT_USER_QUERY_KEY,
  type CurrentUser,
  logout,
} from "./api/auth";

interface HomePageProps {
  user: CurrentUser;
}

const ROLE_LABELS = {
  RENTER: "Арендатор",
  MANAGER: "Менеджер",
  ADMIN: "Администратор",
} as const;

export function HomePage({ user }: HomePageProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      queryClient.setQueryData(CURRENT_USER_QUERY_KEY, null);
      navigate("/login", { replace: true });
    },
  });

  return (
    <Box component="main" className="home-page">
      <AppBar position="static" color="transparent" elevation={0}>
        <Container maxWidth="lg">
          <Toolbar disableGutters sx={{ minHeight: 72, gap: 2 }}>
            <Box className="brand-mark brand-mark--small" aria-hidden="true">
              А
            </Box>
            <Typography variant="h6" component="span" sx={{ flexGrow: 1 }}>
              Арентатор
            </Typography>
            <Button
              color="inherit"
              onClick={() => logoutMutation.mutate()}
              disabled={logoutMutation.isPending}
            >
              {logoutMutation.isPending ? "Выходим…" : "Выйти"}
            </Button>
          </Toolbar>
        </Container>
      </AppBar>

      <Container maxWidth="md" sx={{ py: { xs: 7, sm: 12 } }}>
        {logoutMutation.isError ? (
          <Alert severity="error" sx={{ mb: 3 }}>
            Не удалось завершить сессию. Проверьте соединение и повторите попытку.
          </Alert>
        ) : null}
        <Paper className="welcome-card" elevation={0}>
          <Stack spacing={3} sx={{ alignItems: "flex-start" }}>
            <Chip label={ROLE_LABELS[user.role]} color="primary" variant="outlined" />
            <Box>
              <Typography component="h1" variant="h3">
                Добро пожаловать, {user.name}
              </Typography>
              <Typography color="text.secondary" sx={{ mt: 2, maxWidth: 620 }}>
                Аккаунт готов. Здесь появится ваш рабочий кабинет на следующих
                этапах разработки сервиса.
              </Typography>
            </Box>
            <Box className="status-note">
              <Typography sx={{ fontWeight: 700 }}>Сессия активна</Typography>
              <Typography color="text.secondary" variant="body2">
                Вы вошли как {user.email}. Данные сохранятся после обновления
                страницы.
              </Typography>
            </Box>
          </Stack>
        </Paper>
      </Container>
    </Box>
  );
}
