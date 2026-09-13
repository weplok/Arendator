import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Box,
  CircularProgress,
  Container,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { Navigate, Route, Routes } from "react-router-dom";

import { getHealth } from "./api/health";

function HomePage() {
  const health = useQuery({
    queryKey: ["health"],
    queryFn: getHealth,
    retry: false,
    refetchInterval: 30_000,
  });

  return (
    <Container component="main" maxWidth="sm">
      <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center", py: 4 }}>
        <Paper elevation={0} sx={{ width: "100%", p: { xs: 3, sm: 5 } }}>
          <Stack spacing={3}>
            <Box>
              <Typography component="h1" variant="h3" gutterBottom>
                Арентатор
              </Typography>
              <Typography color="text.secondary">
                Каркас сервиса аренды оборудования запущен.
              </Typography>
            </Box>

            {health.isPending && (
              <Box sx={{ display: "flex", gap: 2, alignItems: "center" }}>
                <CircularProgress size={22} />
                <Typography>Проверяем backend…</Typography>
              </Box>
            )}
            {health.isSuccess && (
              <Alert severity="success">Backend доступен</Alert>
            )}
            {health.isError && (
              <Alert severity="error">
                Backend недоступен. Проверьте состояние контейнеров.
              </Alert>
            )}
          </Stack>
        </Paper>
      </Box>
    </Container>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
