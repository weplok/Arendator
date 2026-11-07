#!/bin/sh
set -eu

domain="arend.weplok.space"
email="${1:-}"
compose_file="docker-compose.prod.yml"
env_file=".env.production"

if [ -z "$email" ]; then
    echo "Usage: sh deploy/scripts/init-letsencrypt.sh admin@example.com" >&2
    exit 2
fi

if [ ! -f "$env_file" ]; then
    echo "$env_file is missing; copy .env.production.example and fill it first." >&2
    exit 1
fi

if docker compose --env-file "$env_file" -f "$compose_file" run --rm \
    certbot certificates 2>/dev/null | grep -q "Certificate Name: $domain"; then
    echo "A certificate for $domain already exists; no changes were made."
    exit 0
fi

docker compose --env-file "$env_file" -f "$compose_file" stop nginx || true
docker compose --env-file "$env_file" -f "$compose_file" run --rm \
    --service-ports certbot certonly --standalone --non-interactive \
    --agree-tos --no-eff-email --email "$email" -d "$domain"
docker compose --env-file "$env_file" -f "$compose_file" up -d \
    --build --remove-orphans

echo "HTTPS deployment started at https://$domain/"
