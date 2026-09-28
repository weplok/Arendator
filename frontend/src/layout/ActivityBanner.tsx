import { Box, Button, Paper } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { Link as RouterLink, useLocation } from "react-router-dom";

import {
  getRenterActivity,
  RENTER_ACTIVITY_KEY,
} from "../api/bookings";
import type { CurrentUser } from "../api/auth";
import { formatRubles } from "../applications/formatting";

export function ActivityBanner({ user }: { user: CurrentUser | null }) {
  const location = useLocation();
  const query = useQuery({
    queryKey: RENTER_ACTIVITY_KEY,
    queryFn: getRenterActivity,
    enabled: user?.role === "RENTER",
    refetchInterval: 60_000,
    retry: false,
  });
  if (user?.role !== "RENTER" || !query.data) return null;
  const { handover, rental } = query.data;
  const onHandoverPage = location.pathname.includes("/handover");
  const onReturnPage = location.pathname.includes("/return");
  if (handover) {
    return (
      <Box className="activity-banner-wrap">
        <Paper className="activity-banner" elevation={0} role="status">
          <span className="activity-banner-icon" aria-hidden="true" />
          <Box><strong>Идёт приёмка: {handover.product.name}</strong><span>{nextHandoverStep(handover)}</span></Box>
          {!onHandoverPage ? <Button component={RouterLink} to={`/account/bookings/${handover.id}/handover`}>Продолжить приёмку</Button> : null}
        </Paper>
      </Box>
    );
  }
  if (rental?.status === "RETURN_INSPECTION") {
    return (
      <Box className="activity-banner-wrap">
        <Paper className="activity-banner" elevation={0} role="status">
          <span className="activity-banner-icon" aria-hidden="true" />
          <Box>
            <strong>Оформляется возврат: {rental.product.name}</strong>
            <span>Начисление остановлено. Завершите фотоакт возврата.</span>
          </Box>
          {!onReturnPage ? (
            <Button component={RouterLink} to={`/account/rentals/${rental.id}/return`}>
              Продолжить возврат
            </Button>
          ) : null}
        </Paper>
      </Box>
    );
  }
  if (rental?.status === "OVERDUE") {
    return (
      <Box className="activity-banner-wrap">
        <Paper className="activity-banner is-overdue" elevation={0} role="status">
          <span className="activity-banner-warning" aria-hidden="true" />
          <Box><strong>Идёт штрафное время</strong><span>{rental.late_minutes} мин · {formatRubles(rental.late_cost)}</span></Box>
          <Button component={RouterLink} to={`/account/rentals/${rental.id}`}>Открыть аренду</Button>
        </Paper>
      </Box>
    );
  }
  return null;
}

function nextHandoverStep(booking: NonNullable<Awaited<ReturnType<typeof getRenterActivity>>["handover"]>): string {
  const handover = booking.handover;
  if (!handover) return "Откройте фотоакт";
  if (!handover.renter.is_completed) return "Добавьте минимум 2 фото и завершите фиксацию";
  if (!handover.manager.is_completed) return "Ждём материалы менеджера";
  if (!handover.renter.is_confirmed) return "Проверьте общий фотоакт";
  return "Ждём подтверждение менеджера";
}
