import * as http from 'http';
import * as path from 'path';
import { CoordinationServer } from './CoordinationServer';
import { UsageStore } from './usage/UsageStore';
import { AdminAuth } from './admin/AdminAuth';
import { UsageHttpServer } from './http/UsageHttpServer';
import { randomToken } from './util/crypto';

const port = parseInt(process.env.CLAUI_SERVER_PORT || '9120', 10);

const log = (msg: string): void => {
  const timestamp = new Date().toISOString().substring(11, 23);
  console.log(`[${timestamp}] ${msg}`);
};

const persistenceDir = process.env.CLAUI_PERSISTENCE_DIR || undefined;

// --- Usage / cost dashboard wiring (own storage, isolated from sessions) ---
const usageDir = process.env.CLAUI_USAGE_DIR
  || (persistenceDir ? path.join(persistenceDir, 'usage') : path.join(process.cwd(), 'usage-data'));

const usageStore = new UsageStore(usageDir, log);
usageStore.load();

const adminJwtSecret = process.env.CLAUI_ADMIN_JWT_SECRET || randomToken(48);
if (!process.env.CLAUI_ADMIN_JWT_SECRET) {
  log('Admin: CLAUI_ADMIN_JWT_SECRET not set - using a random per-process secret (admin sessions will not survive a restart).');
}

const adminAuth = new AdminAuth({
  user: process.env.CLAUI_ADMIN_USER,
  password: process.env.CLAUI_ADMIN_PASSWORD,
  jwtSecret: adminJwtSecret,
  log,
});

const publicDir = process.env.CLAUI_ADMIN_PUBLIC_DIR || path.join(__dirname, '..', 'public', 'admin');

const usageHttp = new UsageHttpServer({
  usageStore,
  adminAuth,
  registerToken: process.env.CLAUI_REGISTER_TOKEN || process.env.CLAUI_SESSION_TOKEN || undefined,
  publicDir,
  log,
});

// Single HTTP server shared by the usage/admin REST layer and the WebSocket
// coordination server (attached via { server }). One port for everything.
const httpServer = http.createServer(usageHttp.handler);

const server = new CoordinationServer({
  log,
  persistenceDir,
  guardApiKey: process.env.CLAUI_GUARD_API_KEY || undefined,
  guardModel: process.env.CLAUI_GUARD_MODEL || undefined,
  guardApiUrl: process.env.CLAUI_GUARD_API_URL || undefined,
  sessionToken: process.env.CLAUI_SESSION_TOKEN || undefined,
});

server.start(port, httpServer);
httpServer.listen(port, () => {
  log(`HTTP + WebSocket listening on port ${port}`);
});

let shuttingDown = false;
const shutdown = (signal: string): void => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} received, shutting down...`);
  server.stop();
  usageStore.close();
  httpServer.close();
  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

console.log(`ClaUi Coordination Server running on ws://localhost:${port} (HTTP admin dashboard at /admin)`);
console.log('Press Ctrl+C to stop');
console.log('');
console.log('Environment options:');
console.log('  CLAUI_SERVER_PORT        - Server port (default: 9120)');
console.log('  CLAUI_SESSION_TOKEN      - Auth token required for WS connections (disabled if unset)');
console.log('  CLAUI_PERSISTENCE_DIR    - Directory for session persistence (disabled if unset)');
console.log('  CLAUI_GUARD_API_KEY      - Anthropic API key for guard model (guard disabled if unset)');
console.log('  CLAUI_GUARD_MODEL        - Guard model name (default: claude-haiku-4-5-20251001)');
console.log('  CLAUI_GUARD_API_URL      - Custom API URL for guard model');
console.log('  --- Usage / Admin dashboard ---');
console.log('  CLAUI_ADMIN_USER         - Admin dashboard username (login disabled if unset)');
console.log('  CLAUI_ADMIN_PASSWORD     - Admin dashboard password (login disabled if unset)');
console.log('  CLAUI_ADMIN_JWT_SECRET   - Secret signing admin session tokens (random per-process if unset)');
console.log('  CLAUI_REGISTER_TOKEN     - Shared secret required to register a developer (falls back to CLAUI_SESSION_TOKEN)');
console.log('  CLAUI_USAGE_DIR          - Usage storage dir (default: <persistence>/usage or ./usage-data)');
console.log('  CLAUI_ADMIN_PUBLIC_DIR   - Override path to the admin SPA static files');
