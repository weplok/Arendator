#!/bin/sh
set -eu

compose_file="docker-compose.prod.yml"
env_file=".env.production"

docker compose --env-file "$env_file" -f "$compose_file" run --rm \
    certbot renew --webroot --webroot-path /var/www/certbot --quiet
docker compose --env-file "$env_file" -f "$compose_file" exec -T \
    nginx nginx -s reload
