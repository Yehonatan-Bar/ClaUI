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

    if (cfg.get<boolean>('bridge.grok.enabled', false)) {
      for (const model of cfg.get<string[]>('bridge.grok.models', ['grok-4.5'])) {
        if (typeof model === 'string' && model.trim()) {
          options.push({
            label: `Grok · ${model.trim()}`,
            value: `${BRIDGE_MODEL_PREFIX}grok/${model.trim()}`,
          });
        }
      }
    }

    if (cfg.get<boolean>('bridge.antigravity.enabled', false)) {
      const models = cfg.get<string[]>('bridge.antigravity.models', ['gemini-3-flash-preview']);
      for (const model of models) {
        if (typeof model === 'string' && model.trim()) {
          options.push({
            label: `Antigravity · ${model.trim()}`,
            value: `${BRIDGE_MODEL_PREFIX}antigravity/${model.trim()}`,
          });
        }
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
}
