const express  = require('express');
const cors     = require('cors');
const helmet   = require('helmet');
const Database = require('better-sqlite3');
const path     = require('path');
require('dotenv').config();
require('dotenv').config({ path: path.join(__dirname, '.env.local'), override: false });
const http     = require('http');
const multer   = require('multer');
const crypto   = require('crypto');
const { rateLimit } = require('express-rate-limit');
const modbus   = require('./modbus');
const priority = require('./priority');
const intake   = require('./intake');
const ai       = require('./ai');
const { createAuthService, ensureAuthSchema, hashPin } = require('./auth-core');
const { createLicenseService } = require('./services/license');
const { createPricer }          = require('./services/pricer');
const { createSettingsService } = require('./services/settings');
const { ROLE_PERMISSIONS, getRolePermission, requireAnyRole, requireRole } = require('./permissions');
const statusContracts = require('./status-contracts');
const constants = require('./constants');
const productionCards = require('./services/productionCards');
const { createOrderNumberAllocator } = require('./services/orderNumbers');
const { ensureCoreSchema, runCoreMigrations, seedCoreData } = require('./db/startup');
const { createRealtimeServer } = require('./realtime/ws');
const { createScheduler } = require('./jobs/scheduler');
const ordersService = require('./services/orders');
const intakeWorkflow = require('./services/intakeWorkflow');
const fleetService = require('./services/fleet');
const createInventoryRouter = require('./routes/inventory');
const createOrdersRouter = require('./routes/orders');
const createProductionCardsRouter = require('./routes/productionCards');
const createFinanceRouter = require('./routes/finance');
const createFleetRouter = require('./routes/fleet');
const createProductionRouter = require('./routes/production');
const createQualityRouter = require('./routes/quality');
const createCustomersRouter = require('./routes/customers');
const createAuthRouter = require('./routes/auth');
const createAdminRouter = require('./routes/admin');
const createPortalRouter = require('./routes/portal');
const createWarehouseRouter = require('./routes/warehouse');
const createReportsRouter = require('./routes/reports');
const createCatalogRouter = require('./routes/catalog');
const createIntakeRouter = require('./routes/intake');
const createAlertsRouter = require('./routes/alerts');
const createCompaniesRouter = require('./routes/companies');
const createPriorityRouter = require('./routes/priority');
const createAiRouter = require('./routes/ai');
const createSearchRouter = require('./routes/search');
const createBvbsRouter = require('./routes/bvbs');
const {
  REBAR_WEIGHTS,
  MACHINE_STATES,
  STATE_TRANSITIONS,
  rebarKgPerMeter,
} = constants;
const {
  autoAssignMachine,
  normalizeFactorySegments,
  normalizeFactoryShapeName,
  createOrderFactory,
} = ordersService;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const app    = express();
const server = http.createServer(app);
const PORT   = process.env.PORT || 3000;
const IS_TEST = process.env.NODE_ENV === 'test';

// BUG-44/46: feature flags — disable AI/OCR/Priority until production-ready
const AI_ENABLED      = process.env.AI_ENABLED      === 'true'; // default: false
const INTAKE_AI_ENABLED = process.env.INTAKE_AI_ENABLED === 'true'; // default: false
const PRIORITY_ENABLED  = process.env.PRIORITY_ENABLED  === 'true'; // default: false

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  },
}));

// BUG-16: Attach requestId + timestamp to every response
app.use((req, res, next) => {
  req.requestId = crypto.randomBytes(8).toString('hex');
  res.setHeader('X-Request-Id', req.requestId);
  const _json = res.json.bind(res);
  res.json = (body) => {
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      body._requestId = req.requestId;
      body._ts = new Date().toISOString();
    }
    return _json(body);
  };
  next();
});

// HTML pages: never cache — always serve fresh
app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path === '/') {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'ironbend.db');
const fs      = require('fs');
const DB_EXISTS_AT_STARTUP = fs.existsSync(DB_PATH);
const SKIP_STARTUP_DB_SNAPSHOT = process.env.SKIP_STARTUP_DB_SNAPSHOT === 'true' && process.env.NODE_ENV !== 'production';
function snapshotDatabaseFiles(sourcePath, backupBase) {
  for (const suffix of ['', '-wal', '-shm']) {
    const source = `${sourcePath}${suffix}`;
    if (fs.existsSync(source)) fs.copyFileSync(source, `${backupBase}${suffix}`);
  }
}
if (process.env.NODE_ENV === 'production' && !DB_EXISTS_AT_STARTUP && process.env.ALLOW_EMPTY_DB_INIT !== 'true') {
  throw new Error(`[DB Safety] Refusing to create a new production database at ${DB_PATH}. Verify the persistent disk mount or set ALLOW_EMPTY_DB_INIT=true only for the first intentional initialization.`);
}
if (DB_EXISTS_AT_STARTUP && !SKIP_STARTUP_DB_SNAPSHOT) {
  const startupBackup = `${DB_PATH}.bak.startup`;
  snapshotDatabaseFiles(DB_PATH, startupBackup);
  console.log(`[DB Safety] Startup snapshot created: ${startupBackup}`);
} else if (DB_EXISTS_AT_STARTUP && SKIP_STARTUP_DB_SNAPSHOT) {
  console.log('[DB Safety] Startup snapshot skipped for local development.');
}
let db = new Database(DB_PATH);
const settingsService = createSettingsService(db); // מריץ migration + seed אוטומטית
const pricer          = createPricer(db);
if (process.env.NODE_ENV === 'production' && DB_EXISTS_AT_STARTUP && process.env.ALLOW_EMPTY_DB_INIT !== 'true') {
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
  if (!tables.has('orders')) {
    db.close();
    throw new Error(`[DB Safety] Refusing to initialize an empty production database at ${DB_PATH}. Verify that the expected persistent database is mounted.`);
  }
}
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
modbus.init(db); // pass db so modbus reads machine config live

ensureCoreSchema(db);

runCoreMigrations(db);
ensureAuthSchema(db);

const STRICT_SECRET_ENVS = new Set(['production', 'staging']);
if (!process.env.JWT_SECRET && STRICT_SECRET_ENVS.has(process.env.NODE_ENV)) {
  throw new Error('[Auth] JWT_SECRET is required in production/staging.');
}
const runtimeJwtSecret = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.JWT_SECRET) {
  console.warn('[Auth] JWT_SECRET is not configured. Using an ephemeral startup secret for local development/test only.');
}
const authService = createAuthService(db, { jwtSecret: runtimeJwtSecret });
const authLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: process.env.NODE_ENV === 'test' ? 100 : 5,
  standardHeaders: true,
  legacyHeaders: false,
});
const imageAnalysisLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
});
const customerPortalAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});
const customerPortalActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
});
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
});


function bearerToken(req) {
  const header = String(req.headers.authorization || '');
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

const AUTH_BYPASS_ENABLED = process.env.AUTH_BYPASS === 'true' && process.env.NODE_ENV !== 'production';
const AUTH_BYPASS_ROLE = getRolePermission(process.env.AUTH_BYPASS_ROLE || 'admin')?.role || 'admin';
let authBypassWarned = false;

function applyAuthBypass(req) {
  if (!AUTH_BYPASS_ENABLED || req.auth) return;
  if (!authBypassWarned) {
    console.warn(`[AUTH] AUTH_BYPASS=true is enabled. All API requests run as ${AUTH_BYPASS_ROLE}. Disable after setup/testing.`);
    authBypassWarned = true;
  }
  req.auth = {
    sub: 'auth-bypass',
    username: 'auth-bypass',
    role: AUTH_BYPASS_ROLE,
  };
  req.authBypass = true;
}

function optionalAuth(req, _res, next) {
  const token = bearerToken(req);
  if (token) {
    try { req.auth = authService.verifyAccessToken(token); } catch (_) {}
  }
  applyAuthBypass(req);
  next();
}

function requireAuth(req, res, next) {
  optionalAuth(req, res, () => {
    if (req.auth) return next();
    return res.status(401).json({ error: 'Authentication required' });
  });
}

function verifyWhatsAppSignature(req, res, next) {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) return next();
  const signature = String(req.headers['x-hub-signature-256'] || '');
  const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
  const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return res.sendStatus(403);
  }
  return next();
}

app.use('/api', optionalAuth);

seedCoreData(db);

const realtime = createRealtimeServer({ server, db, modbus, authService, applyAuthBypass });
const wsBroadcast = realtime.wsBroadcast;

// modbus.startPolling(5000); // uncomment when hardware connected

// State contracts live in status-contracts.js.
// Returns true if transition is valid.
function isValidOrderTransition(from, to) {
  return statusContracts.isValidOrderTransition(from, to);
}
function normalizeOrderStatus(status) {
  return statusContracts.normalizeOrderStatus(status);
}

function isValidMachineState(state) {
  return MACHINE_STATES.includes(state);
}

// ── PERMISSION ENGINE (כרך ט) ─────────────────────────────────
// Role levels and guards live in permissions.js so route protection can be tested
// without starting the HTTP server. Protected routes require real JWT auth and
// never trust x-user-role/x-user-id browser headers.

// BUG-09: logAudit removed — use auditLog() (defined at line ~3697) as the single audit function

// Order geometry, factory normalization, machine assignment and weight calculation live in services/orders.js.

function listPage(query = {}, defaults = {}) {
  const defaultLimit = Number(defaults.limit || 100);
  const maxLimit = Number(defaults.max || 500);
  const requestedLimit = Number(query.limit);
  const requestedOffset = Number(query.offset);
  return {
    limit: Math.min(Math.max(Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : defaultLimit, 1), maxLimit),
    offset: Math.max(Number.isFinite(requestedOffset) && requestedOffset >= 0 ? requestedOffset : 0, 0),
  };
}

const generateOrderNum = createOrderNumberAllocator(db);

function checkOrderComplete(orderId) {
  const pending = db.prepare(`
    SELECT COUNT(*) as c FROM items i
    JOIN pallets p ON i.pallet_id = p.id
    WHERE p.order_id = ? AND i.status != 'הושלם'
  `).get(orderId);
  if (pending.c === 0) {
    db.prepare("UPDATE orders SET status='הושלם – ממתין לאיסוף' WHERE id=?").run(orderId);
    const o = db.prepare('SELECT order_num FROM orders WHERE id=?').get(orderId);
    wsBroadcast('order_complete', { orderId, orderNum: o?.order_num });
  }
}

// ── ROUTES ────────────────────────────────────────────────────────

// BUG-04: duplicate /api/health removed — authoritative version is at bottom of file

// ── CUSTOMERS ─────────────────────────────────────────────────────

// ── ORDERS ────────────────────────────────────────────────────────

const { createOrderFromPayload, createOrderTransaction, calcWeightPerUnit } = createOrderFactory(db, {
  generateOrderNum,
  rebarKgPerMeter,
});

function resolveIntakeCustomer(parsed = {}, rawContent = '') {
  return intakeWorkflow.resolveIntakeCustomer(parsed, rawContent, {
    byPhone: phone => db.prepare("SELECT id,name,phone,email,priority_id FROM customers WHERE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone, '-', ''), ' ', ''), '(', ''), ')', ''), '+972', '0')=? LIMIT 1").get(phone),
    byEmail: email => db.prepare('SELECT id,name,phone,email,priority_id FROM customers WHERE LOWER(email)=? LIMIT 1').get(email),
    byPriorityId: priorityId => db.prepare('SELECT id,name,phone,email,priority_id FROM customers WHERE priority_id=? LIMIT 1').get(priorityId),
    byName: name => db.prepare('SELECT id,name,phone,email,priority_id FROM customers WHERE name=? LIMIT 1').get(name),
  });
}

function enrichIntakeRow(row) {
  let parsed = {};
  try { parsed = JSON.parse(row.parsed_data || '{}'); } catch {}
  return {
    ...row,
    parsed,
    customer_match: resolveIntakeCustomer(parsed, row.raw_content || ''),
  };
}

function intakeToOrderPayload(parsed = {}, source = 'intake', customerOverride = null, rawContent = '') {
  return intakeWorkflow.buildIntakeOrderPayload(parsed, {
    source,
    customerOverride,
    rawContent,
    findCustomerById: id => db.prepare('SELECT id,name,phone,email FROM customers WHERE id=?').get(id),
    resolveCustomer: (payload, content) => resolveIntakeCustomer(payload, content).customer,
    calcWeightPerUnit,
  });
}

function buildOrderImportPreview(buffer) {
  return intakeWorkflow.buildOrderImportPreview(buffer, {
    orderExists: orderNum => Boolean(db.prepare('SELECT 1 FROM orders WHERE order_num=?').get(orderNum)),
  });
}

app.use('/api', createOrdersRouter({
  db,
  requireAnyRole,
  requireRole,
  upload,
  modbus,
  intake,
  listPage,
  rebarKgPerMeter,
  normalizeOrderStatus,
  isValidOrderTransition,
  allowedOrderTransitions: statusContracts.allowedOrderTransitions,
  createOrderFromPayload,
  createOrderTransaction,
  buildOrderImportPreview,
  wsBroadcast,
  auditLog,
}));

app.use('/api', createProductionCardsRouter({
  db,
  requireAnyRole,
  productionCards,
  REBAR_WEIGHTS,
  rebarKgPerMeter,
  tryParseJSON,
  normalizeFactorySegments,
  normalizeFactoryShapeName,
}));

app.use('/api', createFinanceRouter({
  db,
  requireAnyRole,
  requireRole,
  wsBroadcast,
  rebarKgPerMeter,
  settingsService,
}));

app.use('/api', createFleetRouter({
  db,
  requireAnyRole,
  wsBroadcast,
  auditLog,
  upload,
  intakeNotify: intake.notifyOrderStatus.bind(intake),
  priorityUpdate: priority.updateOrderStatus.bind(priority),
  createAlert,
}));

app.use('/api', createProductionRouter({
  db,
  requireAnyRole,
  requireRole,
  wsBroadcast,
  modbus,
  statusContracts,
  MACHINE_STATES,
  STATE_TRANSITIONS,
  checkOrderComplete,
  tryParseJSON,
}));

app.use('/api', createQualityRouter({
  db,
  requireAnyRole,
  wsBroadcast,
}));

app.use('/api', createCustomersRouter({
  db,
  requireAnyRole,
}));
app.use('/api', createAuthRouter({
  authService,
  authLoginLimiter,
}));
app.use('/api', createAdminRouter({
  getDb: () => db,
  setDb: nextDb => { db = nextDb; },
  Database,
  fs,
  requireRole,
  requireAnyRole,
  hashPin,
  getOpenAiApiKey,
  getSetting,
  upload,
  DB_PATH,
  snapshotDatabaseFiles,
  modbus,
  ai,
  statusContracts,
  settingsService,
}));


// The reviewed order screen uses OpenAI for image and PDF extraction. Results
// still return to the existing editable preview before an order is created.
const ANALYZE_IMAGE_ROLES = ['office', 'manager', 'admin'];
const analyzeImageAllowedRoles = new Set(ANALYZE_IMAGE_ROLES);
function imageRoleAuthorization(roles) {
  const allowedRoles = new Set(roles);
  return (req, res, next) => {
    if (!req.auth) {
      return res.status(401).json({
        error: 'נדרשת התחברות מחדש לפני ניתוח תמונה',
        code: 'ocr_auth_required',
      });
    }
    const actual = getRolePermission(req.auth.role);
    if (!actual || !allowedRoles.has(actual.role)) {
      return res.status(403).json({
        error: 'אין למשתמש הנוכחי הרשאה לניתוח תמונה',
        code: 'ocr_forbidden',
        allowed_roles: roles,
        your_role: actual?.role || req.auth.role,
      });
    }
    req.userRole = actual.role;
    req.userId = req.auth.sub || null;
    req.userPerm = actual.permission;
    return next();
  };
}
const analyzeImageAuthorization = imageRoleAuthorization(ANALYZE_IMAGE_ROLES);
const analyzeBendingShapeAuthorization = imageRoleAuthorization(['warehouse', 'office', 'manager', 'admin']);

function getIntakeTrainingGuidance(limit = 12, documentTypes = []) {
  const types = Array.isArray(documentTypes) ? documentTypes.filter(Boolean) : [];
  const where = types.length ? `AND document_type IN (${types.map(() => '?').join(',')})` : '';
  const examples = db.prepare(`
    SELECT document_type, problem_text, correction_text
    FROM intake_training_examples
    WHERE active=1
      ${where}
    ORDER BY id DESC
    LIMIT ?
  `).all(...types, limit);
  if (!examples.length) return '';
  return `\nOperator correction memory. Apply these corrections when a similar document, table, handwriting pattern, or customer format appears:\n${examples.map((example, index) =>
    `${index + 1}. Format: ${example.document_type || 'general'}\nProblem previously seen: ${example.problem_text}\nCorrect behavior next time: ${example.correction_text}`
  ).join('\n')}\n`;
}


// ── API ROUTERS ────────────────────────────────────────────────────────
app.use('/api', createInventoryRouter({
  db,
  requireAnyRole,
  analyzeBendingShapeAuthorization,
  imageAnalysisLimiter,
  upload,
  getSetting,
  getOpenAiApiKey,
  getIntakeTrainingGuidance,
  wsBroadcast,
  auditLog,
  listPage,
}));

app.use('/api', createIntakeRouter({
  db,
  requireAnyRole,
  analyzeImageAuthorization,
  imageAnalysisLimiter,
  upload,
  getSetting,
  getOpenAiApiKey,
  getIntakeTrainingGuidance,
  normalizeFactorySegments,
  normalizeFactoryShapeName,
  INTAKE_AI_ENABLED,
  intake,
  webhookLimiter,
  verifyWhatsAppSignature,
  wsBroadcast,
  enrichIntakeRow,
  createOrderFromPayload,
  intakeToOrderPayload,
  intakeWorkflow,
}));
app.use('/api', createPortalRouter({
  db,
  requireAnyRole,
  customerPortalAuthLimiter,
  customerPortalActionLimiter,
  crypto,
  intake,
  auditLog,
  rebarKgPerMeter,
  generateOrderNum,
  autoAssignMachine,
  wsBroadcast,
  pricer,
  settingsService,
  PORT,
  IS_TEST,
}));
app.use('/api', createWarehouseRouter({
  db,
  requireAnyRole,
}));
app.use('/api', createReportsRouter({
  db,
  requireRole,
  requireAnyRole,
  statusContracts,
  ai,
}));

app.use('/api', createCatalogRouter({
  db,
  requireAnyRole,
  intake,
  PORT,
}));

app.use('/api', createAlertsRouter({ db, requireRole, requireAnyRole, wsBroadcast }));
app.use('/api', createCompaniesRouter({ db, requireAnyRole }));
app.use('/api', createPriorityRouter({ db, requireRole, requireAnyRole, priority, PRIORITY_ENABLED }));
app.use('/api', createAiRouter({ db, requireAnyRole, ai }));
app.use('/api', createSearchRouter({ db, requireRole }));
app.use('/api', createBvbsRouter({ db, requireAnyRole, upload, rebarKgPerMeter, generateOrderNum, wsBroadcast }));


function tryParseJSON(val, fallback = null) {
  if (!val) return fallback;
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch { return fallback; }
}

// ── ALERT HELPERS ────────────────────────────────────────────────────────
function createAlert(type, level, message, { orderId, machineId } = {}) {
  db.prepare('INSERT INTO alerts (type,level,message,order_id,machine_id) VALUES (?,?,?,?,?)')
    .run(type, level, message, orderId || null, machineId || null);
  wsBroadcast('alert', { type, level, message, orderId, machineId });
}


// ── SETTINGS HELPERS ─────────────────────────────────────────────
// Helper: get setting from DB (falls back to process.env)
function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  return row?.value ?? process.env[key] ?? null;
}

function getOpenAiApiKey() {
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get('OPENAI_API_KEY');
  if (row?.value) return row.value;
  if (process.env.NODE_ENV !== 'production' && process.env.OPENAI_API_KEY_LOCAL) {
    return process.env.OPENAI_API_KEY_LOCAL;
  }
  return process.env.OPENAI_API_KEY ?? null;
}



// ── START ─────────────────────────────────────────────────────────

const scheduler = createScheduler({
  db,
  intake,
  settingsService,
  getSetting,
  createAlert,
  wsBroadcast,
  dbPath: DB_PATH,
  backupDir: process.env.BACKUP_DIR || path.join(__dirname, 'backups'),
  rootDir: __dirname,
  isTest: IS_TEST,
});
const BACKUP_DIR = scheduler.backupDir;

function auditLog(entityType,entityId,entityRef,action,fieldName,oldVal,newVal,notes,userId,userName) {
  try {
    db.prepare('INSERT INTO audit_log (entity_type,entity_id,entity_ref,action,field_name,old_value,new_value,notes,user_id,user_name) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(entityType,entityId||null,entityRef||null,action,fieldName||null,oldVal!=null?String(oldVal):null,newVal!=null?String(newVal):null,notes||null,userId||null,userName||null);
  } catch(e) { console.warn('[Audit]',e.message); }
}

ai.init(db);

// ════════════════════════════════════════════════════════════════
// ── FINANCIAL SCHEMA BOOTSTRAP ───────────────────────────────
// ════════════════════════════════════════════════════════════════

// Schema additions for financial engine
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS order_costs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id    INTEGER NOT NULL REFERENCES orders(id),
      material_cost   REAL DEFAULT 0,
      labor_cost      REAL DEFAULT 0,
      machine_cost    REAL DEFAULT 0,
      scrap_cost      REAL DEFAULT 0,
      overhead_cost   REAL DEFAULT 0,
      total_cost      REAL DEFAULT 0,
      revenue         REAL DEFAULT 0,
      gross_margin    REAL DEFAULT 0,
      margin_pct      REAL DEFAULT 0,
      tons_delivered  REAL DEFAULT 0,
      cost_per_ton    REAL DEFAULT 0,
      confidence      TEXT DEFAULT 'medium',
      locked          INTEGER DEFAULT 0,
      locked_by       TEXT,
      locked_at       TEXT,
      notes           TEXT DEFAULT '',
      updated_at      TEXT DEFAULT (datetime('now')),
      UNIQUE(order_id)
    );

    CREATE TABLE IF NOT EXISTS cost_snapshots (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id    INTEGER NOT NULL REFERENCES orders(id),
      snapshot    TEXT NOT NULL,
      reason      TEXT DEFAULT '',
      created_by  TEXT DEFAULT 'system',
      created_at  TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS customer_credit (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id     INTEGER NOT NULL REFERENCES customers(id) UNIQUE,
      credit_limit    REAL DEFAULT 0,
      payment_terms   INTEGER DEFAULT 30,
      open_debt       REAL DEFAULT 0,
      wip_value       REAL DEFAULT 0,
      total_exposure  REAL DEFAULT 0,
      credit_status   TEXT DEFAULT 'active',
      last_payment_date TEXT,
      notes           TEXT DEFAULT '',
      updated_at      TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS financial_events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type  TEXT NOT NULL,
      entity_type TEXT,
      entity_id   INTEGER,
      amount      REAL DEFAULT 0,
      description TEXT DEFAULT '',
      created_by  TEXT DEFAULT 'system',
      created_at  TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS steel_prices (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      diameter    INTEGER,
      grade       TEXT DEFAULT 'B500B',
      price_per_ton REAL NOT NULL,
      effective_date TEXT DEFAULT (date('now')),
      source      TEXT DEFAULT 'manual',
      created_at  TEXT DEFAULT (datetime('now'))
    );
  `);
} catch(e) { console.warn('כרך יב schema warn:', e.message); }


// ── Health check ──────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({ ok: true, ts: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});


// ── Graceful shutdown ────────────────────────────────────────────
function gracefulShutdown(signal) {
  console.log(`\n[Shutdown] קיבלתי ${signal} – סוגר בעדינות...`);
  scheduler.stop();
  server.close(() => {
    try { db.close(); } catch (_) {}
    console.log('[Shutdown] ✅ השרת נסגר בבטחה');
    process.exit(0);
  });
  setTimeout(() => { console.error('[Shutdown] ⏱ timeout – יוצא'); process.exit(1); }, 8000);
}
if (require.main === module) {
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
}

// ── Start ────────────────────────────────────────────────────────
function startServer(port = PORT, host = '0.0.0.0') {
  return server.listen(port, host, () => {
  // הצג IP מקומי כדי שעמדות אחרות ידעו לאן להתחבר
  const nets = require('os').networkInterfaces();
  const localIP = Object.values(nets).flat()
    .find(n => n.family === 'IPv4' && !n.internal)?.address || 'localhost';

  console.log(`\n✅  IronBend Server – טנא תעשיות ברזל בע"מ`);
  console.log(`──────────────────────────────────────────────`);
  console.log(`🖥️  מחשב זה:    http://localhost:${PORT}`);
  console.log(`🌐  רשת מקומית: http://${localIP}:${PORT}`);
  console.log(`──────────────────────────────────────────────`);
  console.log(`📊  Dashboard: http://${localIP}:${PORT}/dashboard.html`);
  console.log(`📋  Orders:    http://${localIP}:${PORT}/orders.html`);
  console.log(`🔧  Machine:   http://${localIP}:${PORT}/machine.html`);
  console.log(`🚚  Driver:    http://${localIP}:${PORT}/driver.html`);
  console.log(`📈  Reports:   http://${localIP}:${PORT}/reports.html`);
  console.log(`💰  Finance:   http://${localIP}:${PORT}/finance.html`);
  console.log(`──────────────────────────────────────────────`);
  console.log(`💾  DB:        ${DB_PATH}`);
  console.log(`🗂️  Backups:   ${BACKUP_DIR}  (יומי 02:00)\n`);
  });
}

if (require.main === module) {
  const licenseService = createLicenseService(db);
  licenseService.check().then(result => {
    const plan = result.plan || (result.valid ? 'free' : 'locked');
    if (plan === 'free') {
      console.log('📦 IronBend — מצב חינם (Free). לשדרוג: Tene Industry');
    } else if (plan === 'locked') {
      console.error('\n🔒 IronBend נעול — הרישיון לא תקף. צור קשר: Tene Industry\n');
    }
    app.use('/api', licenseService.middleware);
    startServer();
  }).catch(err => {
    console.error('[License] Fatal error:', err.message);
    startServer();
  });
}

function closeServer(callback = () => {}) {
  let doneCalled = false;
  const done = (error) => {
    if (doneCalled) return;
    doneCalled = true;
    callback(error);
  };

  scheduler.stop();

  realtime.close();

  server.closeAllConnections?.();
  if (server.listening) return server.close(done);
  done();
}

module.exports = { app, server, startServer, closeServer, db };
