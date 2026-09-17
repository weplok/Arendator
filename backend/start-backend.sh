#!/bin/sh
set -eu

python manage.py migrate --noinput
python manage.py seed_categories
python manage.py ensure_superuser

exec "$@"
