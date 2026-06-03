module.exports = {
  apps: [{
    name:        'tene-license',
    script:      'server.js',
    cwd:         '/opt/tene-license',
    instances:   1,
    autorestart: true,
    watch:       false,
    max_memory_restart: '200M',
    env: {
      NODE_ENV: 'production',
      PORT:     4000,
    },
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  }],
};
