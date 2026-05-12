/**
 * Client-side prompt renderer for multi-participant sessions.
 *
 * The coordination server builds the full prompt (delta context + template) and
 * sends it via the `deliverPrompt` message. This module provides a hook point
 * for any client-side augmentation before the prompt reaches the local agent.
 *
 * Current behavior: pass-through. The server-rendered prompt is used as-is.
 * Extension point: add workspace-local context (open files, git state) or
 * client-specific instructions that the server cannot know.
 */

export interface PromptRenderOptions {
  serverPrompt: string;
  agentProvider: 'claude' | 'codex';
  workspacePath?: string;
  planOnlyMode?: boolean;
}

export function renderPromptForDelivery(options: PromptRenderOptions): string {
  let prompt = options.serverPrompt;

  if (options.workspacePath) {
    prompt += `\n\nWorkspace root: ${options.workspacePath}`;
  }

  return prompt;
}
