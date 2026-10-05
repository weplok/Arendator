"""Moscow-time period parsing shared by API and admin analytics."""

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Mapping
from zoneinfo import ZoneInfo

from rest_framework.exceptions import ValidationError

MOSCOW_TIME_ZONE = ZoneInfo("Europe/Moscow")
PERIOD_DAYS = {"week": 7, "month": 30, "year": 365}
PERIOD_NAMES = {
    "week": "Неделя",
    "month": "Месяц",
    "year": "Год",
    "custom": "Свой период",
}


@dataclass(frozen=True)
class AnalyticsPeriod:
    key: str
    date_from: date
    date_to: date
    start: datetime
    end: datetime

    @property
    def label(self) -> str:
        return f"{format_date(self.date_from)} — {format_date(self.date_to)}"

    @property
    def days(self) -> int:
        return (self.date_to - self.date_from).days + 1


def parse_period(params: Mapping[str, object], *, now: datetime) -> AnalyticsPeriod:
    """Parse preset or inclusive custom dates into an aware half-open interval."""
    key = str(params.get("period", "week"))
    if key in PERIOD_DAYS:
        end_date = now.astimezone(MOSCOW_TIME_ZONE).date()
        date_from = end_date - timedelta(days=PERIOD_DAYS[key])
        date_to = end_date - timedelta(days=1)
        return _period(key, date_from, date_to)
    if key != "custom":
        raise ValidationError(
            {"period": "Выберите неделю, месяц, год или свой период."}
        )

    date_from = _parse_date(params.get("date_from"), "date_from")
    date_to = _parse_date(params.get("date_to"), "date_to")
    if date_from > date_to:
        raise ValidationError({"date_to": "Дата до не может быть раньше даты от."})
    if (date_to - date_from).days >= 366:
        raise ValidationError({"date_to": "Период не может быть длиннее 366 дней."})
    return _period(key, date_from, date_to)


def _parse_date(value: object, field: str) -> date:
    if not value:
        raise ValidationError({field: "Укажите дату в формате ГГГГ-ММ-ДД."})
    try:
        return date.fromisoformat(str(value))
    except ValueError as error:
        raise ValidationError({field: "Укажите дату в формате ГГГГ-ММ-ДД."}) from error


def _period(key: str, date_from: date, date_to: date) -> AnalyticsPeriod:
    start = datetime.combine(date_from, time.min, tzinfo=MOSCOW_TIME_ZONE)
    end = datetime.combine(
        date_to + timedelta(days=1), time.min, tzinfo=MOSCOW_TIME_ZONE
    )
    return AnalyticsPeriod(key, date_from, date_to, start, end)


def format_date(value: date) -> str:
    months = (
        "января",
        "февраля",
        "марта",
        "апреля",
        "мая",
        "июня",
        "июля",
        "августа",
        "сентября",
        "октября",
        "ноября",
        "декабря",
    )
    return f"{value.day} {months[value.month - 1]} {value.year}"
