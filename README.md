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
- проверочное дерево категорий: <http://localhost:5173/categories>.

Backend перед стартом автоматически применяет миграции. Исходники backend и
frontend подключены в контейнеры как bind mounts: Django и Vite автоматически
перезапускаются при изменении файлов. `node_modules` хранится в отдельном
контейнерном томе и не смешивается с зависимостями Windows. Остановить систему
можно командой `docker compose down`. Данные PostgreSQL и Redis сохраняются в
именованных томах.

После изменения Python- или frontend-кода пересборка контейнеров не требуется.
После изменения `requirements/prod.txt` или Dockerfile пересоберите соответствующий
образ. Зависимости frontend находятся в постоянном томе, поэтому после изменения
`package.json` или `package-lock.json` синхронизируйте их отдельной командой:

```powershell
docker compose run --rm frontend npm ci
docker compose restart frontend
```

Celery не перезагружает импортированные задачи автоматически, поэтому после
изменения фоновых задач перезапустите только затронутые процессы:

```powershell
docker compose restart celery-worker celery-beat
```

## Сервисы Compose

- `frontend` — React/TypeScript/Vite SPA;
- `backend` — Django/DRF/Channels под ASGI dev-сервером с автоперезагрузкой;
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

Frontend содержит маршруты `/register` и `/login`, а после аутентификации
показывает начальную страницу пользователя. Сессия хранится на сервере Django;
браузер передаёт только `HttpOnly` cookie. Все POST-запросы используют CSRF cookie
и заголовок `X-CSRFToken`.

Версионированные endpoints этапа:

- `GET /api/v1/auth/csrf/` — установить CSRF cookie;
- `POST /api/v1/auth/register/` — зарегистрироваться и начать сессию;
- `POST /api/v1/auth/login/` — войти;
- `POST /api/v1/auth/logout/` — завершить сессию;
- `GET /api/v1/auth/me/` — получить текущего пользователя.
- `GET /api/v1/categories/` — получить дерево категорий плоским списком с
  характеристиками и вариантами значений.

В production задайте `DJANGO_DEBUG=false` и `DJANGO_COOKIE_SECURE=true`. Для
локального HTTP запуска значение `DJANGO_COOKIE_SECURE` должно оставаться `false`.
