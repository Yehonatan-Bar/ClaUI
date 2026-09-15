import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as http from 'node:http';
import { OpenAiCompatBackend } from '../../src/bridge-runtime/backends/openaiCompat';
import { SessionStore } from '../../src/bridge-runtime/sessionStore';
import { StreamEmitter, BridgePrompt } from '../../src/bridge-runtime/protocol';

interface ServerHandle {
  port: number;
  lastBody: () => any;
  close: () => Promise<void>;
}

/** One-shot OpenAI-compatible server that records the request body and replies
 *  with `respond(res)`. */
function startServer(respond: (res: http.ServerResponse) => void): Promise<ServerHandle> {
  let lastBody: any = null;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        lastBody = JSON.parse(body);
      } catch {
        lastBody = body;
      }
      respond(res);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      resolve({
        port,
        lastBody: () => lastBody,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

function makeBackend(port: number): { backend: OpenAiCompatBackend; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claui-openai-'));
  const store = new SessionStore(dir);
  const backend = new OpenAiCompatBackend(
    { id: 'test', baseUrl: `http://127.0.0.1:${port}/v1`, models: ['m'] },
    'm',
    'sid',
    store,
    '',
  );
  return { backend, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

async function runQuietly(backend: OpenAiCompatBackend, prompt: BridgePrompt): Promise<string> {
  // StreamEmitter.out() writes stream-json to real stdout; silence THIS
  // emitter instance instead of monkey-patching the global
  // process.stdout.write — the global patch races with node:test's own TAP
  // reporter (which also writes to process.stdout), and depending on timing
  // can silently swallow every subsequent test's "ok N" line for the rest of
  // the file. (Same instance-scoped pattern already used by council.test.ts.)
  const emitter = new StreamEmitter('sid', 'm');
  (emitter as unknown as { out: (obj: unknown) => void }).out = () => {};
  return backend.runTurn(prompt, emitter);
}

test('OpenAI backend: streams SSE deltas into the full answer', async () => {
  const server = await startServer((res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n');
    res.write('data: {"choices":[{"delta":{"content":"lo"}}]}\n\n');
    res.write('data: [DONE]\n\n');
    res.end();
  });
  const { backend, cleanup } = makeBackend(server.port);
  const text = await runQuietly(backend, { text: 'hi', images: [] });
  assert.equal(text, 'Hello');
  cleanup();
  await server.close();
});

test('OpenAI backend: non-streaming body with no trailing newline is flushed', async () => {
  const server = await startServer((res) => {
    // A server that ignored stream:true and returned one JSON object, no newline.
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write('{"choices":[{"message":{"content":"Full answer"}}]}');
    res.end();
  });
  const { backend, cleanup } = makeBackend(server.port);
  const text = await runQuietly(backend, { text: 'hi', images: [] });
  assert.equal(text, 'Full answer');
  cleanup();
  await server.close();
});

test('OpenAI backend: images are forwarded as image_url parts', async () => {
  const server = await startServer((res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: {"choices":[{"delta":{"content":"ok"}}]}\n\n');
    res.write('data: [DONE]\n\n');
    res.end();
  });
  const { backend, cleanup } = makeBackend(server.port);
  await runQuietly(backend, {
    text: 'describe',
    images: [{ mediaType: 'image/png', data: 'AAAA' }],
  });
  const body = server.lastBody();
  const userMsg = body.messages[body.messages.length - 1];
  assert.ok(Array.isArray(userMsg.content));
  const imagePart = userMsg.content.find((p: { type: string }) => p.type === 'image_url');
  assert.ok(imagePart, 'expected an image_url content part');
  assert.equal(imagePart.image_url.url, 'data:image/png;base64,AAAA');
  cleanup();
  await server.close();
});

test('OpenAI backend: persistAs overrides stored history while the model still sees the full prompt text', async () => {
  const server = await startServer((res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: {"choices":[{"delta":{"content":"ok"}}]}\n\n');
    res.write('data: [DONE]\n\n');
    res.end();
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claui-openai-persist-'));
  try {
    const store = new SessionStore(dir);
    const backend = new OpenAiCompatBackend(
      { id: 'test', baseUrl: `http://127.0.0.1:${server.port}/v1`, models: ['m'] },
      'm',
      'sid',
      store,
      '',
    );
    await runQuietly(backend, { text: 'EXPANDED PACKET TEXT', images: [], persistAs: '/code-review' });

    const body = server.lastBody();
    const userMsg = body.messages[body.messages.length - 1];
    assert.equal(userMsg.content, 'EXPANDED PACKET TEXT'); // this turn's request uses the expanded text

    // History is [user, assistant] for this fresh session — the user entry
    // (index 0) must be the terse persisted command, not the expanded packet.
    const state = store.read('sid');
    assert.equal(state?.history?.[0]?.role, 'user');
    assert.equal(state?.history?.[0]?.content, '/code-review');
    assert.equal(state?.history?.[1]?.role, 'assistant');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    await server.close();
  }
});

test('OpenAI backend: surfaces a clear error on HTTP failure', async () => {
  const server = await startServer((res) => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end('{"error":"boom"}');
  });
  const { backend, cleanup } = makeBackend(server.port);
  await assert.rejects(
    () => runQuietly(backend, { text: 'hi', images: [] }),
    /HTTP 500/,
  );
  cleanup();
  await server.close();
});
