#!/usr/bin/env bash
#
# Обновление уже развёрнутого Share Server
#
# Использование:
#   sudo bash scripts/update.sh
#   sudo bash /opt/share-server/scripts/update.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${CONFIG_FILE:-/etc/share-server/deploy.env}"

log() { echo "[update] $*"; }
die() { echo "[update] ERROR: $*" >&2; exit 1; }

if [[ "$(id -u)" -ne 0 ]]; then
  die "Запустите с sudo или от root"
fi

APP_DIR="${APP_DIR:-/opt/share-server}"
APP_USER="${APP_USER:-share}"
APP_GROUP="${APP_GROUP:-share}"
SERVICE_NAME="${SERVICE_NAME:-share-server}"
GIT_BRANCH="${GIT_BRANCH:-main}"

if [[ -f "$CONFIG_FILE" ]]; then
  # shellcheck source=/dev/null
  source "$CONFIG_FILE"
fi

if [[ -d "$SCRIPT_DIR/../.git" ]] && [[ "$SCRIPT_DIR" == *"/scripts" ]]; then
  APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
fi

if [[ ! -d "$APP_DIR" ]]; then
  die "Каталог приложения не найден: $APP_DIR"
fi

if [[ ! -f "$APP_DIR/package.json" ]]; then
  die "Не найден package.json в $APP_DIR"
fi

if ! id "$APP_USER" &>/dev/null; then
  die "Пользователь приложения не найден: $APP_USER"
fi

run_as_app() {
  sudo -u "$APP_USER" env HOME="$APP_DIR" "$@"
}

log "Каталог: $APP_DIR"
log "Остановка $SERVICE_NAME..."
systemctl stop "$SERVICE_NAME" || true

BACKUP_DIR="/var/backups/share-server"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

if [[ -f "$APP_DIR/data/share.db" ]]; then
  cp -a "$APP_DIR/data/share.db" "$BACKUP_DIR/share.db.${STAMP}"
  log "Бэкап БД: $BACKUP_DIR/share.db.${STAMP}"
fi

cd "$APP_DIR"

if [[ -d .git ]]; then
  log "git fetch / pull (ветка ${GIT_BRANCH}, пользователь ${APP_USER})..."
  run_as_app git -C "$APP_DIR" fetch origin
  run_as_app git -C "$APP_DIR" checkout "$GIT_BRANCH"
  run_as_app git -C "$APP_DIR" pull origin "$GIT_BRANCH"
else
  log "Не git-репозиторий — пропуск git pull"
fi

log "npm install..."
run_as_app npm --prefix "$APP_DIR" install --omit=dev

mkdir -p "$APP_DIR/uploads/temp" "$APP_DIR/uploads/chunks"

chown -R "$APP_USER:$APP_GROUP" "$APP_DIR"
chmod 600 "$APP_DIR/.env" 2>/dev/null || true

log "Запуск $SERVICE_NAME..."
systemctl start "$SERVICE_NAME"
sleep 2

if systemctl is-active --quiet "$SERVICE_NAME"; then
  log "Обновление завершено успешно"
  systemctl status "$SERVICE_NAME" --no-pager -l | head -5
else
  die "Сервис не запустился. Восстановите из бэкапа при необходимости. journalctl -u $SERVICE_NAME -n 50"
fi

cat <<EOF

========================================
 Обновление завершено
  Версия:  $(run_as_app git -C "$APP_DIR" rev-parse --short HEAD 2>/dev/null || echo "unknown")
  Сервис:  systemctl status ${SERVICE_NAME}
  Логи:    journalctl -u ${SERVICE_NAME} -f
========================================
EOF
