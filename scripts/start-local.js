process.env.PORT = process.env.PORT || '3100';
process.env.SKIP_STARTUP_DB_SNAPSHOT = 'true';
process.env.AUTH_BYPASS = 'true';
process.env.AUTH_BYPASS_ROLE = process.env.AUTH_BYPASS_ROLE || 'admin';

const { startServer } = require('../server');

startServer(process.env.PORT);
