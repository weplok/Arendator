import {
  Alert, Button, CircularProgress, Paper, Skeleton, TextField, Typography,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { type CSSProperties, type FormEvent, type ReactNode, useState } from "react";
import { Link as RouterLink, useSearchParams } from "react-router-dom";

import {
  getManagerAnalytics, MANAGER_ANALYTICS_QUERY_KEY,
  type AnalyticsPeriodKey, type ManagerAnalytics,
} from "../api/analytics";
import { ApiError } from "../api/client";
import "./analytics.css";

const PERIODS: Array<{ key: AnalyticsPeriodKey; label: string }> = [
  { key: "week", label: "Неделя" }, { key: "month", label: "Месяц" },
  { key: "year", label: "Год" }, { key: "custom", label: "Свой период" },
];
const PARK_COLORS = ["#286452", "#33779c", "#6c58ad", "#a96118", "#9aa9a4"];

export function ManagerAnalyticsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const period = parsePeriod(searchParams.get("period"));
  const queryString = buildQueryString(period, searchParams);
  const query = useQuery({
    queryKey: [...MANAGER_ANALYTICS_QUERY_KEY, queryString],
    queryFn: () => getManagerAnalytics(queryString),
  });

  function selectPeriod(nextPeriod: AnalyticsPeriodKey): void {
    const next = new URLSearchParams({ period: nextPeriod });
    if (nextPeriod === "custom") {
      next.set("date_from", searchParams.get("date_from") ?? defaultDate(29));
      next.set("date_to", searchParams.get("date_to") ?? defaultDate(0));
    }
    setSearchParams(next);
  }

  return <div className="analytics-page">
    <header className="analytics-heading">
      <div><span className="analytics-eyebrow">Ваш каталог</span>
        <Typography component="h1" variant="h3">Аналитика</Typography>
        <Typography color="text.secondary">{query.data ? `${query.data.period.label} · МСК` : "Показатели в московском времени"}</Typography>
      </div>
      <PeriodSwitch period={period} onSelect={selectPeriod} />
    </header>
    {period === "custom" ? <CustomPeriodForm searchParams={searchParams} onSubmit={setSearchParams} /> : null}
    {query.isPending ? <AnalyticsLoading /> : null}
    {query.isError ? <AnalyticsError error={query.error} onRetry={() => query.refetch()} /> : null}
    {query.data ? <AnalyticsDashboard analytics={query.data} /> : null}
  </div>;
}

function PeriodSwitch({ period, onSelect }: { period: AnalyticsPeriodKey; onSelect: (period: AnalyticsPeriodKey) => void }) {
  return <div className="analytics-period-switch" role="group" aria-label="Период аналитики">{PERIODS.map((item) =>
    <Button aria-pressed={period === item.key} key={item.key} onClick={() => onSelect(item.key)} variant={period === item.key ? "contained" : "text"}>{item.label}</Button>)}</div>;
}

function CustomPeriodForm({ searchParams, onSubmit }: { searchParams: URLSearchParams; onSubmit: (params: URLSearchParams) => void }) {
  const [dateFrom, setDateFrom] = useState(searchParams.get("date_from") ?? defaultDate(29));
  const [dateTo, setDateTo] = useState(searchParams.get("date_to") ?? defaultDate(0));
  const invalidRange = dateFrom > dateTo;
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!invalidRange) onSubmit(new URLSearchParams({ period: "custom", date_from: dateFrom, date_to: dateTo }));
  }
  return <Paper component="form" className="analytics-custom-period" variant="outlined" onSubmit={submit}>
    <TextField autoComplete="off" label="Дата от" name="date_from" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} slotProps={{ inputLabel: { shrink: true } }} required />
    <TextField autoComplete="off" error={invalidRange} helperText={invalidRange ? "Дата до не может быть раньше даты от" : "Полный день по Москве"} label="Дата до" name="date_to" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} slotProps={{ inputLabel: { shrink: true } }} required />
    <Button disabled={invalidRange} type="submit" variant="contained">Показать</Button>
  </Paper>;
}

function AnalyticsDashboard({ analytics }: { analytics: ManagerAnalytics }) {
  const financials = analytics.financials;
  const negativeNet = Number(financials.net) < 0;
  return <>
    <section className="analytics-financials" aria-label="Финансовые показатели">
      <div className={`analytics-net${negativeNet ? " analytics-net--negative" : ""}`}><span>Расчётный итог</span><strong>{signedMoney(financials.net)}</strong><small>{negativeNet ? "Расходы превышают доходы" : "доходы за вычетом расходов"}</small></div>
      <div className="analytics-income"><div className="analytics-income__total"><span>Доходы</span><strong>+{money(financials.income)}</strong></div><dl><div><dt>Аренда</dt><dd>+{money(financials.rental_income)}</dd></div><div><dt>Просрочка</dt><dd>+{money(financials.overdue_income)}</dd></div><div><dt>Повреждения</dt><dd>+{money(financials.damage_income)}</dd></div></dl><small>{financials.completed_rentals} завершённых аренд</small></div>
      <div className="analytics-expenses"><div><span>Расходы</span><strong>−{money(financials.expenses)}</strong></div><dl><div><dt>Обслуживание</dt><dd>−{money(financials.expenses)}</dd></div></dl><small>{financials.completed_maintenances} завершённых обслуживаний</small></div>
    </section>
    <section className="analytics-kpis" aria-label="Операционные показатели">
      <KpiCard label="Средняя загрузка" value={`${formatPercent(analytics.utilization.average_percent)}%`} note={`за ${analytics.period.days} дн.`} />
      <KpiCard label="Активные просрочки" value={String(analytics.active_overdues.rentals)} note={`${analytics.active_overdues.products} товаров · ${analytics.snapshot_label}`} />
      <KpiCard label="Экземпляры в работе" value={String(analytics.park.in_work)} note={`${formatPercent(percent(analytics.park.in_work, analytics.park.total))}% парка · текущее состояние`} />
    </section>
    <section className="analytics-chart-grid"><CategoryChart analytics={analytics} /><ParkChart analytics={analytics} /></section>
    <UtilizationChart analytics={analytics} />
  </>;
}

function KpiCard({ label, value, note }: { label: string; value: string; note: string }) {
  return <Paper component="article" className="analytics-kpi" variant="outlined"><span>{label}</span><strong>{value}</strong><small>{note}</small></Paper>;
}

function ChartCard({ children, title, meta, total }: { children: ReactNode; title: string; meta: string; total?: string }) {
  return <Paper component="article" className="analytics-chart-card" variant="outlined"><header><div><Typography component="h2" variant="h5">{title}</Typography><span>{meta}</span></div>{total ? <strong>{total}</strong> : null}</header>{children}</Paper>;
}

function CategoryChart({ analytics }: { analytics: ManagerAnalytics }) {
  const maxIncome = Math.max(...analytics.categories.map((item) => Number(item.income)), 0);
  const top = analytics.categories[0];
  return <ChartCard title="Расчётный доход по категориям" meta={`${analytics.period.label} · ₽`} total={money(analytics.financials.income)}>
    {analytics.categories.length ? <><div className="category-chart" role="img" aria-label="Столбчатая диаграмма расчётного дохода по категориям">{analytics.categories.map((item) => <div className="category-bar" key={item.id}><span>{item.name}</span><i style={{ "--bar-height": `${percent(Number(item.income), maxIncome)}%` } as CSSProperties} /><strong>{money(item.income)}</strong></div>)}</div>
      <p className="analytics-insight"><strong>{formatPercent(percent(Number(top.income), Number(analytics.financials.income)))}%</strong> расчётного дохода принесла категория «{top.name}».</p>
      <DataTable summary="Таблица дохода по категориям" headers={["Категория", "Расчётный доход", "Завершённые аренды"]} rows={analytics.categories.map((item) => [item.name, money(item.income), String(item.completed_rentals)])} /></> : <ChartEmpty>За выбранный период завершённых аренд нет.</ChartEmpty>}
  </ChartCard>;
}

function ParkChart({ analytics }: { analytics: ManagerAnalytics }) {
  const circumference = 2 * Math.PI * 44;
  return <ChartCard title="Состояние парка" meta={`${analytics.snapshot_label} · экземпляры`} total={`${analytics.park.total} всего`}>
    {analytics.park.total ? <div className="park-chart"><svg viewBox="0 0 120 120" role="img" aria-label="Кольцевая диаграмма состояния парка"><circle className="park-chart__track" cx="60" cy="60" r="44" />{analytics.park.items.map((item, index) => { const length = circumference * item.count / analytics.park.total; const offset = analytics.park.items.slice(0, index).reduce((sum, previous) => sum + circumference * previous.count / analytics.park.total, 0); return <circle cx="60" cy="60" r="44" key={item.key} pathLength={circumference} stroke={PARK_COLORS[index]} strokeDasharray={`${length} ${circumference - length}`} strokeDashoffset={-offset} />; })}<text x="60" y="58" textAnchor="middle">{analytics.park.total}</text><text className="park-chart__unit" x="60" y="73" textAnchor="middle">экземпляров</text></svg><ul>{analytics.park.items.map((item, index) => <li key={item.key}><i style={{ background: PARK_COLORS[index] }} /><span>{item.label}</span><strong>{item.count}</strong></li>)}</ul></div> : <ChartEmpty>В каталоге пока нет экземпляров.</ChartEmpty>}
    <DataTable summary="Таблица состояния парка" headers={["Состояние", "Экземпляров"]} rows={analytics.park.items.map((item) => [item.label, String(item.count)])} />
  </ChartCard>;
}

function UtilizationChart({ analytics }: { analytics: ManagerAnalytics }) {
  const points = analytics.utilization.daily;
  const coordinates = points.map((item, index) => ({ x: points.length === 1 ? 50 : 6 + index * 88 / (points.length - 1), y: 94 - item.percent * 0.82, ...item }));
  const peak = points.reduce((best, point) => point.percent > best.percent ? point : best, points[0] ?? { label: "—", percent: 0 });
  return <ChartCard title="Загрузка экземпляров" meta={`${analytics.period.label} · доля операционных минут`} total={`В среднем ${formatPercent(analytics.utilization.average_percent)}%`}>
    {points.some((point) => point.percent > 0) ? <><div className="utilization-scroll"><div className="utilization-chart"><svg viewBox="0 0 100 108" preserveAspectRatio="none" role="img" aria-label="Линейная диаграмма загрузки экземпляров по дням"><g className="utilization-grid"><line x1="6" y1="12" x2="94" y2="12" /><line x1="6" y1="53" x2="94" y2="53" /><line x1="6" y1="94" x2="94" y2="94" /></g><polygon points={`6,94 ${coordinates.map((point) => `${point.x},${point.y}`).join(" ")} 94,94`} /><polyline points={coordinates.map((point) => `${point.x},${point.y}`).join(" ")} />{coordinates.map((point) => <circle key={point.date} cx={point.x} cy={point.y} r="1.2" />)}</svg><div className="utilization-labels">{coordinates.map((point) => <span key={point.date}>{point.label}</span>)}</div></div></div><p className="analytics-insight">Пиковая загрузка — <strong>{formatPercent(peak.percent)}%</strong> ({peak.label}).</p></> : <ChartEmpty>За выбранный период не было активных аренд.</ChartEmpty>}
    <DataTable summary="Таблица загрузки по дням" headers={["Дата", "Загрузка"]} rows={points.map((item) => [item.label, `${formatPercent(item.percent)}%`])} />
  </ChartCard>;
}

function DataTable({ summary, headers, rows }: { summary: string; headers: string[]; rows: string[][] }) {
  return <details className="analytics-data-table"><summary>{summary}</summary><div><table><thead><tr>{headers.map((header) => <th scope="col" key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={`${row[0]}-${rowIndex}`}>{row.map((cell, index) => index === 0 ? <th scope="row" key={cell}>{cell}</th> : <td key={`${cell}-${index}`}>{cell}</td>)}</tr>)}</tbody></table></div></details>;
}

function ChartEmpty({ children }: { children: ReactNode }) { return <div className="analytics-chart-empty"><strong>Пока нечего сравнивать</strong><span>{children}</span></div>; }
function AnalyticsLoading() { return <div className="analytics-loading" role="status" aria-label="Загрузка аналитики"><CircularProgress size={30} /><span>Собираем аналитику…</span>{Array.from({ length: 5 }, (_, index) => <Skeleton height={110} key={index} variant="rounded" />)}</div>; }
function AnalyticsError({ error, onRetry }: { error: Error; onRetry: () => void }) {
  if (error instanceof ApiError && error.status === 403) return <Alert severity="warning"><Typography component="h2" variant="h6">Доступ закрыт</Typography>Аналитика доступна только менеджеру своего каталога. <Button component={RouterLink} to="/account">В кабинет</Button></Alert>;
  return <Alert severity="error" action={<Button color="inherit" onClick={onRetry}>Повторить</Button>}>Не удалось загрузить аналитику. Проверьте соединение и повторите.</Alert>;
}

function parsePeriod(value: string | null): AnalyticsPeriodKey { return PERIODS.some((period) => period.key === value) ? value as AnalyticsPeriodKey : "week"; }
function buildQueryString(period: AnalyticsPeriodKey, params: URLSearchParams): string { const query = new URLSearchParams({ period }); if (period === "custom") { query.set("date_from", params.get("date_from") ?? defaultDate(29)); query.set("date_to", params.get("date_to") ?? defaultDate(0)); } return `?${query.toString()}`; }
function defaultDate(daysAgo: number): string { const date = new Date(); date.setDate(date.getDate() - daysAgo); return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit" }).format(date); }
function money(value: string): string { return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(Number(value))} ₽`; }
function signedMoney(value: string): string { return `${Number(value) >= 0 ? "+" : "−"}${money(String(Math.abs(Number(value))))}`; }
function percent(value: number, total: number): number { return total > 0 ? value * 100 / total : 0; }
function formatPercent(value: number): string { return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(value); }
