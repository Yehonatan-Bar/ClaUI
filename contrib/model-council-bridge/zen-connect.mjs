#!/usr/bin/env node
// One-command account connector for the ClaUi Zen backend.
//
//   node zen-connect.mjs openrouter   → OAuth PKCE: opens the browser, waits for
//                                       the user's approval click, exchanges the
//                                       code and saves openrouter-api-key.txt.
//   node zen-connect.mjs opencode     → opens a visible terminal running
//                                       `opencode auth login` (TUI + browser).
//
// The only human step is the sign-in/approve click in the browser — everything
// else (PKCE, callback capture, key exchange, key storage) is automated.

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const BASE = process.env.GROK_CLAUI_BASE || path.join(os.homedir(), '.grok-claui');
const OR_KEY_FILE = path.join(BASE, 'openrouter-api-key.txt');
const TIMEOUT_MS = Number(process.env.ZEN_CONNECT_TIMEOUT_MS || 10 * 60 * 1000);

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function openInBrowser(url) {
  // `start` needs the empty-title argument; windowsHide per the machine-wide
  // hidden-spawn rule (no black console flashes from background processes).
  spawn('cmd.exe', ['/c', 'start', '', url], { windowsHide: true, detached: true, stdio: 'ignore' }).unref();
}

async function connectOpenRouter() {
  if (fs.existsSync(OR_KEY_FILE) && fs.readFileSync(OR_KEY_FILE, 'utf8').trim()) {
    console.log('כבר קיים מפתח ב-' + OR_KEY_FILE + ' — לא נוגע. (מחק את הקובץ כדי לחבר מחדש.)');
    return;
  }
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());

  const server = http.createServer();
  const port = await new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
  const callbackUrl = `http://localhost:${port}/callback`;
  const authUrl =
    `https://openrouter.ai/auth?callback_url=${encodeURIComponent(callbackUrl)}` +
    `&code_challenge=${challenge}&code_challenge_method=S256`;

  console.log('פותח דפדפן לאישור OpenRouter…');
  console.log('אם הדפדפן לא נפתח, פתח ידנית:\n  ' + authUrl);
  openInBrowser(authUrl);

  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      server.close();
      reject(new Error(`לא התקבל אישור בתוך ${TIMEOUT_MS / 60000} דקות.`));
    }, TIMEOUT_MS);
    server.on('request', (req, res) => {
      const url = new URL(req.url, `http://localhost:${port}`);
      if (url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      const gotCode = url.searchParams.get('code');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        '<html dir="rtl"><body style="font-family:sans-serif;text-align:center;padding-top:4em">' +
        (gotCode
          ? '<h2>✅ החיבור הצליח</h2><p>המפתח נשמר במחשב. אפשר לסגור את הלשונית ולחזור ל-VS Code.</p>'
          : '<h2>❌ לא התקבל קוד</h2><p>נסה שוב מהטרמינל.</p>') +
        '</body></html>'
      );
      if (gotCode) {
        clearTimeout(timer);
        server.close();
        resolve(gotCode);
      }
    });
  });

  console.log('התקבל קוד אישור — מחליף למפתח API…');
  // If the login redirect dropped the code_challenge, the code is not PKCE-bound
  // and the server rejects the method field — fall through the variants.
  const attempts = [
    { code, code_verifier: verifier, code_challenge_method: 'S256' },
    { code, code_verifier: verifier },
    { code },
  ];
  let key = null;
  let lastErr = '';
  for (const body of attempts) {
    const res = await fetch('https://openrouter.ai/api/v1/auth/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const bodyText = await res.text();
    if (res.ok) {
      key = JSON.parse(bodyText)?.key || null;
      if (key) break;
      lastErr = 'exchange response contained no key: ' + bodyText.slice(0, 200);
    } else {
      lastErr = `key exchange failed ${res.status}: ${bodyText.slice(0, 240)}`;
      if (res.status >= 500) break; // server trouble — variants will not help
    }
  }
  if (!key) throw new Error(lastErr);

  fs.mkdirSync(BASE, { recursive: true });
  fs.writeFileSync(OR_KEY_FILE, key.trim() + '\n');
  console.log('✅ מפתח OpenRouter נשמר: ' + OR_KEY_FILE);
}

function connectOpenCode() {
  // The opencode login is a TUI + browser flow — give it a real visible terminal.
  console.log('פותח חלון טרמינל עם `opencode auth login` — בחר "opencode" ואשר בדפדפן.');
  spawn('cmd.exe', ['/c', 'start', 'OpenCode Zen Login', 'cmd', '/k', 'opencode auth login'], {
    windowsHide: true, detached: true, stdio: 'ignore',
  }).unref();
  console.log('אחרי הסיום האדפטר יקרא את המפתח אוטומטית מ-~/.local/share/opencode/auth.json');
}

const target = (process.argv[2] || 'openrouter').toLowerCase();
(async () => {
  if (target === 'openrouter' || target === 'or') await connectOpenRouter();
  else if (target === 'opencode' || target === 'oc' || target === 'zen') connectOpenCode();
  else {
    console.error('Usage: node zen-connect.mjs openrouter|opencode');
    process.exitCode = 2;
  }
})().catch((e) => {
  console.error('zen-connect error: ' + e.message);
  process.exitCode = 1;
});
