import { Box, Chip, Container, Paper, Stack, Typography } from "@mui/material";

import type { CurrentUser } from "./api/auth";

interface HomePageProps {
  user: CurrentUser;
}

const ROLE_LABELS = {
  RENTER: "Арендатор",
  MANAGER: "Менеджер",
  ADMIN: "Администратор",
} as const;

export function HomePage({ user }: HomePageProps) {
  return (
    <Box className="home-page">
      <Container maxWidth="md" sx={{ py: { xs: 7, sm: 12 } }}>
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
