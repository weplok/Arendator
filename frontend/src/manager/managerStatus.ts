import type { ManagerInstance } from "../api/manager";

export function instanceStatusLabel(status: ManagerInstance["status"]): string {
  const labels: Record<ManagerInstance["status"], string> = {
    AVAILABLE: "Свободен",
    RESERVED: "Забронирован",
    PICKUP_IN_PROGRESS: "Оформляется выдача",
    RENTED: "В аренде",
    RETURN_INSPECTION: "Оформляется возврат",
    MAINTENANCE: "На обслуживании",
    DELETED: "Удалён",
  };
  return labels[status];
}
