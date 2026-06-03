#!/bin/bash
# setup.sh — Deploy אוטומטי של שרת הרישיונות
# הרץ על Ubuntu 22.04 VPS חדש

set -e
echo ""
echo "🚀 Tene Industry — License Server Deploy"
echo "========================================="

# ── 1. Node.js 20 ──────────────────────────────────────────────
echo ""
echo "📦 מתקין Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# ── 2. PM2 + nginx + certbot ───────────────────────────────────
echo ""
echo "📦 מתקין PM2, nginx, certbot..."
npm install -g pm2
apt-get install -y nginx certbot python3-certbot-nginx

# ── 3. קוד ────────────────────────────────────────────────────
echo ""
echo "📥 מוריד קוד..."
mkdir -p /opt/tene-license
cd /opt/tene-license

if [ -d ".git" ]; then
  git pull
else
  git clone --depth=1 https://github.com/meir-pixel/tene-industry.git .tmp
  cp -r .tmp/tene-license-server/. .
  rm -rf .tmp
fi

npm install --production

# ── 4. הגדרות ──────────────────────────────────────────────────
echo ""
if [ ! -f ".env" ]; then
  read -rp "🔐 הכנס סיסמת Admin לממשק הניהול: " ADMIN_PASS
  read -rp "📱 טלפון שלך לקבלת התראות (ריק = דלג): " NOTIFY_PHONE
  cat > .env <<EOF
ADMIN_PASSWORD=${ADMIN_PASS}
PORT=4000
TENE_NOTIFY_PHONE=${NOTIFY_PHONE}
BACKUP_DIR=/opt/tene-license/backups
DB_PATH=/opt/tene-license/licenses.db
EOF
  echo "✅ קובץ .env נוצר"
else
  echo "✅ קובץ .env קיים — לא מדרס"
fi

mkdir -p /opt/tene-license/backups

# ── 5. PM2 ────────────────────────────────────────────────────
echo ""
echo "⚙️  מגדיר PM2..."
pm2 start server.js --name tene-license --update-env
pm2 save
pm2 startup | tail -1 | bash

# ── 6. nginx ──────────────────────────────────────────────────
echo ""
read -rp "🌐 דומיין (לדוגמה: license.tene-ind.com): " DOMAIN

cat > /etc/nginx/sites-available/tene-license <<EOF
server {
    listen 80;
    server_name ${DOMAIN};

    location / {
        proxy_pass http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_cache_bypass \$http_upgrade;
        client_max_body_size 110M;
    }
}
EOF

ln -sf /etc/nginx/sites-available/tene-license /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# ── 7. SSL ────────────────────────────────────────────────────
echo ""
echo "🔒 מגדיר SSL..."
certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos -m "admin@tene-ind.com"

# ── סיום ─────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════"
echo "✅  שרת הרישיונות פעיל!"
echo ""
echo "   Admin: https://${DOMAIN}/admin"
echo "   Health: https://${DOMAIN}/health"
echo ""
echo "   לוגים: pm2 logs tene-license"
echo "════════════════════════════════════════"
