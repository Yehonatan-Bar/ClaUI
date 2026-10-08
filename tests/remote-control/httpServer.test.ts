import { test, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as http from 'node:http';
import { RemoteControlHttpServer, type RemoteControlBackend } from '../../src/extension/remote-control/core/RemoteControlHttpServer';
import { EventLog } from '../../src/extension/remote-control/core/EventLog';
import { TOOL_CATALOG } from '../../src/remote-control-shared/toolCatalog';
import { RemoteControlError } from '../../src/remote-control-shared/protocol';
import { requestJson } from '../../src/remote-control-shared/httpClient';

const TOKEN = 'a'.repeat(64);
const eventLog = new EventLog();
const calls: Array<{ name: string; args: Record<string, unknown>; transport: string }> = [];

const backend: RemoteControlBackend = {
  identity: { name: 'claui', version: '9.9.9', instructions: 'test instructions' },
  instanceId: 'inst-1',
  listTools: () => TOOL_CATALOG.filter((t) => t.scope === 'instance'),
  callTool: async (name, args, ctx) => {
    calls.push({ name, args, transport: ctx.transport });
    if (name === 'close_tab') {
      throw new RemoteControlError('not_found', 'No tab matches "x".');
    }
    if (name === 'set_model') {
      throw new RemoteControlError('read_only_mode', 'read only');
    }
    return { echo: name, args };
  },
  getStatus: () => ({ instanceId: 'inst-1', protocolVersion: 1 }),
  eventLog,
  log: () => undefined,
};

let server: RemoteControlHttpServer;
let port = 0;

before(async () => {
  server = new RemoteControlHttpServer(backend, { port: 0, getToken: () => TOKEN });
  port = await server.start();
});

after(async () => {
  await server.stop();
});

function raw(
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: string,
): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data, headers: res.headers }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

const auth = { Authorization: `Bearer ${TOKEN}` };

test('health is public, everything else needs the token', async () => {
  assert.equal((await raw('GET', '/health')).status, 200);
  const noToken = await raw('GET', '/api/status');
  assert.equal(noToken.status, 401);
  assert.equal(JSON.parse(noToken.body).error.code, 'unauthorized');
  assert.equal((await raw('GET', '/api/status', { Authorization: `Bearer ${'b'.repeat(64)}` })).status, 401);
  assert.equal((await raw('GET', '/api/status', { 'X-ClaUi-Token': TOKEN })).status, 200);
});

test('browser and DNS-rebinding requests are refused', async () => {
  assert.equal((await raw('GET', '/api/status', { ...auth, Origin: 'https://evil.example' })).status, 403);
  assert.equal((await raw('GET', '/api/status', { ...auth, 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await raw('GET', '/api/status', { ...auth, Host: `evil.example:${port}` })).status, 403);
  assert.equal((await raw('GET', '/api/status', { ...auth, Host: `127.0.0.1:${port + 1}` })).status, 403);
  assert.equal((await raw('GET', '/api/status', { ...auth, Host: `localhost:${port}` })).status, 200);
  assert.equal((await raw('GET', `/api/status?token=${TOKEN}`)).status, 400, 'no tokens in URLs');
});

test('unauthenticated POST bodies are never read; JSON content type is required', async () => {
  const unauth = await raw('POST', '/api/tools/get_status', { 'Content-Type': 'application/json' }, '{}');
  assert.equal(unauth.status, 401);
  const wrongType = await raw('POST', '/api/tools/get_status', { ...auth, 'Content-Type': 'text/plain' }, '{}');
  assert.equal(wrongType.status, 400);
  assert.equal(calls.length, 0);
});

test('REST tool calls: success, error mapping, unknown tool, bad body', async () => {
  const ok = await requestJson({ port, method: 'POST', path: '/api/tools/list_tabs', token: TOKEN, body: { a: 1 } });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { ok: true, result: { echo: 'list_tabs', args: { a: 1 } } });
  const notFound = await requestJson({ port, method: 'POST', path: '/api/tools/close_tab', token: TOKEN, body: {} });
  assert.equal(notFound.status, 404);
  assert.equal((notFound.body as { error: { code: string } }).error.code, 'not_found');
  const readOnly = await requestJson({ port, method: 'POST', path: '/api/tools/set_model', token: TOKEN, body: {} });
  assert.equal(readOnly.status, 403);
  assert.equal((await requestJson({ port, method: 'POST', path: '/api/tools/nope', token: TOKEN, body: {} })).status, 404);
  const arrayBody = await raw('POST', '/api/tools/list_tabs', { ...auth, 'Content-Type': 'application/json' }, '[1]');
  assert.equal(arrayBody.status, 400);
  const badJson = await raw('POST', '/api/tools/list_tabs', { ...auth, 'Content-Type': 'application/json' }, '{oops');
  assert.equal(badJson.status, 400);
  const tools = await requestJson({ port, method: 'GET', path: '/api/tools', token: TOKEN });
  const names = (tools.body as { result: { tools: Array<{ name: string }> } }).result.tools.map((t) => t.name);
  assert.ok(names.includes('send_message'));
  assert.ok(!names.includes('list_instances'), 'local tools are not served by the window');
});

test('MCP over HTTP: initialize, tools/list, tools/call, notifications, batch, GET 405', async () => {
  const post = (body: unknown) => requestJson({ port, method: 'POST', path: '/mcp', token: TOKEN, body });
  const init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
  const initResult = (init.body as { result: Record<string, unknown> }).result;
  assert.equal(initResult.protocolVersion, '2025-06-18');
  assert.deepEqual(initResult.serverInfo, { name: 'claui', version: '9.9.9' });
  assert.equal(initResult.instructions, 'test instructions');
  const unknownVersion = await post({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } });
  assert.equal((unknownVersion.body as { result: { protocolVersion: string } }).result.protocolVersion, '2025-06-18');

  const notification = await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(notification.status, 202);

  const list = await post({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
  const tools = (list.body as { result: { tools: Array<{ name: string; annotations: Record<string, unknown> }> } }).result.tools;
  assert.ok(tools.find((t) => t.name === 'get_status')?.annotations.readOnlyHint);

  const call = await post({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_tab', arguments: { tabId: 2 } } });
  const callResult = (call.body as { result: { content: Array<{ text: string }>; isError: boolean } }).result;
  assert.equal(callResult.isError, false);
  assert.deepEqual(JSON.parse(callResult.content[0].text), { echo: 'get_tab', args: { tabId: 2 } });
  assert.equal(calls.at(-1)?.transport, 'mcp');

  const toolError = await post({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'close_tab', arguments: {} } });
  const errResult = (toolError.body as { result: { content: Array<{ text: string }>; isError: boolean } }).result;
  assert.equal(errResult.isError, true);
  assert.match(errResult.content[0].text, /not_found/);

  const unknownTool = await post({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'zzz' } });
  assert.equal((unknownTool.body as { error: { code: number } }).error.code, -32602);
  const unknownMethod = await post({ jsonrpc: '2.0', id: 7, method: 'sampling/createMessage' });
  assert.equal((unknownMethod.body as { error: { code: number } }).error.code, -32601);

  const batch = await post([
    { jsonrpc: '2.0', id: 8, method: 'ping' },
    { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } },
    { jsonrpc: '2.0', id: 9, method: 'tools/list' },
  ]);
  assert.ok(Array.isArray(batch.body));
  assert.deepEqual((batch.body as Array<{ id: number }>).map((r) => r.id), [8, 9]);

  assert.equal((await raw('GET', '/mcp', auth)).status, 405);
  assert.equal((await raw('POST', '/mcp', { ...auth, 'Content-Type': 'application/json' }, '{bad')).status, 400);
});

test('events: tail, since, long-poll', async () => {
  eventLog.record({ tabId: 'tab-1', direction: 'out', type: 'processBusy', data: { busy: true } });
  const tail = await requestJson({ port, method: 'GET', path: '/api/events?limit=5', token: TOKEN });
  const tailResult = (tail.body as { result: { events: Array<{ type: string }>; nextSeq: number } }).result;
  assert.equal(tailResult.events.at(-1)?.type, 'processBusy');

  const since = eventLog.lastSeq;
  setTimeout(() => eventLog.record({ tabId: 'tab-1', direction: 'out', type: 'turnComplete', data: {} }), 50);
  const polled = await requestJson({ port, method: 'GET', path: `/api/events?since=${since}&wait=3&types=turnComplete`, token: TOKEN });
  const polledResult = (polled.body as { result: { events: Array<{ type: string; seq: number }>; nextSeq: number } }).result;
  assert.deepEqual(polledResult.events.map((e) => e.type), ['turnComplete']);
  assert.equal(polledResult.nextSeq, polledResult.events[0].seq);
});

test('SSE stream needs the header token and delivers matching events', async () => {
  assert.equal((await raw('GET', '/api/events/stream')).status, 401);
  const received = await new Promise<string>((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method: 'GET', path: '/api/events/stream?tabId=tab-9', headers: auth },
      (res) => {
        assert.equal(res.statusCode, 200);
        assert.match(String(res.headers['content-type']), /text\/event-stream/);
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
          if (data.includes('event: assistantMessage')) {
            req.destroy();
            resolve(data);
          }
        });
        setTimeout(() => {
          eventLog.record({ tabId: 'tab-other', direction: 'out', type: 'error', data: {} });
          eventLog.record({ tabId: 'tab-9', direction: 'out', type: 'assistantMessage', data: { messageId: 'm' } });
        }, 50);
      },
    );
    req.on('error', (err) => ((err as NodeJS.ErrnoException).code === 'ECONNRESET' ? undefined : reject(err)));
    req.end();
  });
  assert.doesNotMatch(received, /event: error/);
  assert.match(received, /"messageId":"m"/);
});

test('a fixed port that is busy falls back to a random port', async () => {
  const second = new RemoteControlHttpServer(backend, { port, getToken: () => TOKEN });
  const secondPort = await second.start();
  assert.notEqual(secondPort, port);
  assert.equal(second.portFallback, true);
  await second.stop();
});

test('SSE: a client that stops reading is disconnected (bounded buffering)', async () => {
  const closed = await new Promise<boolean>((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method: 'GET', path: '/api/events/stream?includeLive=1&tabId=flood', headers: auth },
      (res) => {
        res.pause(); // never read
        res.on('close', () => resolve(true));
        res.on('error', () => resolve(true));
        const blob = 'x'.repeat(3900);
        for (let i = 0; i < 4000; i++) {
          eventLog.record({ tabId: 'flood', direction: 'out', type: 'streamingText', data: { text: blob } });
        }
        setTimeout(() => resolve(false), 5000);
      },
    );
    req.on('error', (err) => ((err as NodeJS.ErrnoException).code === 'ECONNRESET' ? resolve(true) : reject(err)));
    req.end();
  });
  assert.equal(closed, true);
  assert.equal(server.activeSseClients, 0);
});
