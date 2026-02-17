/**
 * Phase 2 stub: Converts stream events to formatted ANSI text
 * for display in the PseudoTerminal.
 */

// ANSI escape codes
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';

export class AnsiRenderer {
  /** Format a user message for terminal display */
  renderUserMessage(text: string): string {
    return `${BOLD}${CYAN}You:${RESET} ${text}\n`;
  }

  /** Format assistant text for terminal display */
  renderAssistantText(text: string): string {
    return `${BOLD}${GREEN}Assistant:${RESET} ${text}\n`;
  }

  /** Format a tool use header */
  renderToolUseStart(toolName: string): string {
    return `${DIM}${YELLOW}[Tool: ${toolName}]${RESET}\n`;
  }

  /** Format an error message */
  renderError(message: string): string {
    return `${BOLD}${RED}Error:${RESET} ${message}\n`;
  }

  /** Format a session start notice */
  renderSessionStart(sessionId: string, model: string): string {
    return `${DIM}Session: ${sessionId} | Model: ${model}${RESET}\n`;
  }
}
