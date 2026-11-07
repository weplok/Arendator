# Production deployment

The production stack serves `https://arend.weplok.space` through nginx. Only
TCP ports 80 and 443 are published. PostgreSQL, Redis, Daphne, Celery, and the
static frontend remain inside the Compose network.

## Server prerequisites

- A Linux server with Docker Engine and the Compose plugin.
- DNS `A` (and `AAAA`, only when IPv6 works on the server) records for
  `arend.weplok.space` pointing to the server.
- Incoming TCP ports 80 and 443 allowed by the provider firewall and the host
  firewall. Do not publish PostgreSQL port 5432 or Redis port 6379.
- The repository checked out at `/opt/arendator`. If another path is used,
  update `WorkingDirectory` in the three files under `deploy/systemd/`.

## First deployment

Run these commands on the server from `/opt/arendator`:

```sh
cp .env.production.example .env.production
chmod 600 .env.production
editor .env.production
```

Replace every `CHANGE_ME` value. Generate secrets on the server, for example:

```sh
openssl rand -base64 48
```

Before requesting a certificate, verify that public DNS resolves to this
server. Then pass the operational email address to the bootstrap script:

```sh
sh deploy/scripts/init-letsencrypt.sh admin@example.com
docker compose --env-file .env.production -f docker-compose.prod.yml ps
curl --fail https://arend.weplok.space/api/health/
```

The backend startup applies migrations, loads the category taxonomy, and
creates the initial superuser if it does not exist. The password in
`.env.production` does not reset an existing superuser password.

## Startup and certificate renewal with systemd

After the first certificate has been issued successfully:

```sh
sudo cp deploy/systemd/arendator*.service deploy/systemd/arendator*.timer \
  /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now arendator.service
sudo systemctl enable --now arendator-certbot.timer
sudo systemctl list-timers arendator-certbot.timer
```

The timer checks twice daily. Certbot renews only certificates close to
expiration; nginx is reloaded afterward so it starts using a renewed file.

## Deploying an update

```sh
git pull --ff-only
docker compose --env-file .env.production -f docker-compose.prod.yml \
  up -d --build --remove-orphans
docker compose --env-file .env.production -f docker-compose.prod.yml ps
docker compose --env-file .env.production -f docker-compose.prod.yml \
  logs --tail=100 backend nginx
```

## Backups

Named Docker volumes hold PostgreSQL, Redis, uploaded media, and certificates.
At minimum, schedule an encrypted off-host PostgreSQL dump and a copy of the
`media-data` volume. A database dump can be streamed without publishing its
port:

```sh
docker compose --env-file .env.production -f docker-compose.prod.yml \
  exec -T postgres pg_dump -U arendator -d arendator -Fc > arendator.dump
```

If Yandex Object Storage is enabled, public media is stored there instead of
the local media volume. Private photo storage still requires a separate review
before real production data is accepted, as described in `SPEC.md`.
