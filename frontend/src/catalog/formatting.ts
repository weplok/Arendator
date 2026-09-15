export function formatRate(rate: string): string {
  return new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: 2,
  }).format(Number(rate));
}
