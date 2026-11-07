#!/bin/sh

echo "=== RESOURCES ==="
uptime
free -h
df -h /
sudo dmesg -T | grep -Ei 'oom|out of memory|killed process' | tail -30

echo "=== LISTENERS ==="
sudo ss -lntp '( sport = :22 or sport = :80 or sport = :443 )'

echo "=== SERVICES ==="
sudo systemctl --no-pager --full status ssh docker
sudo systemctl --no-pager --full status nginx 2>/dev/null || true

echo "=== CONTAINERS ==="
docker ps -a --no-trunc
docker compose --env-file .env.production \
  -f docker-compose.prod.yml ps -a

echo "=== LOCAL HTTP ==="
curl -v --max-time 5 http://127.0.0.1/
curl -v --max-time 5 \
  http://127.0.0.1/.well-known/acme-challenge/diagnostic

echo "=== DOCKER NETWORK ==="
sudo sysctl net.ipv4.ip_forward
sudo iptables -t nat -L DOCKER -n -v 2>/dev/null || true
sudo iptables -L DOCKER-USER -n -v 2>/dev/null || true

echo "=== SSH BLOCKS ==="
sudo fail2ban-client status sshd 2>/dev/null || true
sudo journalctl -u ssh --since "2 hours ago" --no-pager | tail -100
