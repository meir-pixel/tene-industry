// PM2 – Process Manager Configuration
// התקנה:  npm install -g pm2
// הפעלה:  pm2 start ecosystem.config.js
// עצירה:  pm2 stop ironbend
// לוגים:  pm2 logs ironbend
// אתחול אוטומטי עם Windows: pm2 startup  (ואז לבצע את הפקודה שהוא מדפיס)

module.exports = {
  apps: [
    {
      name: 'ironbend',
      script: 'server.js',

      // ── Restart policy ───────────────────────────────────────────
      autorestart:       true,       // הפעל מחדש אחרי קריסה
      max_restarts:      10,         // מקסימום 10 הפעלות מחדש
      min_uptime:        '30s',      // אם נפל תוך 30 שניות – לא סופר כ"הפעלה תקינה"
      restart_delay:     3000,       // המתן 3 שניות בין הפעלות

      // ── Environment ──────────────────────────────────────────────
      env: {
        NODE_ENV: 'development',
        PORT: 3000,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
        DB_PATH:    './ironbend.db',
        BACKUP_DIR: './backups',
      },

      // ── Logs ─────────────────────────────────────────────────────
      out_file:    './logs/server-out.log',
      error_file:  './logs/server-err.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs:  true,

      // ── Resources ────────────────────────────────────────────────
      max_memory_restart: '400M',    // הפעל מחדש אם זיכרון > 400MB

      // ── Watch (dev only) ─────────────────────────────────────────
      watch:          false,         // nodemon בפיתוח, PM2 בייצור
      ignore_watch:   ['node_modules', 'backups', 'logs', '*.db*'],
    },
  ],
};
