import { Alert, Box, Button, CircularProgress, Stack } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { Navigate, Route, Routes } from "react-router-dom";

import { CURRENT_USER_QUERY_KEY, getCurrentUser } from "./api/auth";
import { LoginPage } from "./auth/LoginPage";
import { RegisterPage } from "./auth/RegisterPage";
import { HomePage } from "./HomePage";

export default function App() {
  const currentUserQuery = useQuery({
    queryKey: CURRENT_USER_QUERY_KEY,
    queryFn: getCurrentUser,
    retry: false,
    staleTime: 60_000,
  });

  if (currentUserQuery.isPending) {
    return (
      <Box className="full-page-state" role="status" aria-label="Загрузка">
        <CircularProgress size={32} />
      </Box>
    );
  }

  if (currentUserQuery.isError) {
    return (
      <Box className="full-page-state">
        <Stack spacing={2} sx={{ alignItems: "center" }}>
          <Alert severity="error">Не удалось проверить текущую сессию.</Alert>
          <Button variant="outlined" onClick={() => currentUserQuery.refetch()}>
            Повторить
          </Button>
        </Stack>
      </Box>
    );
  }

  if (currentUserQuery.data) {
    return (
      <Routes>
        <Route path="/" element={<HomePage user={currentUserQuery.data} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
