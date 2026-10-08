import { startStdioServer } from './mcpServer';

// Bundle entry (dist/remote-control-runtime/mcp-server.js). Runs on load because
// the stable launcher in ~/.claui/remote-control/bin requires this file.
startStdioServer();
