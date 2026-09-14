import { Box, Container, Paper, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";

interface AuthLayoutProps {
  children: ReactNode;
}

export function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <Box component="main" className="auth-page">
      <Container maxWidth="lg" sx={{ py: { xs: 2, sm: 5 } }}>
        <Paper className="auth-card" elevation={0}>
          <Box className="auth-intro">
            <Stack spacing={4} sx={{ position: "relative", zIndex: 1 }}>
              <Box className="brand-mark" aria-label="Арентатор">
                А
              </Box>
              <Box>
                <Typography component="p" className="eyebrow">
                  Сервис аренды оборудования
                </Typography>
                <Typography component="h1" variant="h3" sx={{ mt: 1.5 }}>
                  Нужное оборудование — у надёжных людей рядом
                </Typography>
                <Typography sx={{ mt: 2, color: "rgba(255,255,255,0.78)" }}>
                  Берите инструмент на время или управляйте собственным каталогом
                  в одном спокойном и понятном пространстве.
                </Typography>
              </Box>
              <Stack component="ul" className="auth-benefits" spacing={1.5}>
                <li>Прозрачные роли и безопасная сессия</li>
                <li>Все действия и статусы в одном месте</li>
              </Stack>
            </Stack>
          </Box>
          <Box className="auth-form-column">{children}</Box>
        </Paper>
      </Container>
    </Box>
  );
}
