import { ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as os from 'os';
import * as path from 'path';
import { URL } from 'url';
import { BridgeConfig, OpenAiCompatProvider, resolveOpenAiApiKey } from '../config';
import { killTreeAsync, resolveExecutable, spawnCli, whichSync } from '../procUtils';
import { BridgePrompt, imagesOmittedNote, StreamEmitter } from '../protocol';
import { SessionStore } from '../sessionStore';
import { grokKnownLocations, runGrokCouncilPrompt } from './grokAcp';

/**
 * Native model council.
 *
 * Selecting `bridge:council[/<chair>]` turns a tab into a council: each user
 * turn fans out in parallel to several engines ("members"), each independent
 * opinion is streamed as an assistant TEXT section, and a selectable chair then
 * synthesizes a single ruling. Output is plain streamed text (never tool cards),
 * so the whole answer lands as one assistant message + exactly one result.
 *
 * Trust model (v1): members are structurally incapable of mutating anything.
 * - openai members: plain HTTP chat-completions with NO `tools` param.
 * - codex members: `codex exec --sandbox read-only --ephemeral` in a throwaway
 *   temp cwd.
 * - grok members: an ACP session in a throwaway temp cwd that rejects every
 *   tool-permission request (text-only).
 * - claude members: `claude -p --restricted --permission-prompts none` in a
 *   throwaway temp cwd. `--restricted` removes the command/code-running tools
 *   (Bash) and confines file tools to the throwaway cwd; `--permission-prompts
 *   none` auto-denies anything that would prompt; `--strict-mcp-config` with an
 *   empty config loads no MCP servers. Uses the user's existing Claude Code
 *   login (no `--bare`), so their user-level settings/hooks may still load, but
 *   the flags above make the turn non-mutating outside the throwaway cwd.
 * The Antigravity local CLI is DEFERRED to v2 (it cannot be proven non-mutating
 * without an OS sandbox); its tokens parse but report UNAVAILABLE.
 */

type CouncilEngine = 'codex' | 'grok' | 'antigravity' | 'claude' | 'openai';

export interface CouncilMember {
  engine: CouncilEngine;
  /** Engine model id ('' = engine default). */
  model: string;
  /** openai only: configured provider profile id. */
  providerId?: string;
  /** Normalized dedupe key + shown id (e.g. `codex`, `grok/grok-4.5`, `openai/or/x`). */
  displayId: string;
  /** Original token as configured. */
  token: string;
}

export interface MemberResult {
  ok: boolean;
  text?: string;
  reason?: string;
}

const DEFAULT_TIMEOUT_MS = 240000;
const MIN_TIMEOUT_MS = 15000;
const MAX_TIMEOUT_MS = 600000;
const MAX_MEMBERS = 6;
const DEFAULT_MEMBERS = ['codex', 'grok'];
const DEFERRED_REASON =
  'deferred to v2: the local subscription CLI needs a verified OS sandbox to guarantee no mutation';

/** Parse a single member/chair token into a structured member, or null if the
 *  grammar is not recognized. Grammar (separator `/`):
 *   - `codex[/<model>]`, `grok[/<model>]`, `antigravity[/<model>]`, `claude[/<model>]`
 *   - `openai/<providerId>/<model...>` (model may itself contain `/`). */
export function parseMemberToken(token: string): CouncilMember | null {
  const t = String(token || '').trim();
  if (!t) return null;
  const slash = t.indexOf('/');
  const head = slash < 0 ? t : t.slice(0, slash);
  const tail = slash < 0 ? '' : t.slice(slash + 1);

  if (head === 'openai') {
    const slash2 = tail.indexOf('/');
    if (slash2 < 0) return null; // needs both a provider id AND a model
    const providerId = tail.slice(0, slash2).trim();
    const model = tail.slice(slash2 + 1).trim();
    if (!providerId || !model) return null;
    return { engine: 'openai', providerId, model, token: t, displayId: `openai/${providerId}/${model}` };
  }
  if (head === 'codex' || head === 'grok' || head === 'antigravity' || head === 'claude') {
    const model = tail.trim();
    return { engine: head, model, token: t, displayId: model ? `${head}/${model}` : head };
  }
  return null;
}

/** Build the roster from member tokens: parse, drop unrecognized, dedupe by
 *  normalized display id, cap at MAX_MEMBERS. */
export function buildRoster(members: string[]): CouncilMember[] {
  const roster: CouncilMember[] = [];
  const seen = new Set<string>();
  for (const tok of members) {
    const m = parseMemberToken(String(tok || ''));
    if (!m || seen.has(m.displayId)) continue;
    seen.add(m.displayId);
    roster.push(m);
    if (roster.length >= MAX_MEMBERS) break;
  }
  return roster;
}

/** Known Codex CLI install locations (npm-global, standard installers, and
 *  editor-bundled OpenAI extensions). Kept self-contained in the runtime bundle
 *  (it cannot import the extension's CodexCliDetector). Used for BOTH detection
 *  and invocation so the two never disagree. */
export function codexKnownLocations(): string[] {
  const home = os.homedir();
  const out: string[] = [];
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || '';
    const userProfile = process.env.USERPROFILE || home;
    const localApp = process.env.LOCALAPPDATA || '';
    if (appData) out.push(path.join(appData, 'npm', 'codex.cmd'), path.join(appData, 'npm', 'codex.exe'));
    out.push(
      path.join(userProfile, '.npm-global', 'bin', 'codex.cmd'),
      path.join(userProfile, '.npm-global', 'bin', 'codex.exe'),
    );
    if (localApp) {
      out.push(
        path.join(localApp, 'Programs', 'Codex', 'codex.exe'),
        path.join(localApp, 'Programs', 'OpenAI Codex', 'codex.exe'),
      );
    }
  } else {
    out.push('/usr/local/bin/codex', '/opt/homebrew/bin/codex', path.join(home, '.local', 'bin', 'codex'));
  }
  // Editor-bundled (VS Code / Insiders / Cursor / Windsurf) OpenAI extensions.
  const editorRoots = [
    path.join(home, '.vscode', 'extensions'),
    path.join(home, '.vscode-insiders', 'extensions'),
    path.join(home, '.cursor', 'extensions'),
    path.join(home, '.windsurf', 'extensions'),
  ];
  const names = process.platform === 'win32' ? ['codex.exe', 'codex.cmd'] : ['codex'];
  for (const root of editorRoots) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.toLowerCase().includes('openai')) continue;
      const base = path.join(root, entry.name, 'bin');
      let pdirs: fs.Dirent[];
      try {
        pdirs = fs.readdirSync(base, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const pdir of pdirs) {
        if (!pdir.isDirectory()) continue;
        for (const n of names) out.push(path.join(base, pdir.name, n));
      }
    }
  }
  return out;
}

/** Known Claude Code CLI install locations (npm-global shims, native/local
 *  installer, and PATH-style bin dirs). Self-contained in the runtime bundle so
 *  detection and invocation never disagree. */
export function claudeKnownLocations(): string[] {
  const home = os.homedir();
  const out: string[] = [];
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || '';
    const userProfile = process.env.USERPROFILE || home;
    const localApp = process.env.LOCALAPPDATA || '';
    if (appData) out.push(path.join(appData, 'npm', 'claude.cmd'), path.join(appData, 'npm', 'claude.exe'));
    out.push(
      path.join(userProfile, '.npm-global', 'bin', 'claude.cmd'),
      path.join(userProfile, '.npm-global', 'bin', 'claude.exe'),
      path.join(userProfile, '.local', 'bin', 'claude.exe'),
      path.join(userProfile, '.claude', 'local', 'claude.exe'),
    );
    if (localApp) out.push(path.join(localApp, 'Programs', 'claude', 'claude.exe'));
  } else {
    out.push(
      '/usr/local/bin/claude',
      '/opt/homebrew/bin/claude',
      path.join(home, '.local', 'bin', 'claude'),
      path.join(home, '.claude', 'local', 'claude'),
    );
  }
  return out;
}

/** True when a configured CLI resolves to a concrete existing executable:
 *  an absolute path that exists, a known install location, or a PATH hit.
 *  (Detection is separate from invocation — never treat a bare unresolved
 *  command as "available".) */
export function cliExists(configured: string, fallback: string, known: string[]): boolean {
  const c = (configured || fallback).trim() || fallback;
  if (path.isAbsolute(c)) return fs.existsSync(c);
  for (const loc of known) if (loc && fs.existsSync(loc)) return true;
  return !!whichSync(c);
}

/** Build the chair synthesis prompt in STABLE ROSTER ORDER (independent of the
 *  order members happened to finish in), referencing each member by id. */
export function buildSynthesisPrompt(
  question: string,
  successes: CouncilMember[],
  results: Map<CouncilMember, MemberResult>,
): string {
  const parts: string[] = [
    "You are the chair of a model council. Several assistants independently answered the user's " +
      'question. Synthesize a single, clear final answer: note where they agree, resolve ' +
      'disagreements on the merits, and correct any errors. Do not merely list what each said — ' +
      'deliver one authoritative ruling.',
    '',
    'User question:',
    question,
    '',
    'Council opinions:',
  ];
  for (const m of successes) {
    parts.push(`### ${m.displayId}`);
    parts.push((results.get(m)?.text || '').trim());
    parts.push('');
  }
  parts.push('Final synthesized ruling:');
  return parts.join('\n');
}

/** Optional test seam: inject a fake member invoker and lower the timeout floor. */
export interface CouncilTestOptions {
  invoke?: (member: CouncilMember, question: string, signal: AbortSignal) => Promise<string>;
  minTimeoutMs?: number;
}

export class CouncilBackend {
  private generation = 0;
  private cancelled = false;
  private readonly activeControllers = new Set<AbortController>();
  private readonly activeChildren = new Set<ChildProcess>();
  /** Children spawned during the current turn (for deferred temp-dir cleanup). */
  private turnChildren: ChildProcess[] = [];
  private readonly testInvoke?: CouncilTestOptions['invoke'];
  private readonly minTimeout: number;

  constructor(
    private readonly config: BridgeConfig,
    private readonly chairToken: string | undefined,
    private readonly sessionId: string,
    private readonly store: SessionStore,
    private readonly systemPrompt: string,
    private readonly log: (msg: string) => void,
    options?: CouncilTestOptions,
  ) {
    // Constructor only stores refs — ALL validation happens inside runTurn (it
    // runs inside cli.ts's pump try; construction does not), so no recoverable
    // issue can throw before the turn loop's error handling is in place.
    this.testInvoke = options?.invoke;
    this.minTimeout = options?.minTimeoutMs ?? MIN_TIMEOUT_MS;
  }

  interrupt(): void {
    // Set the flag, abort every in-flight controller, and kill every active
    // child WITHOUT awaiting — then return immediately so the stdin control-ack
    // is not delayed by a blocking taskkill.
    this.cancelled = true;
    for (const c of this.activeControllers) {
      try {
        c.abort();
      } catch {
        /* ignore */
      }
    }
    for (const child of this.activeChildren) killTreeAsync(child);
  }

  dispose(): void {
    this.cancelled = true;
    for (const child of this.activeChildren) killTreeAsync(child);
  }

  private isStale(gen: number): boolean {
    return this.cancelled || gen !== this.generation;
  }

  private timeoutMs(): number {
    const raw = Number(this.config.council?.timeoutMs);
    const base = !Number.isFinite(raw) || raw <= 0 ? DEFAULT_TIMEOUT_MS : Math.round(raw);
    return Math.min(MAX_TIMEOUT_MS, Math.max(this.minTimeout, base));
  }

  private memberAvailable(m: CouncilMember): { available: boolean; reason?: string } {
    if (m.engine === 'antigravity') {
      return { available: false, reason: DEFERRED_REASON };
    }
    if (m.engine === 'claude') {
      return cliExists(this.config.claude?.cliPath || 'claude', 'claude', claudeKnownLocations())
        ? { available: true }
        : {
            available: false,
            reason: 'Claude Code CLI not found (install Claude Code and sign in, or set claudeMirror.cliPath)',
          };
    }
    if (m.engine === 'codex') {
      return cliExists(this.config.codex?.cliPath || 'codex', 'codex', codexKnownLocations())
        ? { available: true }
        : { available: false, reason: 'Codex CLI not found (install it or set claudeMirror.codex.cliPath)' };
    }
    if (m.engine === 'grok') {
      return cliExists(this.config.grok?.cliPath || 'grok', 'grok', grokKnownLocations())
        ? { available: true }
        : {
            available: false,
            reason: 'Grok CLI not found (npm i -g @xai-official/grok, then `grok login`)',
          };
    }
    if (m.engine === 'openai') {
      const provider = (this.config.openai || []).find((p) => p.id === m.providerId);
      if (!provider) {
        return { available: false, reason: `unknown OpenAI-compatible provider '${m.providerId}'` };
      }
      const declaresKey = !!(provider.apiKey || provider.apiKeyEnv || provider.apiKeyFile);
      if (declaresKey && !resolveOpenAiApiKey(provider)) {
        return { available: false, reason: `API key not resolved for provider '${m.providerId}'` };
      }
      return { available: true };
    }
    return { available: false, reason: 'unknown engine' };
  }

  /** Create a private throwaway working dir for CLI members. Returns null on
   *  failure — we NEVER fall back to the shared system temp dir (that would run
   *  CLI members in a non-isolated cwd and defeat the isolation boundary). */
  private makeTmpDir(): string | null {
    try {
      return fs.mkdtempSync(path.join(os.tmpdir(), 'claui-council-'));
    } catch {
      return null;
    }
  }

  private cleanupTmp(dir: string | null): void {
    if (!dir) return;
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {
      /* best-effort */
    }
  }

  /** Route a member (or chair) to its engine. Registers spawned children so an
   *  interrupt/timeout can kill them. */
  private dispatch(m: CouncilMember, question: string, signal: AbortSignal, tmpCwd: string): Promise<string> {
    if (this.testInvoke) return this.testInvoke(m, question, signal);
    const onChild = (c: ChildProcess): void => {
      this.activeChildren.add(c);
      this.turnChildren.push(c);
      // Remove only on CONFIRMED termination — 'exit'/'close'. An 'error' event
      // does not prove the process is gone (it can mean a kill failed), so it
      // must NOT untrack; a genuine spawn failure still emits 'close' afterward.
      // Keep a no-op 'error' listener so an emitted error can't crash the bridge.
      const remove = (): void => {
        this.activeChildren.delete(c);
      };
      c.on('exit', remove);
      c.on('close', remove);
      c.on('error', () => {});
    };
    if (m.engine === 'codex') {
      const { command } = resolveExecutable(this.config.codex?.cliPath || 'codex', 'codex', codexKnownLocations());
      const fullPrompt = this.systemPrompt
        ? `<system-rules>\n${this.systemPrompt}\n</system-rules>\n\n${question}`
        : question;
      return invokeCodexCouncil(command, m.model, fullPrompt, tmpCwd, signal, onChild, this.log);
    }
    if (m.engine === 'claude') {
      const { command } = resolveExecutable(
        this.config.claude?.cliPath || 'claude',
        'claude',
        claudeKnownLocations(),
      );
      const fullPrompt = this.systemPrompt
        ? `<system-rules>\n${this.systemPrompt}\n</system-rules>\n\n${question}`
        : question;
      return invokeClaudeCouncil(command, m.model, fullPrompt, tmpCwd, signal, onChild, this.log);
    }
    if (m.engine === 'grok') {
      return runGrokCouncilPrompt(
        this.config.grok?.cliPath || 'grok',
        m.model,
        this.systemPrompt,
        question,
        tmpCwd,
        signal,
        onChild,
        this.log,
      );
    }
    if (m.engine === 'openai') {
      const provider = (this.config.openai || []).find((p) => p.id === m.providerId);
      if (!provider) return Promise.reject(new Error(`unknown provider '${m.providerId}'`));
      const messages: { role: string; content: string }[] = [];
      if (this.systemPrompt) messages.push({ role: 'system', content: this.systemPrompt });
      messages.push({ role: 'user', content: question });
      return invokeOpenAiCouncil(provider, m.model, messages, signal);
    }
    return Promise.reject(new Error(`engine '${m.engine}' is not invocable in v1`));
  }

  /** Invoke one member with a per-member timeout + cancellation. Never throws:
   *  every failure mode is returned as `{ ok:false, reason }`. */
  private async invokeMember(
    m: CouncilMember,
    question: string,
    timeoutMs: number,
    tmpCwd: string,
  ): Promise<MemberResult> {
    const controller = new AbortController();
    this.activeControllers.add(controller);
    let timedOut = false;
    // NOT unref'd: while a member is in flight, this timer is the thing that
    // enforces the deadline; it is always cleared in the finally on settle.
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        controller.abort();
      } catch {
        /* ignore */
      }
    }, timeoutMs);
    // Race the dispatch against an abort signal so the member ALWAYS settles on
    // timeout/interrupt — even if a misbehaving invoker (or a dead child whose
    // request never rejects) ignores the abort. The abort also triggers a
    // killTreeAsync inside each invoker, so the underlying work is torn down.
    const abortP = new Promise<never>((_, reject) => {
      if (controller.signal.aborted) {
        reject(new Error('aborted'));
      } else {
        controller.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      }
    });
    try {
      const dispatchP = this.dispatch(m, question, controller.signal, tmpCwd);
      // If the abort wins the race, the dispatch promise may still reject later;
      // swallow it so it is never an unhandled rejection.
      dispatchP.catch(() => {});
      const text = await Promise.race([dispatchP, abortP]);
      if (!text || !text.trim()) return { ok: false, reason: 'empty response' };
      return { ok: true, text: text.trim() };
    } catch (e) {
      if (this.cancelled) return { ok: false, reason: 'cancelled' };
      if (timedOut) return { ok: false, reason: `timed out after ${Math.round(timeoutMs / 1000)}s` };
      return { ok: false, reason: (e instanceof Error ? e.message : String(e)).slice(0, 400) };
    } finally {
      clearTimeout(timer);
      this.activeControllers.delete(controller);
    }
  }

  /** Chair precedence: explicit `bridge:council/<chair>` > config.council.chair >
   *  first available `claude` (preferred default synthesizer) > first available
   *  roster member. An available chair token that is NOT a roster member is used
   *  as an external judge (labelled). */
  private pickChair(
    roster: CouncilMember[],
    available: CouncilMember[],
  ): { member: CouncilMember; label: string } {
    const rosterIds = new Set(roster.map((m) => m.displayId));
    const tryToken = (tok: string | undefined): { member: CouncilMember; label: string } | null => {
      const parsed = parseMemberToken(String(tok || ''));
      if (!parsed || !this.memberAvailable(parsed).available) return null;
      const external = !rosterIds.has(parsed.displayId);
      return { member: parsed, label: external ? `${parsed.displayId} — external judge` : parsed.displayId };
    };
    const explicit = tryToken(this.chairToken) || tryToken(this.config.council?.chair);
    if (explicit) return explicit;
    // Prefer an available claude as the default synthesizer, else the first
    // available roster member.
    const member = available.find((m) => m.engine === 'claude') || available[0];
    return { member, label: member.displayId };
  }

  async runTurn(prompt: BridgePrompt, emitter: StreamEmitter): Promise<string> {
    const gen = ++this.generation;
    this.cancelled = false;
    // Do NOT clear activeControllers/activeChildren here — they self-remove when
    // their work settles (controllers in invokeMember's finally; children on
    // exit/close/error). Clearing could forget a child from a prior turn that is
    // still terminating, orphaning it. Start a fresh per-turn child list.
    this.turnChildren = [];

    let transcript = '';
    const emit = (text: string): void => {
      if (this.isStale(gen)) return; // suppress late/cancelled appends
      transcript += text;
      emitter.append('text', text);
    };

    // Persist council identity at the START of the turn so an early failure
    // still resumes as a council tab (does not require a stored model).
    this.store.write(this.sessionId, {
      backend: 'council',
      model: 'council',
      councilChair: this.chairToken,
    });

    // --- Roster + availability ---------------------------------------------
    const configuredMembers =
      Array.isArray(this.config.council?.members) && this.config.council!.members!.length
        ? this.config.council!.members!
        : DEFAULT_MEMBERS;
    const roster = buildRoster(configuredMembers);
    const availability = roster.map((m) => ({ member: m, ...this.memberAvailable(m) }));
    const available = availability.filter((a) => a.available).map((a) => a.member);
    const unavailable = availability.filter((a) => !a.available);

    // Text-only: never drop image attachments silently.
    let question = prompt.text || '';
    if (prompt.images.length) {
      const note = imagesOmittedNote(prompt.images.length, 'council');
      question = question ? `${question}\n\n${note}` : note;
    }

    // --- Convening header (states the cost caveat) --------------------------
    emit('## Council\n');
    if (available.length) {
      emit(
        `Convening ${available.length} member${available.length === 1 ? '' : 's'}: ${available
          .map((m) => m.displayId)
          .join(', ')}. Each answers independently; the chair then synthesizes a ruling.\n`,
      );
    }
    emit(
      '_ClaUi cannot compute council cost — a single turn invokes several paid or subscription models._\n',
    );
    if (unavailable.length) {
      emit('\nUnavailable this turn:\n');
      for (const u of unavailable) emit(`- ${u.member.displayId} — ${u.reason}\n`);
    }

    if (available.length < 2) {
      emit(
        `\nA council needs at least 2 available members; ${available.length} available. Add ` +
          'members via Tools -> Council settings — install Claude Code / the Codex or Grok CLI, ' +
          'or add OpenAI-compatible providers (GPT / Gemini / Claude API).\n',
      );
      this.persistTurn(question, transcript);
      return transcript;
    }

    const timeout = this.timeoutMs();
    const tmpCwd = this.makeTmpDir();
    if (!tmpCwd) {
      emit(
        '\nCould not create a private temporary working directory for the council members; ' +
          'the turn was aborted. Check that the system temp directory is writable.\n',
      );
      this.persistTurn(question, transcript);
      return transcript;
    }
    const results = new Map<CouncilMember, MemberResult>();
    try {
      // Fan out in parallel; append each member's section as it settles
      // (completion order — each is prefixed by its id so order is legible).
      await Promise.all(
        available.map((m) =>
          this.invokeMember(m, question, timeout, tmpCwd).then((r) => {
            results.set(m, r);
            emit(`\n### ${m.displayId} — ${r.ok ? '✅' : '❌'}\n${(r.ok ? r.text : r.reason) || ''}\n`);
          }),
        ),
      );

      if (this.isStale(gen)) return transcript; // interrupted mid fan-out

      const successes = available.filter((m) => results.get(m)?.ok);

      if (successes.length === 0) {
        emit('\n---\nNo council member produced an answer.\n');
        this.persistTurn(question, transcript);
        return transcript;
      }
      if (successes.length === 1) {
        emit(
          `\n---\n> Degraded: 1 of ${available.length} members answered; showing it without synthesis.\n`,
        );
        this.persistTurn(question, transcript);
        return transcript;
      }

      await this.runChair(gen, emit, roster, available, successes, results, question, timeout, tmpCwd);
      if (this.isStale(gen)) return transcript;
      this.persistTurn(question, transcript);
      return transcript;
    } finally {
      // Defer temp-dir removal until this turn's CLI children have closed (a
      // timed-out child may still be terminating and hold its cwd). Fire-and-
      // forget so runTurn returns and interrupt() is never blocked.
      this.scheduleTmpCleanup(tmpCwd, this.turnChildren);
    }
  }

  /** Remove the throwaway temp dir only AFTER every CLI child spawned this turn
   *  has terminated — escalating to force-kill if a child lingers, and never
   *  deleting the cwd while any child is still alive. Fire-and-forget: never
   *  blocks the caller (or interrupt()). */
  private scheduleTmpCleanup(dir: string | null, children: ChildProcess[]): void {
    if (!dir) return;
    reapChildrenThenCleanup(children, () => this.cleanupTmp(dir));
  }

  private async runChair(
    gen: number,
    emit: (text: string) => void,
    roster: CouncilMember[],
    available: CouncilMember[],
    successes: CouncilMember[],
    results: Map<CouncilMember, MemberResult>,
    question: string,
    timeout: number,
    tmpCwd: string,
  ): Promise<void> {
    const chair = this.pickChair(roster, available);
    emit(`\n---\n## Chair ruling (${chair.label})\n`);
    const synthPrompt = buildSynthesisPrompt(question, successes, results);

    // Primary chair.
    let ruling = await this.invokeMember(chair.member, synthPrompt, timeout, tmpCwd);
    if (this.isStale(gen)) return;
    if (ruling.ok && ruling.text) {
      emit(`${ruling.text}\n`);
      return;
    }

    // Fallback: first successful member (roster order) that is not the chair.
    const fallback = successes.find((m) => m.displayId !== chair.member.displayId) || successes[0];
    this.log(
      `council chair '${chair.member.displayId}' failed (${ruling.reason}); falling back to '${fallback.displayId}'`,
    );
    emit(
      `\n_Chair ${chair.member.displayId} could not synthesize (${ruling.reason || 'no answer'}); falling back to ${fallback.displayId}._\n`,
    );
    ruling = await this.invokeMember(fallback, synthPrompt, timeout, tmpCwd);
    if (this.isStale(gen)) return;
    if (ruling.ok && ruling.text) {
      emit(`${ruling.text}\n`);
      return;
    }

    // Final: never discard the members' opinions (already streamed above).
    emit(
      "\n_Synthesis unavailable (chair and fallback both failed). The council members' individual opinions above stand._\n",
    );
  }

  /** Persist for resume-safety. v1 councils are independent per turn (members
   *  do not see prior turns), so history is stored only so a resumed tab keeps
   *  its transcript + council identity. */
  private persistTurn(question: string, transcript: string): void {
    this.store.write(this.sessionId, {
      backend: 'council',
      model: 'council',
      councilChair: this.chairToken,
    });
    this.store.appendHistory(this.sessionId, 'user', question);
    this.store.appendHistory(this.sessionId, 'assistant', transcript);
  }
}

/** Force-kill a child as hard as the OS allows: taskkill /F /T on Windows,
 *  SIGKILL elsewhere (SIGKILL cannot be trapped, so this guarantees eventual
 *  termination — which is what bounds live-child growth). */
export function forceKillChild(child: ChildProcess): void {
  killTreeAsync(child);
  if (process.platform !== 'win32') {
    try {
      child.kill('SIGKILL');
    } catch {
      /* already dead */
    }
  }
}

/**
 * Run `cleanup` only once EVERY child has terminated. While any child is still
 * alive it escalates to a force-kill and retries; it never invokes `cleanup`
 * (e.g. deleting a shared cwd) while a process is still using it. Fire-and-
 * forget and fully unref'd, so it never blocks the caller or keeps the event
 * loop alive on its own.
 */
export function reapChildrenThenCleanup(
  children: ChildProcess[],
  cleanup: () => void,
  opts?: {
    firstDelayMs?: number;
    pollMs?: number;
    maxAttempts?: number;
    forceKill?: (c: ChildProcess) => void;
  },
): void {
  const firstDelayMs = opts?.firstDelayMs ?? 3000;
  const pollMs = opts?.pollMs ?? 3000;
  const maxAttempts = opts?.maxAttempts ?? 6;
  const forceKill = opts?.forceKill ?? forceKillChild;
  const isAlive = (c: ChildProcess): boolean => c.exitCode === null && c.signalCode === null;

  let done = false;
  const tryClean = (): boolean => {
    if (done) return true;
    if (children.some(isAlive)) return false; // never clean while a child lives
    done = true;
    cleanup();
    return true;
  };

  // Fast path: clean as soon as the last child closes.
  for (const c of children) {
    c.once('exit', tryClean);
    c.once('close', tryClean);
  }
  if (tryClean()) return;

  // Fallback: on each tick, re-check liveness (never delete a live cwd), then
  // escalate to a force-kill and retry. Bounded attempts — force-kill can't be
  // trapped, so children are reaped in practice; if a child somehow survives
  // all attempts we STOP (leaving the temp dir rather than corrupting a live
  // cwd) and the child stays tracked for dispose()/interrupt().
  let attempts = 0;
  const poll = (): void => {
    if (tryClean()) return;
    for (const c of children) if (isAlive(c)) forceKill(c);
    if (++attempts >= maxAttempts) return;
    const t = setTimeout(poll, pollMs);
    t.unref?.();
  };
  const t0 = setTimeout(poll, firstDelayMs);
  t0.unref?.();
}

/**
 * Codex council member: `codex exec --json --sandbox read-only --ephemeral`
 * with the prompt on stdin, run in a throwaway temp cwd. Parses the JSONL
 * `item.completed`/`agent_message` (string or content[]) — same shape as
 * CodexSessionNamer. `--sandbox read-only` guarantees no writes.
 * `--skip-git-repo-check` is required: the throwaway cwd is never a git repo,
 * and Codex otherwise refuses to run outside a trusted/git directory
 * ("Not inside a trusted directory and --skip-git-repo-check was not
 * specified"), which is expected and safe here — read-only + throwaway cwd
 * already make the turn non-mutating regardless of git/trust status.
 */
export function invokeCodexCouncil(
  cliPath: string,
  model: string,
  fullPrompt: string,
  cwd: string,
  signal: AbortSignal,
  onChild: (child: ChildProcess) => void,
  log: (msg: string) => void,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const args = [
      'exec',
      '--json',
      '--sandbox',
      'read-only',
      '--ephemeral',
      '--skip-git-repo-check',
      '-C',
      cwd,
    ];
    if (model) args.push('--model', model);
    args.push('-c', 'model_reasoning_effort=medium', '-');

    let child: ChildProcess;
    try {
      child = spawnCli(cliPath, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    } catch (e) {
      reject(new Error(`Failed to start Codex CLI: ${(e as Error).message}`));
      return;
    }
    onChild(child);

    let settled = false;
    let stdoutBuffer = '';
    let captured = '';

    const onAbort = (): void => killTreeAsync(child);
    if (signal.aborted) killTreeAsync(child);
    signal.addEventListener('abort', onAbort, { once: true });

    const done = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      fn();
    };

    const flush = (line: string): void => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const event = JSON.parse(trimmed) as {
          type?: string;
          item?: { type?: string; text?: unknown; content?: unknown };
        };
        if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
          if (typeof event.item.text === 'string' && event.item.text.trim()) {
            captured = event.item.text;
          } else if (Array.isArray(event.item.content)) {
            const joined = event.item.content
              .map((p) =>
                p && typeof p === 'object' && typeof (p as { text?: unknown }).text === 'string'
                  ? (p as { text: string }).text
                  : '',
              )
              .join('')
              .trim();
            if (joined) captured = joined;
          }
        }
      } catch {
        /* ignore non-JSON noise */
      }
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString('utf-8');
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() || '';
      for (const line of lines) flush(line);
    });
    child.stderr?.on('data', (d: Buffer) => log(`council codex stderr: ${d.toString('utf-8').slice(0, 300)}`));
    // Swallow async stdin errors (e.g. EPIPE when the child exits early) so they
    // don't surface as an uncaught stream 'error' event.
    child.stdin?.on('error', () => {});
    child.on('error', (e) => done(() => reject(new Error(`Failed to start Codex CLI: ${e.message}`))));
    // Settle on 'close' (all stdio drained), NOT 'exit' — otherwise the final
    // JSONL record still buffered in the pipe could be missed.
    child.on('close', (code) => {
      if (stdoutBuffer.trim()) {
        flush(stdoutBuffer);
        stdoutBuffer = '';
      }
      done(() => {
        if (signal.aborted) {
          reject(new Error('aborted'));
          return;
        }
        // A nonzero exit is always a failure (per the failure contract), even if
        // some agent text was captured.
        if (code !== 0) {
          reject(new Error(`Codex CLI exited ${code}`));
          return;
        }
        resolve(captured);
      });
    });

    try {
      child.stdin?.write(fullPrompt);
      if (!fullPrompt.endsWith('\n')) child.stdin?.write('\n');
      child.stdin?.end();
    } catch (e) {
      done(() => reject(new Error(`Codex stdin write failed: ${(e as Error).message}`)));
    }
  });
}

/**
 * Claude Code council member: `claude -p --output-format json` run headless in a
 * throwaway temp cwd, made non-mutating by construction:
 *   --restricted            removes the command/code-running tools (Bash) and
 *                           confines file tools to the working (throwaway) dir
 *   --permission-prompts none  auto-denies anything that would otherwise prompt
 *   --strict-mcp-config + empty --mcp-config  loads no MCP servers
 * Uses the user's existing Claude Code login (no `--bare`, so no API key needed).
 * `--output-format json` emits a single JSON object whose `result` holds the
 * answer text; `is_error` marks a failed turn. Prompt is written on stdin.
 */
export function invokeClaudeCouncil(
  cliPath: string,
  model: string,
  fullPrompt: string,
  cwd: string,
  signal: AbortSignal,
  onChild: (child: ChildProcess) => void,
  log: (msg: string) => void,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const args = [
      '-p',
      '--output-format',
      'json',
      '--restricted',
      '--permission-prompts',
      'none',
      '--strict-mcp-config',
      '--mcp-config',
      '{"mcpServers":{}}',
    ];
    if (model) args.push('--model', model);

    let child: ChildProcess;
    try {
      child = spawnCli(cliPath, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    } catch (e) {
      reject(new Error(`Failed to start Claude CLI: ${(e as Error).message}`));
      return;
    }
    onChild(child);

    let settled = false;
    let stdout = '';

    const onAbort = (): void => killTreeAsync(child);
    if (signal.aborted) killTreeAsync(child);
    signal.addEventListener('abort', onAbort, { once: true });

    const done = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      fn();
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8');
    });
    child.stderr?.on('data', (d: Buffer) => log(`council claude stderr: ${d.toString('utf-8').slice(0, 300)}`));
    child.stdin?.on('error', () => {});
    child.on('error', (e) => done(() => reject(new Error(`Failed to start Claude CLI: ${e.message}`))));
    // Settle on 'close' (all stdio drained) so the full JSON object is buffered.
    child.on('close', (code) => {
      done(() => {
        if (signal.aborted) {
          reject(new Error('aborted'));
          return;
        }
        const trimmed = stdout.trim();
        type ClaudeResult = { result?: unknown; is_error?: unknown; subtype?: unknown };
        let parsed: ClaudeResult | null = null;
        try {
          parsed = trimmed ? (JSON.parse(trimmed) as ClaudeResult) : null;
        } catch {
          parsed = null;
        }
        if (code !== 0) {
          const detail =
            parsed && typeof parsed.result === 'string' && parsed.result.trim()
              ? `: ${parsed.result.trim().slice(0, 200)}`
              : '';
          reject(new Error(`Claude CLI exited ${code}${detail}`));
          return;
        }
        if (!parsed) {
          reject(new Error('Malformed response from Claude CLI (expected --output-format json)'));
          return;
        }
        if (parsed.is_error) {
          const why = typeof parsed.result === 'string' && parsed.result.trim() ? parsed.result.trim() : 'unknown error';
          reject(new Error(`Claude CLI reported an error: ${why.slice(0, 200)}`));
          return;
        }
        resolve(typeof parsed.result === 'string' ? parsed.result : '');
      });
    });

    try {
      child.stdin?.write(fullPrompt);
      if (!fullPrompt.endsWith('\n')) child.stdin?.write('\n');
      child.stdin?.end();
    } catch (e) {
      done(() => reject(new Error(`Claude stdin write failed: ${(e as Error).message}`)));
    }
  });
}

/**
 * OpenAI-compatible council member: a single HTTP `POST /chat/completions` with
 * `stream:false` and NO `tools` param (structurally incapable of side effects).
 * Reuses the provider's key resolution; abortable via `signal`.
 */
export function invokeOpenAiCouncil(
  provider: OpenAiCompatProvider,
  model: string,
  messages: { role: string; content: string }[],
  signal: AbortSignal,
): Promise<string> {
  const endpoint = new URL(provider.baseUrl.replace(/\/+$/, '') + '/chat/completions');
  const body = JSON.stringify({ model, messages, stream: false });
  const apiKey = resolveOpenAiApiKey(provider);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Content-Length': String(Buffer.byteLength(body)),
    Accept: 'application/json',
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const transport = endpoint.protocol === 'https:' ? https : http;

  return new Promise<string>((resolve, reject) => {
    const req = transport.request(endpoint, { method: 'POST', headers, signal }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => {
        data += c;
      });
      res.on('end', () => {
        if (!res.statusCode || res.statusCode >= 400) {
          reject(new Error(`${endpoint.host} returned HTTP ${res.statusCode}: ${data.slice(0, 300)}`));
          return;
        }
        try {
          const parsed = JSON.parse(data) as {
            choices?: { message?: { content?: string } }[];
          };
          resolve(parsed.choices?.[0]?.message?.content ?? '');
        } catch (e) {
          reject(new Error(`Malformed response from ${endpoint.host}: ${(e as Error).message}`));
        }
      });
      res.on('error', (e) => reject(e));
    });
    req.on('error', (e: NodeJS.ErrnoException) => {
      if (e.name === 'AbortError') reject(new Error('aborted'));
      else if (e.code === 'ECONNREFUSED') reject(new Error(`Cannot reach ${endpoint.host} (${provider.baseUrl})`));
      else reject(e);
    });
    req.write(body);
    req.end();
  });
}
