# Arendator

Запускаемый каркас первой версии сервиса аренды инструментов и оборудования.
Требования к продукту определены в [SPEC.md](SPEC.md), а отложенные функции —
в [TODO.md](TODO.md).

## Запуск через Docker Compose

Нужен Docker с поддержкой Compose. Команды ниже выполняются из корня репозитория
в PowerShell.

1. Создайте локальный файл окружения:

   ```powershell
   Copy-Item .env.example .env
   ```

2. Откройте `.env` и задайте `DJANGO_SUPERUSER_PASSWORD` (сложный пароль длиной
   не менее 8 символов), замените `DJANGO_SECRET_KEY` на случайную строку.
   Администратор будет создан с адресом `DJANGO_SUPERUSER_EMAIL` и именем
   `DJANGO_SUPERUSER_NAME`. Файл `.env` не добавляется в Git. Для production также
   замените `POSTGRES_PASSWORD`, настройте домены и CSRF origins, укажите
   `DJANGO_DEBUG=false` и `DJANGO_COOKIE_SECURE=true`.

3. Соберите и запустите сервисы:

   ```powershell
   docker compose up --build -d
   docker compose ps
   ```

При старте backend дожидается PostgreSQL и Redis, затем последовательно
выполняет `migrate --noinput`, `seed_categories` и `ensure_superuser`. Только после
их успешного завершения стартует сервер. Celery worker, планировщик и frontend
дожидаются работающего backend. Если миграция или заполнение БД завершается с
ошибкой, backend не запускается; причину покажет `docker compose logs backend`.
Тот же порядок применяется при запуске backend из production Docker-образа.

`seed_categories` добавляет недостающие категории, характеристики и варианты
из `docs/category-taxonomy-v2.yaml`. Повторный запуск не создаёт дубликаты и не
перезаписывает существующие определения. `ensure_superuser` создаёт учётную запись
только при её отсутствии; при повторном запуске пароль не сбрасывается. Если
указанный email уже занят обычным пользователем, запуск останавливается без
повышения его прав.

Проверить результат можно командами:

```powershell
docker compose logs --tail=50 backend
docker compose exec backend python manage.py showmigrations
docker compose exec backend python manage.py seed_categories
docker compose exec backend python manage.py ensure_superuser
```

На чистой БД загрузка создаёт 73 категории, 254 характеристики и 370 вариантов.
Повторный запуск `seed_categories` сообщает о нулевом числе добавленных записей.
Вход в Django admin: <http://localhost:8000/admin/>; используйте email и пароль
суперпользователя из `.env`. Для смены пароля существующего администратора
выполните `docker compose exec backend python manage.py changepassword
admin@example.local`, подставив свой email.

После запуска доступны:

- frontend: <http://localhost:5173>;
- health-check backend: <http://localhost:8000/api/health/>;
- OpenAPI: <http://localhost:8000/api/schema/>;
- Swagger UI: <http://localhost:8000/api/docs/>;
- Django admin: <http://localhost:8000/admin/>;
- дерево категорий: <http://localhost:5173/categories>.

Compose подключает исходники backend и frontend в контейнеры как bind mounts.
Django и Vite перезапускаются при изменении кода. Данные PostgreSQL, Redis, media
и `node_modules` хранятся в именованных томах. Остановка без удаления данных:

```powershell
docker compose down
```

После изменения Python-кода пересборка не требуется. После изменения
`backend/requirements/prod.txt`, Dockerfile или файлов сборочного окружения
запустите `docker compose up --build -d`. После изменения зависимостей frontend
синхронизируйте `node_modules`:

```powershell
docker compose run --rm frontend npm ci
docker compose restart frontend
```

Celery не перезагружает импортированные задачи автоматически. После изменения
фоновых задач выполните `docker compose restart celery-worker celery-beat`.

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
PostgreSQL. Для локального запуска `.env` автоматически не читается: задайте
переменные в текущей сессии PowerShell. Нужен Python 3.14.

```powershell
py -3.14 -m venv venv
venv\Scripts\python.exe -m pip install -r backend\requirements\dev.txt
$env:DJANGO_SUPERUSER_EMAIL = "admin@example.local"
$env:DJANGO_SUPERUSER_NAME = "Администратор"
$env:DJANGO_SUPERUSER_PASSWORD = "укажите-сильный-пароль"
venv\Scripts\python.exe backend\manage.py migrate
venv\Scripts\python.exe backend\manage.py seed_categories
venv\Scripts\python.exe backend\manage.py ensure_superuser
venv\Scripts\python.exe backend\manage.py runserver
```

Замените пример пароля на собственный сложный пароль.
Команды миграции и заполнения можно запускать повторно. Для проверок backend:

```powershell
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
npm run check
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
- `GET /api/v1/products/` — получить страницу публичного каталога;
- `GET /api/v1/products/{id}/` — получить карточку товара;
- `GET /api/v1/managers/{id}/` — получить публичный профиль менеджера;
- `GET /api/v1/managers/{id}/products/active/` — получить активные товары
  менеджера;
- `GET /api/v1/managers/{id}/products/frozen/` — получить замороженные товары
  менеджера.

В production задайте `DJANGO_DEBUG=false` и `DJANGO_COOKIE_SECURE=true`. Для
локального HTTP запуска значение `DJANGO_COOKIE_SECURE` должно оставаться `false`.
