import { CoordinationServer } from './CoordinationServer';

const port = parseInt(process.env.CLAUI_SERVER_PORT || '9120', 10);

const server = new CoordinationServer({
  log: (msg) => {
    const timestamp = new Date().toISOString().substring(11, 23);
    console.log(`[${timestamp}] ${msg}`);
  },
  persistenceDir: process.env.CLAUI_PERSISTENCE_DIR || undefined,
  guardApiKey: process.env.CLAUI_GUARD_API_KEY || undefined,
  guardModel: process.env.CLAUI_GUARD_MODEL || undefined,
  guardApiUrl: process.env.CLAUI_GUARD_API_URL || undefined,
});

server.start(port);

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  server.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  server.stop();
  process.exit(0);
});

console.log(`ClaUi Coordination Server running on ws://localhost:${port}`);
console.log('Press Ctrl+C to stop');
console.log('');
console.log('Environment options:');
console.log('  CLAUI_SERVER_PORT        - Server port (default: 9120)');
console.log('  CLAUI_PERSISTENCE_DIR    - Directory for session persistence (disabled if unset)');
console.log('  CLAUI_GUARD_API_KEY      - Anthropic API key for guard model (guard disabled if unset)');
console.log('  CLAUI_GUARD_MODEL        - Guard model name (default: claude-haiku-4-5-20251001)');
console.log('  CLAUI_GUARD_API_URL      - Custom API URL for guard model');
