import * as vscode from 'vscode';

const API_KEY_SECRET_KEY = 'claudeMirror.anthropicApiKey';

/**
 * Delete an environment variable by case-insensitive key match.
 * On Windows, env var names are case-insensitive but Node's process.env
 * object preserves the original casing. A simple `delete env.FOO` may miss
 * a key stored as `foo` or `Foo`.
 */
function deleteEnvCaseInsensitive(env: NodeJS.ProcessEnv, target: string): void {
  const upper = target.toUpperCase();
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === upper) {
      delete env[key];
    }
  }
}

/**
 * Build a sanitized environment for spawning ANY child process.
 * - Removes CLAUDECODE and CLAUDE_CODE_ENTRYPOINT (nested-session prevention)
 * - Removes inherited ANTHROPIC_API_KEY (prevents accidental API-key auth)
 *
 * Use this for Codex CLI processes and non-Claude subprocesses that should
 * never receive an Anthropic API key.
 */
export function buildSanitizedEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  deleteEnvCaseInsensitive(env, 'CLAUDECODE');
  deleteEnvCaseInsensitive(env, 'CLAUDE_CODE_ENTRYPOINT');
  deleteEnvCaseInsensitive(env, 'ANTHROPIC_API_KEY');
  return env;
}

/**
 * Build environment for spawning Claude CLI processes.
 * Starts from a sanitized env (inherited ANTHROPIC_API_KEY stripped),
 * then injects the user's explicitly configured API key if provided.
 *
 * @param apiKey - The user's API key from SecretStorage, or undefined
 */
export function buildClaudeCliEnv(apiKey?: string): NodeJS.ProcessEnv {
  const env = buildSanitizedEnv();
  if (apiKey) {
    env.ANTHROPIC_API_KEY = apiKey;
  }
  return env;
}

/**
 * Read the user's configured Anthropic API key from VS Code SecretStorage.
 * Returns undefined if no key is set.
 */
export async function getStoredApiKey(secrets: vscode.SecretStorage): Promise<string | undefined> {
  const key = await secrets.get(API_KEY_SECRET_KEY);
  return key || undefined;
}

/**
 * Store or clear the user's Anthropic API key in VS Code SecretStorage.
 */
export async function setStoredApiKey(secrets: vscode.SecretStorage, apiKey: string): Promise<void> {
  if (apiKey.trim()) {
    await secrets.store(API_KEY_SECRET_KEY, apiKey.trim());
  } else {
    await secrets.delete(API_KEY_SECRET_KEY);
  }
}

/**
 * Build the masked display string for an API key.
 * Shows only the last 4 characters, e.g. "****abcd".
 */
export function maskApiKey(key: string | undefined): string {
  if (!key || key.length <= 4) return '';
  return '****' + key.slice(-4);
}
