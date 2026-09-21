const MOSCOW_TIME_ZONE = "Europe/Moscow";

export function formatMoscowDateTime(value: string | Date): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: MOSCOW_TIME_ZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatRubles(value: string | number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    minimumFractionDigits: 2,
  }).format(Number(value));
}

export function formatRelativeTime(value: string, now = new Date()): string {
  const seconds = Math.max(0, (now.getTime() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return "только что";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} ${plural(minutes, "минуту", "минуты", "минут")} назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${plural(hours, "час", "часа", "часов")} назад`;
  const days = Math.floor(hours / 24);
  return `${days} ${plural(days, "день", "дня", "дней")} назад`;
}

export function formatPlannedDuration(start: string, end: string): string {
  const totalHours = Math.max(
    0,
    Math.round((new Date(end).getTime() - new Date(start).getTime()) / 3_600_000),
  );
  if (totalHours < 24) {
    return `${totalHours} ${plural(totalHours, "час", "часа", "часов")}`;
  }
  const days = Math.round(totalHours / 24);
  if (days < 31) return `${days} ${plural(days, "день", "дня", "дней")}`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} ${plural(months, "месяц", "месяца", "месяцев")}`;
  const years = Math.round(days / 365);
  return `${years} ${plural(years, "год", "года", "лет")}`;
}

export function toMoscowInputParts(value: Date): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MOSCOW_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    time: `${part("hour")}:${part("minute")}`,
  };
}

export function moscowInputToDate(date: string, time: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match || !timeMatch) return null;
  const [, year, month, day] = match;
  const [, hour, minute] = timeMatch;
  return new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour) - 3,
      Number(minute),
    ),
  );
}

function plural(value: number, one: string, few: string, many: string): string {
  const remainder100 = value % 100;
  const remainder10 = value % 10;
  if (remainder100 >= 11 && remainder100 <= 14) return many;
  if (remainder10 === 1) return one;
  if (remainder10 >= 2 && remainder10 <= 4) return few;
  return many;
}
