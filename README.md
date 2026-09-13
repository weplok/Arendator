# Arendator

Запускаемый каркас первой версии сервиса аренды инструментов и оборудования.
Требования к продукту определены в [SPEC.md](SPEC.md), а отложенные функции —
в [TODO.md](TODO.md).

## Быстрый запуск

Требуется Docker с поддержкой Compose. Файл `.env` необязателен: значения для
локальной разработки уже заданы в `docker-compose.yml`.

```powershell
docker compose up --build
```

После запуска доступны:

- frontend: <http://localhost:5173>;
- health-check backend: <http://localhost:8000/api/health/>;
- OpenAPI: <http://localhost:8000/api/schema/>;
- Swagger UI: <http://localhost:8000/api/docs/>;
- Django admin: <http://localhost:8000/admin/>.

Backend перед стартом автоматически применяет миграции. Остановить систему можно
командой `docker compose down`. Данные PostgreSQL и Redis сохраняются в именованных
томах.

## Сервисы Compose

- `frontend` — React/TypeScript/Vite SPA;
- `backend` — Django/DRF/Channels под ASGI-сервером Daphne;
- `postgres` — основная реляционная БД;
- `redis` — channel layer, брокер и backend результатов Celery;
- `celery-worker` — обработчик фоновых задач;
- `celery-beat` — планировщик фоновых задач.

## Локальная разработка backend

По умолчанию вне Docker используется SQLite, чтобы проверки не требовали запущенных
инфраструктурных сервисов. В Docker `DATABASE_ENGINE` явно переключается на
PostgreSQL.

```powershell
venv\Scripts\python.exe -m pip install -r backend\requirements\dev.txt
venv\Scripts\python.exe backend\manage.py migrate
venv\Scripts\python.exe -m pytest
./scripts/format-backend.ps1
venv\Scripts\python.exe -m ruff check backend
venv\Scripts\python.exe -m flake8 backend
venv\Scripts\python.exe -m mypy backend
```

## Локальная разработка frontend

```powershell
Set-Location frontend
npm ci
npm run dev
npm run lint
npm run test
npm run build
```

При локальном запуске Vite проксирует `/api` на `http://localhost:8000`. Все
настройки и секреты передаются через переменные окружения; полный шаблон находится
в `.env.example`.

## Пользователь

Собственная модель `users.User` создана в начальной миграции проекта. Email служит
идентификатором входа и уникален без учёта регистра. Пользователь также имеет имя,
необязательный аватар и одну роль: `RENTER` или `MANAGER`. Email и роль после
создания неизменяемы в первой версии.
