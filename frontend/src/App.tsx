import { Alert, Box, Button, CircularProgress, Stack } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { Navigate, Route, Routes } from "react-router-dom";
import { lazy, Suspense, type ReactNode } from "react";

import { CURRENT_USER_QUERY_KEY, getCurrentUser } from "./api/auth";
import { CategoriesPage } from "./categories/CategoriesPage";
import { AppShell } from "./layout/AppShell";
import { NotificationProvider } from "./notifications/NotificationProvider";

const LoginPage = lazy(() =>
  import("./auth/LoginPage").then((module) => ({ default: module.LoginPage })),
);
const RegisterPage = lazy(() =>
  import("./auth/RegisterPage").then((module) => ({ default: module.RegisterPage })),
);
const ApplicationFormPage = lazy(() =>
  import("./applications/ApplicationFormPage").then((module) => ({
    default: module.ApplicationFormPage,
  })),
);
const ManagerBookingDetailPage = lazy(() =>
  import("./applications/BookingPages").then((module) => ({
    default: module.ManagerBookingDetailPage,
  })),
);
const ManagerBookingsPage = lazy(() =>
  import("./applications/BookingPages").then((module) => ({
    default: module.ManagerBookingsPage,
  })),
);
const RenterBookingDetailPage = lazy(() =>
  import("./applications/BookingPages").then((module) => ({
    default: module.RenterBookingDetailPage,
  })),
);
const RenterBookingsPage = lazy(() =>
  import("./applications/BookingPages").then((module) => ({
    default: module.RenterBookingsPage,
  })),
);
const HandoverPage = lazy(() =>
  import("./applications/HandoverPage").then((module) => ({
    default: module.HandoverPage,
  })),
);
const ManagerApplicationDetailPage = lazy(() =>
  import("./applications/ManagerApplications").then((module) => ({
    default: module.ManagerApplicationDetailPage,
  })),
);
const ManagerApplicationsPage = lazy(() =>
  import("./applications/ManagerApplications").then((module) => ({
    default: module.ManagerApplicationsPage,
  })),
);
const RenterApplicationDetailPage = lazy(() =>
  import("./applications/RenterApplications").then((module) => ({
    default: module.RenterApplicationDetailPage,
  })),
);
const RenterApplicationsPage = lazy(() =>
  import("./applications/RenterApplications").then((module) => ({
    default: module.RenterApplicationsPage,
  })),
);
const RenterLayout = lazy(() =>
  import("./applications/RenterApplications").then((module) => ({
    default: module.RenterLayout,
  })),
);
const ManagerRentalsPage = lazy(() =>
  import("./applications/RentalPages").then((module) => ({
    default: module.ManagerRentalsPage,
  })),
);
const RentalDetailPage = lazy(() =>
  import("./applications/RentalPages").then((module) => ({
    default: module.RentalDetailPage,
  })),
);
const RenterRentalSummary = lazy(() =>
  import("./applications/RentalPages").then((module) => ({
    default: module.RenterRentalSummary,
  })),
);
const RenterRentalsPage = lazy(() =>
  import("./applications/RentalPages").then((module) => ({
    default: module.RenterRentalsPage,
  })),
);
const ReturnPage = lazy(() =>
  import("./applications/ReturnPage").then((module) => ({
    default: module.ReturnPage,
  })),
);
const ManagerAnalyticsPage = lazy(() =>
  import("./analytics/ManagerAnalyticsPage").then((module) => ({
    default: module.ManagerAnalyticsPage,
  })),
);
const CatalogPage = lazy(() =>
  import("./catalog/CatalogPage").then((module) => ({ default: module.CatalogPage })),
);
const ManagerProfilePage = lazy(() =>
  import("./catalog/ManagerProfilePage").then((module) => ({
    default: module.ManagerProfilePage,
  })),
);
const ProductDetailPage = lazy(() =>
  import("./catalog/ProductDetailPage").then((module) => ({
    default: module.ProductDetailPage,
  })),
);
const ManagerEditor = lazy(() =>
  import("./manager/ManagerEditor").then((module) => ({
    default: module.ManagerEditor,
  })),
);
const ManagerLayout = lazy(() =>
  import("./manager/ManagerPage").then((module) => ({
    default: module.ManagerLayout,
  })),
);
const ManagerListPage = lazy(() =>
  import("./manager/ManagerPage").then((module) => ({
    default: module.ManagerListPage,
  })),
);
const ManagerProductPage = lazy(() =>
  import("./manager/ManagerProductPage").then((module) => ({
    default: module.ManagerProductPage,
  })),
);
const NotificationCenterPage = lazy(() =>
  import("./notifications/NotificationPages").then((module) => ({
    default: module.NotificationCenterPage,
  })),
);
const NotificationSettingsPage = lazy(() =>
  import("./notifications/NotificationPages").then((module) => ({
    default: module.NotificationSettingsPage,
  })),
);

export default function App() {
  return (
    <Suspense fallback={<RouteLoading />}>
      <Routes>
        <Route path="/categories" element={<CategoriesPage />} />
        <Route path="*" element={<SessionApp />} />
      </Routes>
    </Suspense>
  );
}

function RouteLoading() {
  return (
    <Box className="full-page-state" role="status" aria-label="Загрузка страницы">
      <CircularProgress size={32} />
    </Box>
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
          <NotificationBoundary user={user}>
            <AppShell user={user}>
            <Routes>
              <Route path="/" element={<CatalogPage />} />
              <Route
                path="/products/:productId"
                element={<ProductDetailPage user={user} />}
              />
              <Route
                path="/products/:productId/apply"
                element={user?.role === "RENTER" ? <ApplicationFormPage /> : <Navigate to="/login" replace />}
              />
              <Route path="/managers/:managerId" element={<ManagerProfilePage />} />
              <Route
                path="/account"
                element={user?.role === "MANAGER" ? <ManagerLayout /> : user?.role === "RENTER" ? <RenterLayout /> : <Navigate to="/login" replace />}
              >
                {user?.role === "MANAGER" ? <Route index element={<ManagerListPage section="overview" />} /> : <Route index element={<><RenterRentalSummary /><RenterApplicationsPage /></>} />}
                {user?.role === "RENTER" ? <Route path="applications/:applicationId" element={<RenterApplicationDetailPage />} /> : null}
                {user?.role === "RENTER" ? <Route path="bookings" element={<RenterBookingsPage />} /> : null}
                {user?.role === "RENTER" ? <Route path="bookings/:bookingId" element={<RenterBookingDetailPage />} /> : null}
                {user?.role === "RENTER" ? <Route path="bookings/:bookingId/handover" element={<HandoverPage audience="renter" />} /> : null}
                {user?.role === "RENTER" ? <Route path="rentals/:rentalId" element={<RentalDetailPage audience="renter" />} /> : null}
                {user?.role === "RENTER" ? <Route path="rentals/:rentalId/return" element={<ReturnPage audience="renter" />} /> : null}
                {user?.role === "RENTER" ? <Route path="rentals" element={<RenterRentalsPage />} /> : null}
                {user?.role === "RENTER" ? <Route path="notifications" element={<NotificationCenterPage />} /> : null}
                {user?.role === "RENTER" ? <Route path="notifications/settings" element={<NotificationSettingsPage user={user} />} /> : null}
              </Route>
              {user?.role === "MANAGER" ? <Route path="/manager" element={<ManagerLayout />}>
                <Route path="applications" element={<ManagerApplicationsPage />} />
                <Route path="applications/:applicationId" element={<ManagerApplicationDetailPage />} />
                <Route path="bookings" element={<ManagerBookingsPage />} />
                <Route path="bookings/:bookingId" element={<ManagerBookingDetailPage />} />
                <Route path="bookings/:bookingId/handover" element={<HandoverPage audience="manager" />} />
                <Route path="rentals" element={<ManagerRentalsPage />} />
                <Route path="rentals/:rentalId" element={<RentalDetailPage audience="manager" />} />
                <Route path="rentals/:rentalId/return" element={<ReturnPage audience="manager" />} />
                <Route path="analytics" element={<ManagerAnalyticsPage />} />
                <Route path="products" element={<ManagerListPage section="products" />} />
                <Route path="rejected" element={<ManagerListPage section="rejected" />} />
                <Route path="archive" element={<ManagerListPage section="archive" />} />
                <Route path="products/new" element={<ManagerEditor />} />
                <Route path="products/:productId" element={<ManagerProductPage />} />
                <Route path="products/:productId/:step" element={<ManagerEditor />} />
                <Route path="notifications" element={<NotificationCenterPage />} />
                <Route path="notifications/settings" element={<NotificationSettingsPage user={user} />} />
              </Route> : null}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            </AppShell>
          </NotificationBoundary>
        }
      />
    </Routes>
  );
}

function NotificationBoundary({
  children,
  user,
}: {
  children: ReactNode;
  user: Awaited<ReturnType<typeof getCurrentUser>>;
}) {
  return user ? (
    <NotificationProvider user={user}>{children}</NotificationProvider>
  ) : (
    children
  );
}
