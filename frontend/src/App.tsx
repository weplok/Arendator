import { Alert, Box, Button, CircularProgress, Stack } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { Navigate, Route, Routes } from "react-router-dom";

import { CURRENT_USER_QUERY_KEY, getCurrentUser } from "./api/auth";
import { LoginPage } from "./auth/LoginPage";
import { RegisterPage } from "./auth/RegisterPage";
import { CatalogPage } from "./catalog/CatalogPage";
import { ManagerProfilePage } from "./catalog/ManagerProfilePage";
import { ProductDetailPage } from "./catalog/ProductDetailPage";
import { CategoriesPage } from "./categories/CategoriesPage";
import { HomePage } from "./HomePage";
import { AppShell } from "./layout/AppShell";
import { ManagerEditor } from "./manager/ManagerEditor";
import { ManagerLayout, ManagerListPage } from "./manager/ManagerPage";

export default function App() {
  return (
    <Routes>
      <Route path="/categories" element={<CategoriesPage />} />
      <Route path="*" element={<SessionApp />} />
    </Routes>
  );
}

function SessionApp() {
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

  const user = currentUserQuery.data;
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        path="*"
        element={
          <AppShell user={user}>
            <Routes>
              <Route path="/" element={<CatalogPage />} />
              <Route
                path="/products/:productId"
                element={<ProductDetailPage user={user} />}
              />
              <Route path="/managers/:managerId" element={<ManagerProfilePage />} />
              <Route
                path="/account"
                element={user?.role === "MANAGER" ? <ManagerLayout /> : user ? <HomePage user={user} /> : <Navigate to="/login" replace />}
              >
                {user?.role === "MANAGER" ? <Route index element={<ManagerListPage section="overview" />} /> : null}
              </Route>
              {user?.role === "MANAGER" ? <Route path="/manager" element={<ManagerLayout />}>
                <Route path="products" element={<ManagerListPage section="products" />} />
                <Route path="archive" element={<ManagerListPage section="archive" />} />
                <Route path="products/new" element={<ManagerEditor />} />
                <Route path="products/:productId/:step" element={<ManagerEditor />} />
              </Route> : null}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </AppShell>
        }
      />
    </Routes>
  );
}
