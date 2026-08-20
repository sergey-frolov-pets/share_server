#!/usr/bin/env bash
#
# Развёртывание Share Server на чистой Ubuntu/Debian (VDS, VDSina и т.п.)
#
# Использование:
#   sudo bash scripts/deploy.sh
#   sudo bash scripts/deploy.sh --config /etc/share-server/deploy.env
#   sudo bash scripts/deploy.sh --from-source /path/to/share_server
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${CONFIG_FILE:-/etc/share-server/deploy.env}"
FROM_SOURCE=""
SKIP_GIT=false

log() { echo "[deploy] $*"; }
die() { echo "[deploy] ERROR: $*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --config)
      CONFIG_FILE="$2"
      shift 2
      ;;
    --from-source)
      FROM_SOURCE="$2"
      SKIP_GIT=true
      shift 2
      ;;
    -h|--help)
      sed -n '2,10p' "$0"
      exit 0
      ;;
    *)
      die "Неизвестный аргумент: $1"
      ;;
  esac
done

if [[ "$(id -u)" -ne 0 ]]; then
  die "Запустите с sudo или от root"
fi

if [[ -f "$CONFIG_FILE" ]]; then
  # shellcheck source=/dev/null
  source "$CONFIG_FILE"
  log "Конфиг: $CONFIG_FILE"
else
  log "Конфиг не найден ($CONFIG_FILE), используются значения по умолчанию"
  GITHUB_REPO="${GITHUB_REPO:-https://github.com/sergey-frolov-pets/share_server.git}"
  GIT_BRANCH="${GIT_BRANCH:-main}"
  APP_DIR="${APP_DIR:-/opt/share-server}"
  APP_USER="${APP_USER:-share}"
  APP_GROUP="${APP_GROUP:-share}"
  SERVICE_NAME="${SERVICE_NAME:-share-server}"
  NODE_MAJOR="${NODE_MAJOR:-20}"
  DOMAIN="${DOMAIN:-share.example.com}"
  BASE_URL="${BASE_URL:-https://share.example.com}"
  APP_PORT="${APP_PORT:-3000}"
  LOGIN_USERNAME="${LOGIN_USERNAME:-admin}"
  LOGIN_PASSWORD="${LOGIN_PASSWORD:-changeme}"
  MAX_FILE_SIZE_MB="${MAX_FILE_SIZE_MB:-100}"
  NGINX_CLIENT_MAX_BODY="${NGINX_CLIENT_MAX_BODY:-100m}"
  INSTALL_NGINX="${INSTALL_NGINX:-true}"
  CONFIGURE_UFW="${CONFIGURE_UFW:-true}"
fi

export DEBIAN_FRONTEND=noninteractive

log "Обновление пакетов..."
apt-get update -qq
apt-get install -y -qq curl ca-certificates git build-essential python3

if ! command -v node >/dev/null 2>&1 || [[ "$(node -p "process.versions.node.split('.')[0]")" -lt "$NODE_MAJOR" ]]; then
  log "Установка Node.js ${NODE_MAJOR}..."
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y -qq nodejs
fi

log "Node: $(node -v), npm: $(npm -v)"

if ! id "$APP_USER" &>/dev/null; then
  log "Создание пользователя $APP_USER..."
  useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
fi

mkdir -p "$(dirname "$CONFIG_FILE")"
if [[ ! -f "$CONFIG_FILE" ]]; then
  if [[ -f "$SCRIPT_DIR/deploy.env.example" ]]; then
    cp "$SCRIPT_DIR/deploy.env.example" "$CONFIG_FILE"
    log "Создан $CONFIG_FILE — проверьте DOMAIN и пароли"
  fi
fi

if [[ -d "$APP_DIR/.git" ]] || [[ -f "$APP_DIR/package.json" ]]; then
  die "Уже установлено в $APP_DIR. Для обновления используйте: sudo bash scripts/update.sh"
fi

mkdir -p "$APP_DIR"

if [[ -n "$FROM_SOURCE" ]]; then
  log "Копирование из $FROM_SOURCE..."
  rsync -a --exclude node_modules --exclude .git --exclude uploads --exclude data \
    "$FROM_SOURCE/" "$APP_DIR/"
elif [[ "$SKIP_GIT" == false ]]; then
  log "Клонирование $GITHUB_REPO (ветка $GIT_BRANCH)..."
  git clone --depth 1 --branch "$GIT_BRANCH" "$GITHUB_REPO" "$APP_DIR"
else
  die "Укажите --from-source или настройте GITHUB_REPO"
fi

chown -R "$APP_USER:$APP_GROUP" "$APP_DIR"

ENV_FILE="$APP_DIR/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  SESSION_SECRET="$(openssl rand -hex 32)"
  cat > "$ENV_FILE" <<EOF
PORT=${APP_PORT}
SESSION_SECRET=${SESSION_SECRET}
LOGIN_USERNAME=${LOGIN_USERNAME}
LOGIN_PASSWORD=${LOGIN_PASSWORD}
BASE_URL=${BASE_URL}
MAX_FILE_SIZE_MB=${MAX_FILE_SIZE_MB}
UPLOAD_DIR=uploads
DATA_DIR=data
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM=share@${DOMAIN}
EOF
  chown "$APP_USER:$APP_GROUP" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  log "Создан $ENV_FILE"
else
  log ".env уже существует, не перезаписываю"
fi

mkdir -p "$APP_DIR/uploads" "$APP_DIR/data" "$APP_DIR/uploads/temp"
chown -R "$APP_USER:$APP_GROUP" "$APP_DIR/uploads" "$APP_DIR/data"

log "npm install..."
cd "$APP_DIR"
npm install --omit=dev
chown -R "$APP_USER:$APP_GROUP" "$APP_DIR/node_modules"

UNIT_PATH="/etc/systemd/system/${SERVICE_NAME}.service"
cat > "$UNIT_PATH" <<EOF
[Unit]
Description=Share Server (file sharing)
After=network.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_GROUP}
WorkingDirectory=${APP_DIR}
Environment=NODE_ENV=production
ExecStart=/usr/bin/node src/server.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"

if [[ "${INSTALL_NGINX}" == "true" ]]; then
  apt-get install -y -qq nginx
  NGINX_SITE="/etc/nginx/sites-available/${SERVICE_NAME}"
  cat > "$NGINX_SITE" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    client_max_body_size ${NGINX_CLIENT_MAX_BODY};

    location / {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
        proxy_request_buffering off;
    }
}
EOF
  ln -sf "$NGINX_SITE" "/etc/nginx/sites-enabled/${SERVICE_NAME}"
  rm -f /etc/nginx/sites-enabled/default
  nginx -t
  systemctl reload nginx
  log "Nginx настроен для $DOMAIN"
fi

if [[ "${CONFIGURE_UFW}" == "true" ]] && command -v ufw >/dev/null 2>&1; then
  ufw allow OpenSSH >/dev/null 2>&1 || ufw allow 22/tcp
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw --force enable || true
  log "UFW: открыты 22, 80, 443"
fi

sleep 2
if systemctl is-active --quiet "$SERVICE_NAME"; then
  log "Сервис $SERVICE_NAME запущен"
else
  die "Сервис не запустился. Проверьте: journalctl -u $SERVICE_NAME -n 50"
fi

cat <<EOF

========================================
 Share Server установлен
========================================
  Каталог:    ${APP_DIR}
  URL:        ${BASE_URL}
  Админ:      ${LOGIN_USERNAME} / (пароль в ${ENV_FILE})
  Сервис:     systemctl status ${SERVICE_NAME}
  Логи:       journalctl -u ${SERVICE_NAME} -f

  Обновление: sudo bash ${APP_DIR}/scripts/update.sh

  HTTPS (опционально):
    apt install certbot python3-certbot-nginx
    certbot --nginx -d ${DOMAIN}

  Важно: смените LOGIN_PASSWORD и SESSION_SECRET в ${ENV_FILE}
========================================
EOF
