export function formatRate(rate: string): string {
  return new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: 2,
  }).format(Number(rate));
}

export function formatAdvertisementCount(count: number): string {
  const lastTwoDigits = count % 100;
  const lastDigit = count % 10;
  const noun = lastTwoDigits >= 11 && lastTwoDigits <= 14
    ? "объявлений"
    : lastDigit === 1
      ? "объявление"
      : lastDigit >= 2 && lastDigit <= 4
        ? "объявления"
        : "объявлений";
  return `${count} ${noun}`;
}
