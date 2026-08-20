'use strict';

const fs = require('fs');
const path = require('path');

const logPath = process.env.E2E_SERVER_LOG;
if (logPath) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(logPath, '');
  for (const level of ['log', 'warn', 'error']) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      const line = args.map(value => typeof value === 'string' ? value : JSON.stringify(value)).join(' ');
      fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${level.toUpperCase()} ${line}\n`);
      original(...args);
    };
  }
}

const port = Number(process.env.E2E_PORT || process.env.PORT);
if (!process.env.E2E_DB_PATH || !Number.isInteger(port) || port <= 0) {
  throw new Error('E2E_DB_PATH and a valid E2E_PORT are required');
}

const { startServer, closeServer } = require('../../../server');
startServer(port, '127.0.0.1');

function shutdown(signal) {
  console.log(`[Portal E2E] ${signal}: closing isolated server`);
  closeServer(error => {
    if (error) console.error('[Portal E2E] shutdown error', error.message);
    process.exit(error ? 1 : 0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', error => {
  console.error('[Portal E2E] uncaught exception', error.stack || error.message);
  process.exit(1);
});
process.on('unhandledRejection', error => {
  console.error('[Portal E2E] unhandled rejection', error?.stack || error);
  process.exit(1);
});
