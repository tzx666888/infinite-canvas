#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-/opt/infinite-canvas/docker-compose.yml}"
sed -i.bak-v3.0.56 's#image: infinite-canvas:v3.0.56#image: infinite-canvas:v3.0.55#' "$COMPOSE_FILE"
docker-compose -f "$COMPOSE_FILE" up -d --force-recreate app
curl -fsS http://127.0.0.1:3100/api/health >/dev/null
printf 'canvas_rollback=v3.0.55\n'
