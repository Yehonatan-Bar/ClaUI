import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Bridge Providers — drive non-Claude backends (xAI Grok, Google Antigravity,
 * any OpenAI-compatible server) through ordinary Claude tabs.
 *
 * Mechanism: the same cliPathOverride seam used by the Happy/remote provider.
 * For a bridge model the tab spawns the bundled bridge runtime
 * (dist/bridge-runtime/cli.js) instead of the claude CLI; the runtime speaks
 * claude stream-json to the extension and talks to the selected backend behind
 * it. Backend/model selection travels in the --model value, namespaced as
 * `bridge:<backend>/<model>` (see src/bridge-runtime/config.ts).
 *
 * The runtime cannot read VS Code settings, so this service mirrors the
 * claudeMirror.bridge.* settings into ~/.claui/bridge.json on activation and
 * on every configuration change.
 */

export const BRIDGE_MODEL_PREFIX = 'bridge:';
/** Sentinel picker values that trigger the CLI install flow instead of a
 *  model switch (e.g. `bridge:install/grok`). */
export const BRIDGE_INSTALL_PREFIX = 'bridge:install/';
/** Marker every bridge cliPathOverride contains — used to recognize bridge
 *  tabs in snapshots even across extension updates (the absolute path moves). */
const BRIDGE_CLI_MARKER = `bridge-runtime${path.sep}cli.js`;

export interface BridgeModelOption {
  label: string;
  value: string;
}

interface OpenAiProviderSetting {
  id?: string;
  label?: string;
  baseUrl?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  apiKeyFile?: string;
  models?: string[];
}

export function isBridgeModelValue(value: string | null | undefined): boolean {
  return !!value && String(value).startsWith(BRIDGE_MODEL_PREFIX);
}

export function isBridgeInstallValue(value: string | null | undefined): boolean {
  return !!value && String(value).startsWith(BRIDGE_INSTALL_PREFIX);
}

/** Backend segment of a bridge model value ('grok' | 'antigravity' | 'openai/<id>'). */
export function bridgeBackendKey(value: string | null | undefined): string {
  if (!isBridgeModelValue(value)) return '';
  const rest = String(value).slice(BRIDGE_MODEL_PREFIX.length);
  const parts = rest.split('/');
  if (parts[0] === 'openai') {
    return parts.length > 1 ? `openai/${parts[1]}` : 'openai';
  }
  return parts[0] || '';
}

export function isBridgeCliCommand(command: string | null | undefined): boolean {
  return !!command && String(command).includes(BRIDGE_CLI_MARKER);
}

export class BridgeProviderService {
  private static instance: BridgeProviderService | null = null;

  static init(context: vscode.ExtensionContext): BridgeProviderService {
    if (!this.instance) {
      this.instance = new BridgeProviderService(context);
      this.instance.syncConfigFile();
      context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
          if (e.affectsConfiguration('claudeMirror.bridge') ||
              e.affectsConfiguration('claudeMirror.permissionMode')) {
            this.instance?.syncConfigFile();
          }
        }),
      );
    }
    return this.instance;
  }

  static get(): BridgeProviderService | null {
    return this.instance;
  }

  private constructor(private readonly context: vscode.ExtensionContext) {}

  /** Cached CLI detection results (reset when bridge settings change). */
  private cliDetectionCache = new Map<string, boolean>();

  /** True when the configured CLI for a backend actually exists on this
   *  machine — an absolute path that exists, a known install location, or a
   *  PATH hit. Lets the feature default ON while only surfacing backends the
   *  user can actually run (no CLI installed → no picker noise). */
  private cliDetected(kind: 'grok' | 'antigravity'): boolean {
    const cached = this.cliDetectionCache.get(kind);
    if (cached !== undefined) {
      return cached;
    }
    const fallback = kind === 'grok' ? 'grok' : 'agy';
    const configured = this.config()
      .get<string>(`bridge.${kind}.cliPath`, fallback)
      .trim() || fallback;

    let detected = false;
    if (path.isAbsolute(configured)) {
      detected = fs.existsSync(configured);
    } else {
      // Known global install locations first (cheap fs checks).
      if (process.platform === 'win32') {
        if (kind === 'grok' && process.env.APPDATA) {
          detected = fs.existsSync(
            path.join(
              process.env.APPDATA,
              'npm',
              'node_modules',
              '@xai-official',
              'grok',
              'node_modules',
              '@xai-official',
              'grok-win32-x64',
              'bin',
              'grok.exe',
            ),
          );
        }
        if (kind === 'antigravity' && !detected && process.env.LOCALAPPDATA) {
          detected = fs.existsSync(
            path.join(process.env.LOCALAPPDATA, 'agy', 'bin', 'agy.exe'),
          );
        }
      }
      if (!detected) {
        // PATH probe (handles .cmd shims on Windows and symlinks elsewhere).
        const probe = process.platform === 'win32' ? 'where' : 'which';
        try {
          const res = spawnSync(probe, [configured], { timeout: 3000, windowsHide: true });
          detected = res.status === 0;
        } catch {
          detected = false;
        }
      }
    }
    this.cliDetectionCache.set(kind, detected);
    return detected;
  }

  /** Command string spawned instead of the claude CLI for bridge tabs.
   *  ClaudeProcessManager spawns through a shell, so an embedded quoted path
   *  is safe. Requires `node` on PATH (same class of requirement as the other
   *  provider CLIs this feature drives). */
  cliCommand(): string {
    const bridgePath = path.join(
      this.context.extensionPath,
      'dist',
      'bridge-runtime',
      'cli.js',
    );
    return `node "${bridgePath}"`;
  }

  private config() {
    return vscode.workspace.getConfiguration('claudeMirror');
  }

  private openAiProviders(): OpenAiProviderSetting[] {
    const raw = this.config().get<OpenAiProviderSetting[]>('bridge.openaiProviders', []);
    return Array.isArray(raw)
      ? raw.filter((p) => p && typeof p.id === 'string' && typeof p.baseUrl === 'string')
      : [];
  }

  /** Mirror settings into ~/.claui/bridge.json for the bridge runtime. */
  syncConfigFile(): void {
    this.cliDetectionCache.clear();
    try {
      const cfg = this.config();
      const clauiHome = path.join(os.homedir(), '.claui');
      const storageDir = path.join(
        this.context.globalStorageUri?.fsPath || clauiHome,
        'bridge-sessions',
      );
      const payload = {
        version: 1,
        grok: { cliPath: cfg.get<string>('bridge.grok.cliPath', 'grok') },
        antigravity: { cliPath: cfg.get<string>('bridge.antigravity.cliPath', 'agy') },
        openai: this.openAiProviders(),
        storageDir,
        permissionMode: cfg.get<string>('permissionMode', 'full-access'),
      };
      fs.mkdirSync(clauiHome, { recursive: true });
      fs.mkdirSync(storageDir, { recursive: true });
      const file = path.join(clauiHome, 'bridge.json');
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
      fs.renameSync(tmp, file);
    } catch {
      /* config mirroring is best-effort; the runtime falls back to defaults */
    }
  }

  /** Model-picker entries for every enabled bridge backend. */
  modelOptions(): BridgeModelOption[] {
    const cfg = this.config();
    const options: BridgeModelOption[] = [];

    if (cfg.get<boolean>('bridge.grok.enabled', true)) {
      if (this.cliDetected('grok')) {
        for (const model of cfg.get<string[]>('bridge.grok.models', ['grok-4.5'])) {
          if (typeof model === 'string' && model.trim()) {
            options.push({
              label: `Grok · ${model.trim()}`,
              value: `${BRIDGE_MODEL_PREFIX}grok/${model.trim()}`,
            });
          }
        }
      } else {
        // CLI not installed: offer a one-click install flow right in the picker
        // for users who have a Grok subscription.
        options.push({
          label: '➕ Grok — Install CLI…',
          value: `${BRIDGE_INSTALL_PREFIX}grok`,
        });
      }
    }

    if (cfg.get<boolean>('bridge.antigravity.enabled', true)) {
      if (this.cliDetected('antigravity')) {
        const models = cfg.get<string[]>('bridge.antigravity.models', [
          'gemini-3.6-flash-medium',
          'gemini-3.1-pro-high',
        ]);
        for (const model of models) {
          if (typeof model === 'string' && model.trim()) {
            options.push({
              label: `Antigravity · ${model.trim()}`,
              value: `${BRIDGE_MODEL_PREFIX}antigravity/${model.trim()}`,
            });
          }
        }
      } else {
        options.push({
          label: '➕ Antigravity — Install CLI…',
          value: `${BRIDGE_INSTALL_PREFIX}antigravity`,
        });
      }
    }

    for (const provider of this.openAiProviders()) {
      const label = provider.label || provider.id;
      for (const model of provider.models || []) {
        if (typeof model === 'string' && model.trim()) {
          options.push({
            label: `${label} · ${model.trim()}`,
            value: `${BRIDGE_MODEL_PREFIX}openai/${provider.id}/${model.trim()}`,
          });
        }
      }
    }

    return options;
  }

  /** Guided install for a missing provider CLI: primes the official install
   *  command in an integrated terminal (never auto-executes it) and links the
   *  docs. Triggered from the "Install CLI…" picker entries. */
  async startCliInstall(kind: 'grok' | 'antigravity'): Promise<void> {
    const isWin = process.platform === 'win32';
    const info =
      kind === 'grok'
        ? {
            title: 'Grok CLI (xAI)',
            install: 'npm install -g @xai-official/grok',
            afterInstall: 'run `grok login` to sign in with your xAI subscription',
            docsUrl: 'https://www.npmjs.com/package/@xai-official/grok',
          }
        : {
            title: 'Antigravity CLI (agy)',
            install: isWin
              ? 'curl -fsSL https://antigravity.google/cli/install.cmd -o install.cmd && install.cmd && del install.cmd'
              : 'curl -fsSL https://antigravity.google/cli/install.sh | bash',
            afterInstall: 'run `agy` once to sign in with your Google AI subscription',
            docsUrl: 'https://antigravity.google/docs/cli/install',
          };

    const choice = await vscode.window.showInformationMessage(
      `${info.title} is required for these models (you bring your own subscription). Install it now?`,
      'Install in Terminal',
      'Open Docs',
    );
    if (choice === 'Install in Terminal') {
      const terminal = vscode.window.createTerminal({ name: `Install ${info.title}` });
      terminal.show();
      // Primed but NOT executed — the user reviews and presses Enter.
      terminal.sendText(info.install, false);
      void vscode.window.showInformationMessage(
        `The install command is ready in the terminal — press Enter to run it. Afterwards ${info.afterInstall}, then reload the window to refresh the model picker.`,
      );
    } else if (choice === 'Open Docs') {
      void vscode.env.openExternal(vscode.Uri.parse(info.docsUrl));
    }
    // Re-probe on the next picker refresh in case the install completed.
    this.cliDetectionCache.clear();
  }
}
