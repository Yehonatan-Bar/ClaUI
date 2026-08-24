#!/usr/bin/env node
// Free-cloud model bridge + model council — reference implementation for ClaUi.
// See README.md in this folder for the architecture and integration notes.
//
// Two OpenAI-compatible profiles behind one backend:
//   or → OpenRouter        https://openrouter.ai/api/v1   (key: openrouter-api-key.txt)
//   oc → OpenCode Zen      https://opencode.ai/zen/v1     (key: zen-api-key.txt, or
//        reused from `opencode auth login` → ~/.local/share/opencode/auth.json)
//
// Model id shape: zen::or/<model> | zen::oc/<model>
//   zen::or/stealth/ox-alpha      (Ox Alpha, 1M ctx, free Aug 2026)
//   zen::oc/x-preview-f-free      (same model on OpenCode Zen)
//   zen::oc/big-pickle            (stealth free)
//
// The gateways are stateless per-request, so this file owns the per-session chat
// history and resends the bounded thread every turn. Agent mode (cwd passed)
// runs a real tool loop via bridge-tools.mjs; free models that reject the
// `tools` param fall back to chat-only for the session.
//
// ⚠️ Privacy: free models on both gateways may retain prompts and/or train on
// them. The host should surface a reminder in the system preamble.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const BASE = process.env.GROK_CLAUI_BASE || path.join(os.homedir(), '.grok-claui');
const SESS_DIR = path.join(BASE, 'sessions');

const ZEN_TIMEOUT_MS = Number(process.env.ZEN_CLAUI_TIMEOUT_MS || 10 * 60 * 1000);
const MAX_HISTORY_MESSAGES = Number(process.env.ZEN_CLAUI_MAX_HISTORY || 40);
const MAX_TOOL_ITERATIONS = Number(process.env.ZEN_CLAUI_MAX_TOOL_ITERATIONS || 12);
const APPROVAL_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const APPROVAL_TTL_MS = 30 * 60 * 1000;

export const ZEN_PROFILES = {
  or: {
    label: 'OpenRouter',
    baseUrl: (process.env.ZEN_OR_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/+$/, ''),
    keyFile: process.env.ZEN_OR_KEY_FILE || path.join(BASE, 'openrouter-api-key.txt'),
    envKeys: ['ZEN_OR_API_KEY', 'OPENROUTER_API_KEY'],
    defaultModel: 'stealth/ox-alpha',
    extraHeaders: {
      'HTTP-Referer': 'https://github.com/local-claui-bridge',
      'X-Title': 'ClaUi bridge',
    },
  },
  oc: {
    label: 'OpenCode Zen',
    baseUrl: (process.env.ZEN_OC_BASE_URL || 'https://opencode.ai/zen/v1').replace(/\/+$/, ''),
    keyFile: process.env.ZEN_OC_KEY_FILE || path.join(BASE, 'zen-api-key.txt'),
    envKeys: ['ZEN_OC_API_KEY', 'OPENCODE_ZEN_API_KEY'],
    defaultModel: 'x-preview-f-free',
    extraHeaders: {},
  },
};

function keyFromFile(file) {
  try { return fs.readFileSync(file, 'utf8').trim(); } catch { return ''; }
}

/** `opencode auth login` credentials — reuse them so one login covers both tools. */
function opencodeAuthJsonKey() {
  const candidates = [
    path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'opencode', 'auth.json'),
  ];
  for (const authPath of candidates) {
    try {
      const auth = JSON.parse(fs.readFileSync(authPath, 'utf8'));
      const entry = auth && (auth.opencode || auth['opencode-zen'] || auth.zen);
      if (!entry) continue;
      if (typeof entry === 'string') return entry.trim();
      const key = String(entry.key || entry.apiKey || entry.api_key || '').trim();
      if (key) return key;
    } catch { /* try next */ }
  }
  return '';
}

export function zenApiKey(profileKey) {
  const profile = ZEN_PROFILES[profileKey];
  if (!profile) return '';
  for (const envName of profile.envKeys) {
    if (process.env[envName]) return String(process.env[envName]).trim();
  }
  const fromFile = keyFromFile(profile.keyFile);
  if (fromFile) return fromFile;
  if (profileKey === 'oc') return opencodeAuthJsonKey();
  return '';
}

export function zenConfiguredProfiles() {
  return Object.keys(ZEN_PROFILES).filter((p) => !!zenApiKey(p));
}

/** The picker/adapter treats Zen as available only when at least one key exists. */
export function zenConfigured() {
  return zenConfiguredProfiles().length > 0;
}

/**
 * zen::or/stealth/ox-alpha → { profile: 'or', modelId: 'stealth/ox-alpha' }.
 * Falls back to a CONFIGURED profile when the requested one has no key, and to
 * that profile's default model when no model id was given.
 */
export function resolveZenModel(scoped) {
  let value = String(scoped || '').trim();
  if (value.toLowerCase().startsWith('zen::')) value = value.slice('zen::'.length);
  else if (value.toLowerCase() === 'zen') value = '';
  let profileKey = '';
  let modelId = '';
  const m = value.match(/^(or|oc)\/(.*)$/i);
  if (m) {
    profileKey = m[1].toLowerCase();
    modelId = m[2];
  } else if (value) {
    // Bare model id — guess the profile by id shape (OpenRouter ids contain '/').
    profileKey = value.includes('/') || value.endsWith(':free') ? 'or' : 'oc';
    modelId = value;
  }
  const configured = zenConfiguredProfiles();
  if (!profileKey || (!configured.includes(profileKey) && configured.length)) {
    const fallback = configured[0] || profileKey || 'or';
    if (profileKey && profileKey !== fallback) modelId = ''; // model ids do not port across gateways
    profileKey = fallback;
  }
  if (!modelId) modelId = ZEN_PROFILES[profileKey]?.defaultModel || 'stealth/ox-alpha';
  return { profileKey, modelId, profile: ZEN_PROFILES[profileKey] };
}

export function defaultZenModel() {
  const { profileKey, modelId } = resolveZenModel('');
  return `zen::${profileKey}/${modelId}`;
}

// ---------------------------------------------------------------------------
// Live model catalogs (for the AI Picker) — both endpoints are open for GET.
// ---------------------------------------------------------------------------
export async function listZenModels({ fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  const out = [];
  const jobs = Object.entries(ZEN_PROFILES).map(async ([profileKey, profile]) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${profile.baseUrl}/models`, { signal: controller.signal });
      const body = await res.text();
      if (!res.ok) throw new Error(`${profile.label} models ${res.status}`);
      const data = JSON.parse(body)?.data || [];
      for (const model of data) {
        const id = String(model?.id || '').trim();
        if (!id) continue;
        const pricing = model?.pricing || {};
        const free = profileKey === 'or'
          ? Number(pricing.prompt) === 0 && Number(pricing.completion) === 0 && id !== 'openrouter/free'
          : /-free$/i.test(id) || id === 'big-pickle';
        if (!free) continue;
        // Chat models only — Lyria is music generation, content-safety is a
        // guard classifier; both are $0 but useless inside a coding chat.
        if (/lyria|content-safety/i.test(id)) continue;
        out.push({
          id: `zen::${profileKey}/${id}`,
          label: `${model?.name || id}`,
          profile: profileKey,
          contextLength: model?.context_length || null,
          // OpenRouter exposes tool-calling support + launch date; OpenCode Zen's
          // /models is bare, so those stay null there.
          toolsCapable: profileKey === 'or'
            ? Array.isArray(model?.supported_parameters) && model.supported_parameters.includes('tools')
            : null,
          createdAt: model?.created || null,
        });
      }
    } finally {
      clearTimeout(timer);
    }
  });
  await Promise.allSettled(jobs);
  return out;
}

// ---------------------------------------------------------------------------
// Session store — same shape as the session store below
// ---------------------------------------------------------------------------
function historyPath(sessionId) {
  const safe = String(sessionId || 'default').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180);
  return path.join(SESS_DIR, `zen-chat-${safe}.json`);
}

function loadState(sessionId) {
  try {
    const raw = JSON.parse(fs.readFileSync(historyPath(sessionId), 'utf8'));
    return {
      messages: Array.isArray(raw?.messages) ? raw.messages : [],
      pending: raw?.pending && typeof raw.pending === 'object' ? raw.pending : null,
      toolsUnsupported: !!raw?.toolsUnsupported,
      lastModel: raw?.lastModel || '',
    };
  } catch {
    return { messages: [], pending: null, toolsUnsupported: false, lastModel: '' };
  }
}

function saveState(sessionId, state) {
  try {
    fs.mkdirSync(SESS_DIR, { recursive: true });
    const file = historyPath(sessionId);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({
      backend: 'zen',
      messages: state.messages,
      pending: state.pending || null,
      toolsUnsupported: !!state.toolsUnsupported,
      lastModel: state.lastModel || '',
      updated: new Date().toISOString(),
    }));
    fs.renameSync(tmp, file);
  } catch {
    // History persistence is best-effort; a write failure must not drop the reply.
  }
}

/** Only non-system turns count — a lone seeded system preamble is still "empty". */
export function zenHistoryEmpty(sessionId) {
  return loadState(sessionId).messages.filter((m) => m.role !== 'system').length === 0;
}

// Keep at most one leading system message + the last N conversational turns; a
// `tool` message may not lead the window (its assistant parent was trimmed).
function boundedForRequest(messages) {
  const system = messages.filter((m) => m.role === 'system').slice(0, 1);
  const convo = messages.filter((m) => m.role !== 'system').slice(-MAX_HISTORY_MESSAGES);
  while (convo.length && convo[0].role === 'tool') convo.shift();
  return [...system, ...convo];
}

function newApprovalCode() {
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += APPROVAL_ALPHABET[Math.floor(Math.random() * APPROVAL_ALPHABET.length)];
  }
  return code;
}

function parseApproval(text) {
  const m = String(text || '').trim().match(/^(?:אשר|אישור|approve|ok)\s+([A-Za-z0-9]{6})$/i);
  return m ? m[1].toUpperCase() : null;
}

function isCancel(text) {
  return /^(?:בטל|ביטול|cancel|no|לא)$/i.test(String(text || '').trim());
}

function parseToolArguments(raw) {
  if (raw && typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw || '{}'));
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Council mode — one question, the WHOLE fleet in parallel, one synthesis.
// Trigger inside any Zen tab (or CLI): "/מועצה שאלה", "/council q", "התייעצות: q".
// Members via ZEN_COUNCIL_MODELS (comma-separated tokens, up to 6):
//   claude[::sonnet|opus|fable]  — claude.exe -p (subscription)
//   codex[::model]               — codex exec (ChatGPT subscription)
//   grok[::model]                — grok --prompt-file (SuperGrok)
//   zen::or/... | zen::oc/...    — free cloud gateways
// Unavailable members (missing exe/key) are silently skipped; a failing member
// shows an ❌ card and the council continues. Claude chairs when present.
// ---------------------------------------------------------------------------
const COUNCIL_TRIGGER = /^\s*(?:\/(?:council|panel|מועצה)|התייעצות\s*[::])\s*/i;
const COUNCIL_MEMBER_TIMEOUT_MS = Number(process.env.ZEN_COUNCIL_TIMEOUT_MS || 4 * 60 * 1000);
const COUNCIL_DEFAULT_MODELS =
  'claude::sonnet,codex,grok,zen::or/stealth/ox-alpha';
const COUNCIL_NPM_DIR = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'npm'
);
const COUNCIL_CLAUDE_EXE = path.join(
  COUNCIL_NPM_DIR, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'
);
const COUNCIL_GROK_EXE = path.join(
  COUNCIL_NPM_DIR, 'node_modules', '@xai-official', 'grok',
  'node_modules', '@xai-official', 'grok-win32-x64', 'bin', 'grok.exe'
);
const COUNCIL_CODEX_EXE = path.join(
  COUNCIL_NPM_DIR, 'node_modules', '@openai', 'codex',
  'node_modules', '@openai', 'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe'
);
const COUNCIL_ADVISOR_SYSTEM =
  'You are one advisor in a small council of AI models answering the same question independently. ' +
  'Answer directly and concretely in the language of the question. Be opinionated; skip hedging filler.';
const COUNCIL_CLI_PREFIX =
  'אתה יועץ אחד במועצת מודלים שעונים על אותה שאלה במקביל. ענה ישירות ותמציתית בשפת השאלה. ' +
  'אל תשתמש בכלים ואל תיגע בקבצים — תשובת טקסט בלבד.\n\nהשאלה: ';

/**
 * Parse a council trigger. Optional chair override right after the trigger:
 *   "/מועצה@grok שאלה"            → chair grok
 *   "/council @claude::opus q"     → chair claude opus
 *   "/מועצה יו"ר=codex שאלה"       → chair codex
 * Fallback chair: ZEN_COUNCIL_CHAIR env, else claude-if-answered, else first.
 */
export function parseCouncilRequest(text) {
  const m = String(text || '').match(COUNCIL_TRIGGER);
  if (!m) return null;
  let rest = String(text).slice(m[0].length).trim();
  let chairToken = '';
  const at = rest.match(/^@(\S+)\s*/);
  const kw = rest.match(/^(?:chair|יו"ר|יור)\s*[=:]\s*(\S+)\s*/i);
  if (at) {
    chairToken = at[1];
    rest = rest.slice(at[0].length).trim();
  } else if (kw) {
    chairToken = kw[1];
    rest = rest.slice(kw[0].length).trim();
  }
  return { question: rest, chairToken };
}

export function parseCouncilPrompt(text) {
  const req = parseCouncilRequest(text);
  return req ? req.question : null;
}

function parseCouncilMemberToken(token) {
  const t = String(token || '').trim();
  if (!t) return null;
  const low = t.toLowerCase();
  if (low === 'zen' || low.startsWith('zen')) {
    const { profileKey, modelId, profile } = resolveZenModel(t);
    if (!zenApiKey(profileKey)) return null;
    return { kind: 'zen', id: `${profileKey}/${modelId}`, profileKey, modelId, profile };
  }
  const [kind, modelId = ''] = low.split('::');
  if (kind === 'claude') {
    if (!fs.existsSync(COUNCIL_CLAUDE_EXE)) return null;
    const model = modelId || 'sonnet';
    return { kind, id: `claude/${model}`, modelId: model };
  }
  if (kind === 'codex') {
    if (!fs.existsSync(COUNCIL_CODEX_EXE)) return null;
    return { kind, id: modelId ? `codex/${modelId}` : 'codex', modelId };
  }
  if (kind === 'grok') {
    if (!fs.existsSync(COUNCIL_GROK_EXE)) return null;
    return { kind, id: modelId ? `grok/${modelId}` : 'grok', modelId };
  }
  return null;
}

function councilMembers() {
  const raw = process.env.ZEN_COUNCIL_MODELS || COUNCIL_DEFAULT_MODELS;
  const members = [];
  for (const token of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    const member = parseCouncilMemberToken(token);
    if (member && !members.some((m) => m.id === member.id)) members.push(member);
  }
  return members.slice(0, 6);
}

/** Run a CLI one-shot with stdin/argv input; windowsHide per the machine rule. */
function runOneShot(exe, args, { input = null, timeoutMs, cwd } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(exe, args, {
        cwd: cwd || os.tmpdir(),
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (e) {
      reject(e);
      return;
    }
    let out = '';
    let err = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { child.kill(); } catch { /* already dead */ }
        reject(new Error(`timeout after ${Math.round(timeoutMs / 1000)}s`));
      }
    }, timeoutMs);
    if (timer.unref) timer.unref();
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => {
      if (!settled) { settled = true; clearTimeout(timer); reject(e); }
    });
    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve(out.trim());
      else reject(new Error(`exit ${code}: ${(err || out).slice(0, 300)}`));
    });
    if (input != null) {
      try { child.stdin.write(input); } catch { /* stream closed */ }
    }
    try { child.stdin.end(); } catch { /* stream closed */ }
  });
}

async function askCouncilMember(member, question, { doFetch, timeoutMs }) {
  if (member.kind === 'zen') {
    const reply = await postChat({
      profile: member.profile,
      apiKey: zenApiKey(member.profileKey),
      model: member.modelId,
      messages: [
        { role: 'system', content: COUNCIL_ADVISOR_SYSTEM },
        { role: 'user', content: question },
      ],
      tools: null,
      timeoutMs,
      doFetch,
    });
    return (typeof reply?.content === 'string' && reply.content.trim()) || '(תשובה ריקה)';
  }
  if (member.kind === 'claude') {
    // Prompt via stdin — no argv quoting issues, no length limit.
    const text = await runOneShot(
      COUNCIL_CLAUDE_EXE, ['-p', '--model', member.modelId],
      { input: COUNCIL_CLI_PREFIX + question, timeoutMs }
    );
    return text || '(תשובה ריקה)';
  }
  if (member.kind === 'grok') {
    // --prompt-file avoids argv quoting/length limits.
    const pf = path.join(os.tmpdir(), `zen-council-grok-${process.pid}-${Math.random().toString(36).slice(2, 8)}.txt`);
    fs.writeFileSync(pf, COUNCIL_CLI_PREFIX + question, 'utf8');
    try {
      const args = ['--prompt-file', pf];
      if (member.modelId) args.push('-m', member.modelId);
      const text = await runOneShot(COUNCIL_GROK_EXE, args, { timeoutMs });
      return text || '(תשובה ריקה)';
    } finally {
      try { fs.rmSync(pf); } catch { /* temp */ }
    }
  }
  if (member.kind === 'codex') {
    const of = path.join(os.tmpdir(), `zen-council-codex-${process.pid}-${Math.random().toString(36).slice(2, 8)}.txt`);
    try {
      const args = ['exec', '--skip-git-repo-check', '-o', of];
      if (member.modelId) args.push('-m', member.modelId);
      args.push(COUNCIL_CLI_PREFIX + question);
      await runOneShot(COUNCIL_CODEX_EXE, args, { timeoutMs });
      const text = fs.existsSync(of) ? fs.readFileSync(of, 'utf8').trim() : '';
      return text || '(תשובה ריקה)';
    } finally {
      try { fs.rmSync(of); } catch { /* temp */ }
    }
  }
  throw new Error('unknown council member kind: ' + member.kind);
}

async function runCouncil(question, { emitCycle, doFetch, chairToken = '' }) {
  const members = councilMembers();
  if (members.length < 2) {
    throw new Error(
      'מועצה צריכה לפחות שני מודלים זמינים — בדוק שהכלים מותקנים/מחוברים, או הגדר ZEN_COUNCIL_MODELS.'
    );
  }
  const requestedChairToken = chairToken || process.env.ZEN_COUNCIL_CHAIR || '';
  const requestedChair = requestedChairToken ? parseCouncilMemberToken(requestedChairToken) : null;
  const chairNote = requestedChairToken && !requestedChair
    ? `_(היו"ר המבוקש \`${requestedChairToken}\` לא זמין — נבחר יו"ר אוטומטית)_`
    : '';
  const answers = await Promise.allSettled(members.map(async (member) => {
    const text = await askCouncilMember(member, question, {
      doFetch,
      timeoutMs: COUNCIL_MEMBER_TIMEOUT_MS,
    });
    // Progressive tool card in ClaUi the moment each advisor finishes.
    emitCycle({ name: 'consult', input: { model: member.id }, result: text.slice(0, 3500), isError: false });
    return text;
  }));
  const parts = members.map((member, i) => {
    const settled = answers[i];
    const ok = settled.status === 'fulfilled';
    const text = ok ? settled.value : `שגיאה: ${settled.reason?.message || settled.reason}`;
    if (!ok) emitCycle({ name: 'consult', input: { model: member.id }, result: String(text).slice(0, 400), isError: true });
    return { member, ok, text: String(text) };
  });
  const okParts = parts.filter((p) => p.ok);
  if (!okParts.length) {
    throw new Error('כל חברי המועצה נכשלו: ' + parts.map((p) => p.text).join(' | ').slice(0, 300));
  }

  // Chair: explicit request wins (may be an external judge that did not sit in
  // the council); else Claude when it answered; else the first member that did.
  let chair;
  let chairIsExternal = false;
  if (requestedChair) {
    const asMember = okParts.find((p) => p.member.id === requestedChair.id);
    if (asMember) {
      chair = asMember.member;
    } else {
      chair = requestedChair;
      chairIsExternal = true;
    }
  } else {
    chair = (okParts.find((p) => p.member.kind === 'claude') || okParts[0]).member;
  }
  let synthesis = '';
  if (okParts.length > 1) {
    const synthesisPrompt = [
      `השאלה שנשאלה: ${question}`,
      '',
      'להלן תשובות עצמאיות של מודלים שונים לאותה שאלה. תפקידך כיו"ר המועצה:',
      '1) נקודות הסכמה עיקריות  2) מחלוקות אמיתיות ומי משכנע יותר  3) המלצה סופית מעשית אחת.',
      'ענה בשפת השאלה, תמציתי וחד. אל תחזור על התשובות — סכם והכרע.',
      '',
      ...okParts.map((p) => `### תשובת ${p.member.id}\n${p.text.slice(0, 5000)}`),
    ].join('\n');
    try {
      synthesis = await askCouncilMember(chair, synthesisPrompt, {
        doFetch,
        timeoutMs: COUNCIL_MEMBER_TIMEOUT_MS,
      });
    } catch (e) {
      synthesis = `(הסינתזה נכשלה: ${e.message})`;
    }
  }
  const lines = [`## 🧠 מועצת מודלים — ${okParts.length}/${members.length} ענו`, ''];
  if (chairNote) {
    lines.push(chairNote);
    lines.push('');
  }
  for (const p of parts) {
    lines.push(`### ${p.ok ? '✅' : '❌'} ${p.member.id}`);
    lines.push(p.text.slice(0, 2500));
    lines.push('');
  }
  if (synthesis) {
    lines.push('---');
    lines.push(`## ⚖️ סיכום היו"ר (${chair.id}${chairIsExternal ? ' — שופט חיצוני' : ''})`);
    lines.push(synthesis);
  }
  return lines.join('\n');
}

const AGENT_RULES = [
  "You are running as a coding agent inside the user's real workspace, not as a chat model.",
  'You have tools that act on disk: read_file, write_file, edit_file, list_dir, search_files.',
  'When the user asks for a file, a page, a script or a fix — CALL write_file or edit_file and actually create it.',
  'NEVER print a whole file in the chat and ask the user to copy it into Notepad or save it by hand. That is a failure.',
  'Paths are relative to the workspace root. After writing, state briefly what you created and where.',
  'run_command does not execute on its own: it asks the user for approval first, so only request it when a command is truly required.',
].join(' ');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function errorMentionsTools(text) {
  return /tool|function[_ ]?call/i.test(String(text || ''));
}

async function postChat({ profile, apiKey, model, messages, tools, timeoutMs, doFetch }) {
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const body = { model, messages, stream: false };
      if (tools && tools.length) {
        body.tools = tools;
        body.tool_choice = 'auto';
      }
      const res = await doFetch(`${profile.baseUrl}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          ...profile.extraHeaders,
        },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      if (res.status === 429 || res.status === 502 || res.status === 503) {
        lastErr = new Error(`${profile.label} HTTP ${res.status}: ${text.slice(0, 240)}`);
        clearTimeout(timer);
        await sleep(Math.min(5000 * (attempt + 1), 20000));
        continue;
      }
      if (!res.ok) {
        const err = new Error(`${profile.label} HTTP ${res.status}: ${text.slice(0, 400)}`);
        err.status = res.status;
        err.bodyText = text;
        throw err;
      }
      const parsed = JSON.parse(text);
      // Some gateways return 200 with an error envelope (OpenRouter does for
      // upstream provider failures) — surface it instead of an empty reply.
      if (parsed?.error) {
        const err = new Error(`${profile.label}: ${parsed.error.message || JSON.stringify(parsed.error).slice(0, 300)}`);
        err.status = parsed.error.code;
        throw err;
      }
      return parsed?.choices?.[0]?.message || {};
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error(`${profile.label} request timed out after ${timeoutMs / 1000}s.`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr || new Error(`${profile.label}: retries exhausted`);
}

/**
 * Run one Zen turn against the selected free-cloud gateway and persist the thread.
 * Passing `cwd` switches the turn into agent mode (tool loop via bridge-tools.mjs).
 * @param {string} prompt user text for this turn
 * @param {{ sessionId?: string, systemPreamble?: string, model?: string, timeoutMs?: number,
 *           fetchImpl?: typeof fetch, cwd?: string,
 *           onToolCycle?: (cycle: { name: string, input: object, result: string, isError?: boolean }) => void
 *         }} [opts]
 * @returns {Promise<string>} assistant reply text
 */
export async function handleZenMessage(prompt, opts = {}) {
  const sessionId = opts.sessionId || 'default';
  const { profileKey, modelId, profile } = resolveZenModel(opts.model || '');
  const apiKey = zenApiKey(profileKey);
  if (!apiKey) {
    throw new Error(
      `Zen API key missing. Save one to ${ZEN_PROFILES.or.keyFile} (OpenRouter) ` +
      `or ${ZEN_PROFILES.oc.keyFile} (OpenCode Zen) / run \`opencode auth login\`.`
    );
  }
  const doFetch = opts.fetchImpl || fetch;
  const timeoutMs = opts.timeoutMs || ZEN_TIMEOUT_MS;
  const root = opts.cwd ? path.resolve(opts.cwd) : '';
  const agentMode = !!root;
  const emitCycle = typeof opts.onToolCycle === 'function' ? opts.onToolCycle : () => {};

  const state = loadState(sessionId);
  const messages = state.messages;
  let pending = state.pending;
  state.lastModel = `zen::${profileKey}/${modelId}`;

  if (messages.filter((m) => m.role !== 'system').length === 0) {
    const preamble = [agentMode ? AGENT_RULES : '', opts.systemPreamble || ''].filter(Boolean).join('\n\n');
    if (preamble) messages.unshift({ role: 'system', content: preamble });
  }

  // "/מועצה [@יו"ר] שאלה" — fan the question out to the model council, then
  // synthesize. Handled before the agent loop; the session thread keeps only
  // the question + the synthesized answer.
  const councilRequest = parseCouncilRequest(prompt);
  if (councilRequest && councilRequest.question) {
    const finalText = await runCouncil(councilRequest.question, {
      emitCycle,
      doFetch,
      chairToken: councilRequest.chairToken,
    });
    messages.push({ role: 'user', content: `[מועצת מודלים] ${councilRequest.question}` });
    messages.push({ role: 'assistant', content: finalText });
    state.messages = boundedForRequest(messages);
    state.pending = pending;
    saveState(sessionId, state);
    return finalText;
  }

  let tools = null;
  let toolsMod = null;
  if (agentMode && !state.toolsUnsupported) {
    toolsMod = await import(new URL('./bridge-tools.mjs', import.meta.url).href);
    tools = toolsMod.BRIDGE_TOOL_SCHEMAS;
  } else if (agentMode) {
    toolsMod = await import(new URL('./bridge-tools.mjs', import.meta.url).href);
  }

  // A parked shell command is resolved before anything is sent to the model.
  const approvalCode = parseApproval(prompt);
  let userText = String(prompt ?? '');
  if (pending && agentMode) {
    if (approvalCode && approvalCode === pending.code && Date.now() - (pending.at || 0) < APPROVAL_TTL_MS) {
      const outcome = await toolsMod.runApprovedCommand(root, pending.command);
      emitCycle({
        name: 'run_command',
        input: { command: pending.command, approved: true },
        result: outcome.text,
        isError: outcome.isError,
      });
      userText = `[The user approved the command. It ran in the workspace.]\n$ ${pending.command}\n${outcome.text}`;
      pending = null;
    } else if (isCancel(prompt) || (approvalCode && approvalCode !== pending.code)) {
      userText = `[The user did not approve the command \`${pending.command}\`. Do not ask for it again unless they bring it up. Continue without it.]`;
      pending = null;
    }
  } else if (approvalCode) {
    userText = `${prompt}\n\n[There is no command waiting for approval.]`;
  }
  messages.push({ role: 'user', content: userText });

  let finalText = '';
  for (let iteration = 0; iteration < (agentMode ? MAX_TOOL_ITERATIONS : 1); iteration += 1) {
    let reply;
    try {
      reply = await postChat({
        profile,
        apiKey,
        model: modelId,
        messages: boundedForRequest(messages),
        tools,
        timeoutMs,
        doFetch,
      });
    } catch (error) {
      // Free models that reject the tools param → drop to chat-only for good.
      if (tools && (error.status === 400 || error.status === 404 || error.status === 422) &&
          errorMentionsTools(error.bodyText || error.message)) {
        state.toolsUnsupported = true;
        tools = null;
        reply = await postChat({
          profile,
          apiKey,
          model: modelId,
          messages: boundedForRequest(messages),
          tools: null,
          timeoutMs,
          doFetch,
        });
      } else {
        throw error;
      }
    }
    const calls = Array.isArray(reply?.tool_calls) ? reply.tool_calls : [];
    const content = typeof reply?.content === 'string' ? reply.content : '';

    if (!agentMode || !tools || calls.length === 0) {
      finalText = content;
      if (finalText) messages.push({ role: 'assistant', content: finalText });
      break;
    }

    // Keep the assistant turn that owns these tool_calls — required as the
    // parent of every following `tool` message.
    messages.push({ role: 'assistant', content: content || null, tool_calls: calls });

    let parked = false;
    for (const call of calls) {
      const name = call?.function?.name || '';
      const args = parseToolArguments(call?.function?.arguments);
      const callId = call?.id || `call_${Math.random().toString(36).slice(2, 12)}`;
      let result;
      let isError = false;

      if (name === 'run_command') {
        const command = String(args.command || '').trim();
        if (!command) {
          result = 'refused: empty command';
          isError = true;
        } else {
          pending = { code: newApprovalCode(), command, why: String(args.why || ''), at: Date.now() };
          parked = true;
          result =
            `NOT EXECUTED — waiting for the user. Tell the user what this command does and ask them to reply exactly: אשר ${pending.code}` +
            ' (or "בטל" to skip it). Do not claim it ran.';
        }
      } else {
        try {
          const outcome = await toolsMod.executeBridgeTool(name, args, { root });
          result = outcome.text;
          isError = !!outcome.isError;
        } catch (error) {
          result = `error: ${error.message}`;
          isError = true;
        }
      }

      emitCycle({ name, input: args, result, isError });
      messages.push({ role: 'tool', tool_call_id: callId, content: String(result).slice(0, 8000) });
    }

    if (parked) {
      const closing = await postChat({
        profile,
        apiKey,
        model: modelId,
        messages: boundedForRequest(messages),
        tools: null,
        timeoutMs,
        doFetch,
      });
      finalText =
        (typeof closing?.content === 'string' && closing.content) ||
        `כדי להריץ:\n\`${pending.command}\`\nענה: אשר ${pending.code}`;
      messages.push({ role: 'assistant', content: finalText });
      break;
    }

    if (iteration === MAX_TOOL_ITERATIONS - 1) {
      finalText = content || `(עצרתי אחרי ${MAX_TOOL_ITERATIONS} צעדי כלים — בקש ממני להמשיך.)`;
      messages.push({ role: 'assistant', content: finalText });
    }
  }

  state.messages = boundedForRequest(messages);
  state.pending = pending;
  saveState(sessionId, state);
  return finalText;
}

// Standalone probe:
//   node zen-chat.mjs "hello" [--model zen::or/stealth/ox-alpha] [--agent <dir>]
//   node zen-chat.mjs --list           (free models on both gateways)
function isCliInvocation() {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
}

if (isCliInvocation()) {
  const argv = process.argv.slice(2);
  if (argv.includes('--list')) {
    listZenModels().then((models) => {
      for (const m of models) console.log(`${m.id}  ctx=${m.contextLength || '?'}  ${m.label}`);
      process.exit(0);
    }).catch((e) => { console.error(e.message); process.exit(1); });
  } else {
    const modelAt = argv.indexOf('--model');
    const model = modelAt >= 0 ? argv[modelAt + 1] || '' : '';
    const agentAt = argv.indexOf('--agent');
    const cwd = agentAt >= 0 ? argv[agentAt + 1] || process.cwd() : '';
    const drop = new Set();
    if (modelAt >= 0) { drop.add(modelAt); drop.add(modelAt + 1); }
    if (agentAt >= 0) { drop.add(agentAt); drop.add(agentAt + 1); }
    const prompt = argv.filter((_, i) => !drop.has(i)).join(' ') || 'Reply with exactly: PONG';
    handleZenMessage(prompt, {
      sessionId: process.env.ZEN_CLAUI_PROBE_SESSION || `cli-probe-${process.pid}`,
      model,
      cwd,
      onToolCycle: (c) =>
        console.error(`  [tool] ${c.name}${c.isError ? ' ERROR' : ''} ${JSON.stringify(c.input).slice(0, 140)}`),
    })
      .then((reply) => {
        console.log(reply);
        process.exit(0);
      })
      .catch((error) => {
        console.error(`zen-chat error: ${error.message}`);
        // exitCode (not exit()) — hard exit while undici sockets are closing
        // triggers a libuv assertion on Windows.
        process.exitCode = 1;
      });
  }
}
