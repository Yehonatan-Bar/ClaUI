import * as vscode from 'vscode';

const PROJECT_KEY = 'claudeMirror.promptHistory.project';
const GLOBAL_KEY = 'claudeMirror.promptHistory.global';
const MAX_PROMPTS = 200;

/**
 * Persists prompt history at two scopes:
 * - Project (workspaceState): prompts from all sessions in the current workspace
 * - Global (globalState): prompts from all sessions across all workspaces
 */
export class PromptHistoryStore {
  constructor(
    private readonly globalState: vscode.Memento,
    private readonly workspaceState: vscode.Memento
  ) {}

  /** Get project-scoped prompt history (most recent last) */
  getProjectHistory(): string[] {
    return this.workspaceState.get<string[]>(PROJECT_KEY, []);
  }

  /** Get global prompt history (most recent last) */
  getGlobalHistory(): string[] {
    return this.globalState.get<string[]>(GLOBAL_KEY, []);
  }

  /** Add a prompt to both project and global history */
  async addPrompt(prompt: string): Promise<void> {
    const trimmed = prompt.trim();
    if (!trimmed) return;

    await Promise.all([
      this.appendTo(this.workspaceState, PROJECT_KEY, trimmed),
      this.appendTo(this.globalState, GLOBAL_KEY, trimmed),
    ]);
  }

  /** Append a prompt to a storage key, avoiding consecutive duplicates and capping size */
  private async appendTo(
    state: vscode.Memento,
    key: string,
    prompt: string
  ): Promise<void> {
    const history = state.get<string[]>(key, []);

    // Skip consecutive duplicates
    if (history.length > 0 && history[history.length - 1] === prompt) {
      return;
    }

    history.push(prompt);

    // Cap at MAX_PROMPTS
    if (history.length > MAX_PROMPTS) {
      history.splice(0, history.length - MAX_PROMPTS);
    }

    await state.update(key, history);
  }
}
