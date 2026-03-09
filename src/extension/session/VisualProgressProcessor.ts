import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { buildClaudeCliEnv } from '../process/envUtils';
import { killProcessTree } from '../process/killTree';

/** Tool category used by VPM */
type ToolCategory =
  | 'reading' | 'writing' | 'editing' | 'searching'
  | 'executing' | 'delegating' | 'planning' | 'skill'
  | 'deciding' | 'researching';

interface VpmCard {
  id: string;
  category: ToolCategory;
  toolName: string;
  description: string;
  filePath?: string;
  command?: string;
  pattern?: string;
  timestamp: number;
  isStreaming: boolean;
}

/** Map tool name to category */
function toolToCategory(toolName: string): ToolCategory {
  const base = toolName.includes('__') ? toolName.split('__').pop()! : toolName;
  switch (base) {
    case 'Read': return 'reading';
    case 'Write': return 'writing';
    case 'Edit': case 'NotebookEdit': case 'MultiEdit': return 'editing';
    case 'Grep': case 'Glob': return 'searching';
    case 'Bash': case 'Terminal': return 'executing';
    case 'Agent': case 'Task': case 'dispatch_agent': return 'delegating';
    case 'TodoWrite': return 'planning';
    case 'Skill': return 'skill';
    case 'ExitPlanMode': case 'EnterPlanMode': case 'AskUserQuestion': return 'deciding';
    case 'WebFetch': case 'WebSearch': return 'researching';
    default: return 'executing';
  }
}

/** Parse a bash command into a human-readable description */
function describeBashCommand(raw: string): string {
  const cmd = raw.trim().replace(/^(cd\s+\S+\s*&&\s*)+/i, '').trim();

  const npmRun = cmd.match(/^npm\s+run\s+(\S+)/i);
  if (npmRun) return `Running: npm ${npmRun[1]}`;
  if (/^npm\s+(install|ci|i)\b/i.test(cmd)) return 'Installing npm packages';

  if (/^git\s+commit/i.test(cmd)) return 'Committing changes to git';
  if (/^git\s+push/i.test(cmd)) return 'Pushing changes to remote';
  if (/^git\s+pull/i.test(cmd)) return 'Pulling latest changes';
  if (/^git\s+add/i.test(cmd)) return 'Staging files for commit';
  if (/^git\s+status/i.test(cmd)) return 'Checking git status';
  if (/^git\s+log/i.test(cmd)) return 'Viewing git history';
  if (/^git\s+diff/i.test(cmd)) return 'Viewing changes in git';
  if (/^git\s+checkout/i.test(cmd)) return 'Switching git branch';
  if (/^git\s+/i.test(cmd)) return 'Running git command';

  const pyMatch = cmd.match(/^python\S*\s+(\S+)/i);
  if (pyMatch) return `Running: ${pyMatch[1].split(/[/\\]/).pop()}`;
  const nodeMatch = cmd.match(/^node\s+(\S+)/i);
  if (nodeMatch) return `Running: ${nodeMatch[1].split(/[/\\]/).pop()}`;

  if (/^powershell/i.test(cmd)) return 'Running PowerShell script';
  if (/\bwebpack\b/i.test(cmd)) return 'Running webpack build';
  if (/\btsc\b/.test(cmd)) return 'Compiling TypeScript';
  if (/\bvsce\b/i.test(cmd)) return 'Packaging VS Code extension';

  if (/^(rm|del|rmdir)\b/i.test(cmd)) return 'Removing files';
  if (/^(cp|copy)\b/i.test(cmd)) return 'Copying files';
  if (/^(mv|move)\b/i.test(cmd)) return 'Moving files';
  if (/^(mkdir|md)\b/i.test(cmd)) return 'Creating directory';
  if (/^(ls|dir)\b/i.test(cmd)) return 'Listing directory contents';
  if (/^(cat|type)\b/i.test(cmd)) return 'Reading file contents';

  const preview = cmd.slice(0, 45).replace(/\s+/g, ' ');
  return preview.length < cmd.length ? `Running: ${preview}...` : `Running: ${preview}`;
}

/** Template-based fallback description */
function templateDescription(toolName: string, filePath?: string, command?: string, pattern?: string): string {
  const base = toolName.includes('__') ? toolName.split('__').pop()! : toolName;
  const file = filePath ? ` ${filePath.split(/[/\\]/).pop()}` : '';
  const pat = pattern ? ` for "${pattern}"` : '';

  switch (base) {
    case 'Read': return `Reading${file || ' a file'}`;
    case 'Write': return `Writing${file || ' a file'}`;
    case 'Edit': case 'MultiEdit': return `Editing${file || ' a file'}`;
    case 'NotebookEdit': return `Editing notebook${file || ''}`;
    case 'Grep': return pattern ? `Searching for "${pattern}"` : 'Searching file contents';
    case 'Glob': return pattern ? `Finding files matching "${pattern}"` : 'Finding files';
    case 'Bash': case 'Terminal': return command ? describeBashCommand(command) : 'Running a terminal command';
    case 'Agent': case 'Task': return 'Launching a sub-agent';
    case 'dispatch_agent': return 'Dispatching an agent';
    case 'TodoWrite': return 'Updating the task list';
    case 'Skill': return 'Invoking a skill';
    case 'ExitPlanMode': return 'Plan ready — waiting for review';
    case 'EnterPlanMode': return 'Switching to plan mode';
    case 'AskUserQuestion': return 'Asking for your input';
    case 'WebFetch': return 'Fetching a web page';
    case 'WebSearch': return 'Searching the web';
    default: return `Using ${base}`;
  }
}

/** Tools that don't need AI descriptions (template is good enough) */
const SKIP_AI_TOOLS = new Set(['TodoWrite', 'ExitPlanMode', 'EnterPlanMode']);

/**
 * Processes tool events and generates visual progress cards.
 * Sends cards to the webview via postMessage and optionally
 * enriches descriptions via Haiku API calls.
 */
export class VisualProgressProcessor {
  private log: (msg: string) => void = () => {};
  private postMessage: (msg: unknown) => void = () => {};
  private cardCounter = 0;
  /** Queue for Haiku calls - max 2 concurrent */
  private activeHaikuCalls = 0;
  private haikuQueue: Array<{ cardId: string; toolName: string; input: string; context: string }> = [];
  /** Cache: tool+input -> description (avoids duplicate API calls) */
  private descriptionCache = new Map<string, string>();
  /** Last assistant text context (for Haiku prompt enrichment) */
  private lastAssistantContext = '';
  /** Maps blockIndex -> cardId for enrichment at blockStop */
  private blockToCardId = new Map<number, { cardId: string; toolName: string }>();

  setLogger(logger: (msg: string) => void): void {
    this.log = logger;
  }

  setPostMessage(fn: (msg: unknown) => void): void {
    this.postMessage = fn;
  }

  /** Update context from assistant streaming text */
  updateAssistantContext(text: string): void {
    // Keep last 200 chars
    this.lastAssistantContext = (this.lastAssistantContext + text).slice(-200);
  }

  /** Clear context on session start/end */
  reset(): void {
    this.lastAssistantContext = '';
    this.descriptionCache.clear();
    this.haikuQueue = [];
    this.activeHaikuCalls = 0;
  }

  /**
   * Process a tool_use_start event.
   * Immediately emits a card with template description.
   * AI enrichment is deferred to onBlockStop when full input is available.
   */
  onToolUseStart(toolName: string, toolId: string, blockIndex: number): void {
    const config = vscode.workspace.getConfiguration('claudeMirror');
    if (!config.get<boolean>('visualProgressMode', false)) return;

    const category = toolToCategory(toolName);
    const description = templateDescription(toolName);

    const card: VpmCard = {
      id: `vpm-${++this.cardCounter}-${Date.now()}`,
      category,
      toolName,
      description,
      timestamp: Date.now(),
      isStreaming: true,
    };

    this.log(`[VPM] Card: ${card.category} / ${toolName} -> "${description}"`);
    this.postMessage({ type: 'visualProgressCard', card });

    // Store mapping for enrichment at blockStop
    this.blockToCardId.set(blockIndex, { cardId: card.id, toolName });
  }

  /**
   * Called when a tool block finishes and full accumulated input is available.
   * Updates card with extracted details and optionally queues Haiku enrichment.
   */
  onBlockStop(blockIndex: number, accumulatedInput: string): void {
    const mapping = this.blockToCardId.get(blockIndex);
    if (!mapping) return;
    this.blockToCardId.delete(blockIndex);

    const { cardId, toolName } = mapping;

    // Parse accumulated input
    let parsed: Record<string, unknown> | undefined;
    try {
      parsed = JSON.parse(accumulatedInput);
    } catch {
      // partial or malformed JSON
    }

    // Extract details and update card description with enriched template
    const filePath = this.extractFilePath(toolName, parsed);
    const command = this.extractCommand(toolName, parsed);
    const pattern = this.extractPattern(toolName, parsed);
    const enrichedDescription = templateDescription(toolName, filePath, command, pattern);

    // Update the card with enriched template description and metadata
    this.postMessage({
      type: 'visualProgressCard',
      card: {
        id: cardId,
        category: toolToCategory(toolName),
        toolName,
        description: enrichedDescription,
        filePath,
        command,
        pattern,
        timestamp: Date.now(),
        isStreaming: false,
      },
    });

    // Queue AI description if enabled and tool is worth enriching
    const config = vscode.workspace.getConfiguration('claudeMirror');
    const aiEnabled = config.get<boolean>('vpmAiDescriptions', true);
    const baseTool = toolName.includes('__') ? toolName.split('__').pop()! : toolName;
    if (aiEnabled && !SKIP_AI_TOOLS.has(baseTool)) {
      const inputSummary = this.summarizeInput(toolName, parsed);
      this.enqueueHaikuCall(cardId, toolName, inputSummary, this.lastAssistantContext);
    }
  }

  // --- Private helpers ---

  private extractFilePath(toolName: string, input?: Record<string, unknown>): string | undefined {
    if (!input) return undefined;
    return (input.file_path ?? input.filePath ?? input.path) as string | undefined;
  }

  private extractCommand(toolName: string, input?: Record<string, unknown>): string | undefined {
    if (!input) return undefined;
    return (input.command ?? input.cmd) as string | undefined;
  }

  private extractPattern(toolName: string, input?: Record<string, unknown>): string | undefined {
    if (!input) return undefined;
    return (input.pattern ?? input.query ?? input.glob) as string | undefined;
  }

  private summarizeInput(toolName: string, input?: Record<string, unknown>): string {
    if (!input) return '';
    const parts: string[] = [];
    if (input.file_path || input.filePath || input.path) {
      parts.push(`file: ${input.file_path ?? input.filePath ?? input.path}`);
    }
    if (input.command || input.cmd) {
      const cmd = String(input.command ?? input.cmd);
      parts.push(`command: ${cmd.slice(0, 100)}`);
    }
    if (input.pattern || input.query || input.glob) {
      parts.push(`pattern: ${input.pattern ?? input.query ?? input.glob}`);
    }
    if (input.description) {
      parts.push(`description: ${String(input.description).slice(0, 100)}`);
    }
    return parts.join(', ');
  }

  private enqueueHaikuCall(cardId: string, toolName: string, input: string, context: string): void {
    // Check cache
    const cacheKey = `${toolName}:${input}`;
    const cached = this.descriptionCache.get(cacheKey);
    if (cached) {
      this.log(`[VPM] Cache hit for ${toolName}`);
      this.postMessage({ type: 'visualProgressCardUpdate', cardId, aiDescription: cached });
      return;
    }

    this.haikuQueue.push({ cardId, toolName, input, context });
    this.processHaikuQueue();
  }

  private processHaikuQueue(): void {
    while (this.activeHaikuCalls < 2 && this.haikuQueue.length > 0) {
      const item = this.haikuQueue.shift()!;
      this.activeHaikuCalls++;
      this.callHaiku(item.cardId, item.toolName, item.input, item.context)
        .finally(() => {
          this.activeHaikuCalls--;
          this.processHaikuQueue();
        });
    }
  }

  private async callHaiku(cardId: string, toolName: string, input: string, context: string): Promise<void> {
    const config = vscode.workspace.getConfiguration('claudeMirror');
    const cliPath = config.get<string>('cliPath', 'claude');

    const prompt =
      `You are generating a short, friendly description of what a developer's AI assistant is doing.\n\n` +
      `Tool: ${toolName}\n` +
      `Input: ${input || 'none'}\n` +
      `Context: ${context || 'none'}\n\n` +
      `Generate a 1-2 sentence description in first person ("I'm..."). Be specific about WHAT file/command, but explain WHY simply.\n\n` +
      `Examples:\n` +
      `- "I'm reading the state management file to understand how data flows through the app."\n` +
      `- "I'm editing the login component to add the new validation rules."\n` +
      `- "I'm searching the codebase for all places that reference the user model."\n` +
      `- "I'm running the test suite to make sure nothing broke."\n\n` +
      `Reply with ONLY the description, nothing else.`;

    const args = ['-p', '--model', 'claude-haiku-4-5-20251001'];
    const env = buildClaudeCliEnv();

    return new Promise<void>((resolve) => {
      let stdout = '';
      let settled = false;

      const finish = (result: string | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (result) {
          const cacheKey = `${toolName}:${input}`;
          this.descriptionCache.set(cacheKey, result);
          this.postMessage({ type: 'visualProgressCardUpdate', cardId, aiDescription: result });
          this.log(`[VPM] AI description: "${result.slice(0, 60)}..."`);
        }
        resolve();
      };

      let child;
      try {
        child = spawn(cliPath, args, { env, stdio: ['pipe', 'pipe', 'pipe'], shell: true });
      } catch (err) {
        this.log(`[VPM] Haiku spawn error: ${err}`);
        finish(null);
        return;
      }

      const timer = setTimeout(() => {
        this.log('[VPM] Haiku timeout (8s)');
        const fallback = stdout ? this.sanitizeOutput(stdout) : null;
        finish(fallback);
        try { killProcessTree(child); } catch { /* ignore */ }
      }, 8000);

      child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      child.on('close', () => finish(this.sanitizeOutput(stdout)));
      child.on('error', (err) => {
        this.log(`[VPM] Haiku process error: ${err.message}`);
        finish(null);
      });

      child.stdin?.write(prompt);
      child.stdin?.end();
    });
  }

  private sanitizeOutput(raw: string): string | null {
    // The CLI may wrap output in JSON-stream events; extract plain text
    let text = raw.trim();
    // Try to extract from JSON stream ({"type":"assistant","message":...})
    const lines = text.split('\n');
    const textParts: string[] = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === 'assistant' && parsed.message?.content) {
          for (const block of parsed.message.content) {
            if (block.type === 'text') textParts.push(block.text);
          }
        } else if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
          textParts.push(parsed.delta.text);
        }
      } catch {
        // Not JSON - could be plain text
        if (line.trim() && !line.startsWith('{')) {
          textParts.push(line.trim());
        }
      }
    }
    text = textParts.join('').trim() || text;
    // Remove quotes if wrapped
    if (text.startsWith('"') && text.endsWith('"')) text = text.slice(1, -1);
    // Must look like a description
    if (!text || text.length < 5 || text.length > 500) return null;
    return text;
  }
}
