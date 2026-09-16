FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY requirements/prod.txt /tmp/requirements.txt
RUN python -m pip install --upgrade pip \
    && python -m pip install -r /tmp/requirements.txt \
    && addgroup --system app \
    && adduser --system --ingroup app app

COPY --chown=app:app . .
RUN python manage.py collectstatic --noinput \
    && mkdir --parents /app/media \
    && chown app:app /app/media

USER app

EXPOSE 8000

CMD ["daphne", "-b", "0.0.0.0", "-p", "8000", "config.asgi:application"]
