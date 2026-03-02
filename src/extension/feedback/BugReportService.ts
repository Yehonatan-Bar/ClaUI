/**
 * BugReportService - orchestrates the full bug report lifecycle:
 * auto-collection, AI conversation, script execution, ZIP packaging, submission.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import { exec } from 'child_process';
import AdmZip from 'adm-zip';
import { collectDiagnostics, DiagnosticsResult } from './DiagnosticsCollector';
import { FormspreeService } from './FormspreeService';
import { ClaudeCliCaller } from '../skillgen/ClaudeCliCaller';
import type { WebviewBridge } from './BugReportTypes';

const FORMSPREE_FORM_ID = 'mreajleg';
const AI_MODEL = 'claude-sonnet-4-6';
const AI_TIMEOUT_MS = 60_000;
const SCRIPT_TIMEOUT_MS = 30_000;
const SCRIPT_REGEX = /```(?:bash|powershell|cmd|sh)\n([\s\S]*?)```/g;

// Per-script output cap (applied at capture time to prevent conversation bloat).
const MAX_SCRIPT_OUTPUT_CHARS = 8_000;
// Formspree free-tier rejects payloads over ~100 KB.  We keep each chunk well
// under that and split into multiple submissions when the report is larger.
const MAX_CHUNK_CHARS = 80_000;
const CHUNK_DELAY_MS = 1_500;

function buildSystemPrompt(): string {
  const isWindows = process.platform === 'win32';
  const osName = isWindows ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux';
  const shell = isWindows ? 'CMD (cmd.exe)' : 'bash/zsh';
  const scriptLang = isWindows ? 'cmd' : 'bash';

  return `You are a bug diagnosis assistant for the ClaUi VS Code extension.

About ClaUi:
- ClaUi is a VS Code extension that provides a chat UI for AI coding assistants.
- It supports TWO providers: Claude (Anthropic CLI) and Codex (OpenAI CLI). The user can switch between them.
- Each provider has its own features and limitations. Do NOT assume the user is on Claude - ask which provider they are using if relevant, or pay attention to what they tell you.
- Key features: multi-tab sessions, plan approval, session history, achievements, skill generation, prompt enhancement, and more.

User's environment:
- Operating system: ${osName} (${process.platform} ${require('os').release()} ${require('os').arch()})
- Shell for command execution: ${shell}
${isWindows ? `- CRITICAL: Commands are executed via cmd.exe (NOT PowerShell). You MUST use CMD-compatible commands ONLY.
- Use: dir, type, findstr, where, echo, set, tasklist, systeminfo, ver
- Do NOT use PowerShell cmdlets like Get-ChildItem, Select-String, Get-Content, Get-Process, etc. -- they will FAIL.
- Do NOT use Unix commands like grep, ls, cat, etc. -- they will also FAIL.
- Example: To list files use "dir /b", to search file contents use "findstr /s /i \\"pattern\\" *.ext", to read a file use "type filename"` : ''}

Your goal is to understand the bug in depth. Ask focused questions to collect:
1. Exact description of the problem
2. Which provider they are using (Claude or Codex) if not already mentioned
3. Steps to reproduce
4. Expected behavior vs. actual behavior
5. When the issue started (after an update? always?)
6. Frequency (always, sometimes, once?)

Important rules:
- Listen carefully to what the user says. If they mention a specific provider (Claude/Codex), keep your questions relevant to that provider.
- Do NOT make assumptions about which provider or model they are using.
- When you need diagnostic information, propose a command in a fenced code block with language "${scriptLang}". The user will be asked to approve before execution.
- After a command runs, you will automatically receive the output. If it failed, adjust your command and try again using CMD-compatible syntax.

After gathering enough info, summarize your findings and tell the user the report is ready to send.
Keep responses concise. One question at a time is preferred.
Respond in the same language the user writes in.`;
}

/** Truncate text to `maxLen`, keeping the head (beginning) and appending a notice. */
function truncateHead(text: string, maxLen: number, label = 'content'): string {
  if (text.length <= maxLen) return text;
  const omitted = text.length - maxLen;
  return `${text.slice(0, maxLen)}\n... (${omitted} chars of remaining ${label} omitted)`;
}

export class BugReportService {
  private log: (msg: string) => void;
  private bridge: WebviewBridge;
  private extensionVersion: string;
  private logDir: string;
  private apiKey?: string;

  private diagnostics: DiagnosticsResult | null = null;
  private conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  private scriptOutputs: Array<{ command: string; output: string; exitCode: number }> = [];
  private cliCaller: ClaudeCliCaller;
  private disposed = false;

  constructor(
    bridge: WebviewBridge,
    log: (msg: string) => void,
    extensionVersion: string,
    logDir: string,
    apiKey?: string,
  ) {
    this.bridge = bridge;
    this.log = log;
    this.extensionVersion = extensionVersion;
    this.logDir = logDir;
    this.apiKey = apiKey;
    this.cliCaller = new ClaudeCliCaller();
    this.cliCaller.setLogger(log);
    if (apiKey) this.cliCaller.setApiKey(apiKey);
  }

  // -----------------------------------------------------------------------
  // Auto-collection
  // -----------------------------------------------------------------------

  async startAutoCollection(): Promise<void> {
    this.log('[BugReport] Starting auto-collection');
    this.postStatus('collecting');

    try {
      this.diagnostics = await collectDiagnostics(this.extensionVersion, this.logDir);
      if (this.disposed) return;
      this.log(`[BugReport] Auto-collection complete: ${this.diagnostics.summary.logFileCount} log files`);
      this.postStatus('ready', this.diagnostics.summary);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log(`[BugReport] Auto-collection failed: ${msg}`);
      this.postStatus('error', undefined, msg);
    }
  }

  // -----------------------------------------------------------------------
  // AI conversation (chain of one-shot calls)
  // -----------------------------------------------------------------------

  async handleChatMessage(userMessage: string): Promise<void> {
    this.conversationHistory.push({ role: 'user', content: userMessage });
    this.log(`[BugReport] User message (${userMessage.length} chars)`);
    await this.callAiWithHistory();
  }

  /**
   * Calls the AI with the full conversation history and sends the response to the webview.
   * Used by both handleChatMessage (user messages) and executeScript (script output auto-analysis).
   */
  private async callAiWithHistory(): Promise<void> {
    const historyText = this.conversationHistory
      .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n\n');

    const prompt = `${buildSystemPrompt()}\n\nConversation so far:\n${historyText}\n\nRespond as the Assistant:`;

    try {
      const response = await this.cliCaller.call({
        prompt,
        model: AI_MODEL,
        timeoutMs: AI_TIMEOUT_MS,
      });

      if (this.disposed) return;
      this.conversationHistory.push({ role: 'assistant', content: response });

      // Extract script suggestions from code blocks
      const scripts: Array<{ command: string; language: string }> = [];
      let match: RegExpExecArray | null;
      const regex = new RegExp(SCRIPT_REGEX.source, SCRIPT_REGEX.flags);
      while ((match = regex.exec(response)) !== null) {
        scripts.push({ command: match[1].trim(), language: match[0].split('\n')[0].replace('```', '') });
      }

      this.bridge.postMessage({
        type: 'bugReportChatResponse',
        text: response,
        scripts,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log(`[BugReport] AI call failed: ${msg}`);
      this.bridge.postMessage({
        type: 'bugReportChatResponse',
        text: `(AI error: ${msg}. You can continue describing the issue or send the report as-is.)`,
        scripts: [],
      });
    }
  }

  // -----------------------------------------------------------------------
  // Script execution
  // -----------------------------------------------------------------------

  async executeScript(command: string, index: number): Promise<void> {
    this.log(`[BugReport] Executing script #${index}: ${command.slice(0, 80)}`);

    let scriptOutput: string;
    let exitCode: number;

    try {
      const result = await this.runCommand(command);
      scriptOutput = result.stdout;
      exitCode = result.exitCode;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log(`[BugReport] Script execution failed: ${msg}`);
      scriptOutput = `Error: ${msg}`;
      exitCode = -1;
    }

    // Truncate large script outputs to prevent conversation/report bloat.
    // The full output still reaches the webview preview; only the stored
    // copy used for conversation history and report submission is capped.
    const cappedOutput = truncateHead(scriptOutput, MAX_SCRIPT_OUTPUT_CHARS, 'output');
    this.scriptOutputs.push({ command, output: cappedOutput, exitCode });

    if (this.disposed) return;
    this.bridge.postMessage({ type: 'bugReportScriptResult', index, output: scriptOutput, exitCode });

    // Feed result into conversation and auto-trigger AI to analyze the output.
    // Use the capped version so the conversation history stays manageable.
    const outputMsg = `[Script output for "${command.slice(0, 60)}" (exit code ${exitCode})]:\n${cappedOutput}`;
    this.conversationHistory.push({ role: 'user', content: outputMsg });

    // Auto-call AI so it can see and respond to the script output
    this.log('[BugReport] Auto-triggering AI to analyze script output');
    await this.callAiWithHistory();
  }

  private runCommand(command: string): Promise<{ stdout: string; exitCode: number }> {
    return new Promise((resolve) => {
      exec(command, { timeout: SCRIPT_TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
        const combined = (stdout || '') + (stderr ? `\n[stderr]: ${stderr}` : '');
        resolve({ stdout: combined, exitCode: err?.code ?? 0 });
      });
    });
  }

  // -----------------------------------------------------------------------
  // Preview
  // -----------------------------------------------------------------------

  getPreview(): Array<{ name: string; sizeBytes: number; preview?: string }> {
    const files: Array<{ name: string; sizeBytes: number; preview?: string }> = [];

    if (this.diagnostics) {
      files.push({
        name: 'System diagnostics (OS, VS Code, CLI versions, settings)',
        sizeBytes: Buffer.byteLength(this.diagnostics.systemInfo, 'utf-8'),
        preview: this.diagnostics.systemInfo.slice(0, 500),
      });

      // Show each log file with its full path
      for (const logPath of this.diagnostics.logFilePaths) {
        try {
          const stat = fs.statSync(logPath);
          files.push({
            name: logPath,
            sizeBytes: stat.size,
          });
        } catch {
          files.push({ name: logPath, sizeBytes: 0 });
        }
      }
    }

    if (this.conversationHistory.length > 0) {
      const json = JSON.stringify(this.conversationHistory, null, 2);
      files.push({
        name: 'AI conversation history',
        sizeBytes: Buffer.byteLength(json, 'utf-8'),
      });
    }

    for (let i = 0; i < this.scriptOutputs.length; i++) {
      const s = this.scriptOutputs[i];
      files.push({
        name: `Script output #${i + 1}: ${s.command.slice(0, 60)}`,
        sizeBytes: Buffer.byteLength(s.output, 'utf-8'),
        preview: `$ ${s.command}\n${s.output.slice(0, 200)}`,
      });
    }

    return files;
  }

  // -----------------------------------------------------------------------
  // Packaging & submission
  // -----------------------------------------------------------------------

  async submit(mode: 'quick' | 'ai', description?: string): Promise<void> {
    this.log(`[BugReport] Submitting report (mode=${mode})`);
    this.postStatus('sending');

    try {
      // ----- Build named sections (full content, no truncation) -----
      const sections: Array<{ name: string; content: string }> = [];

      const header = [
        `=== ClaUi Bug Report (${mode} mode) ===`,
        `Extension: v${this.extensionVersion}`,
        `Timestamp: ${new Date().toISOString()}`,
        '',
      ].join('\n');

      if (this.diagnostics) {
        sections.push({
          name: 'diagnostics',
          content: `--- System Diagnostics ---\n${this.diagnostics.systemInfo}\n`,
        });
      }

      if (mode === 'quick' && description) {
        sections.push({
          name: 'description',
          content: `--- Bug Description ---\n${description}\n`,
        });
      }

      if (mode === 'ai' && this.conversationHistory.length > 0) {
        const lines: string[] = ['--- AI Diagnosis Conversation ---'];
        for (const msg of this.conversationHistory) {
          lines.push(`[${msg.role.toUpperCase()}]:`, msg.content, '');
        }
        sections.push({ name: 'conversation', content: lines.join('\n') });
      }

      for (let i = 0; i < this.scriptOutputs.length; i++) {
        const s = this.scriptOutputs[i];
        sections.push({
          name: `script_${i + 1}`,
          content: `--- Script Output #${i + 1} (exit ${s.exitCode}) ---\n$ ${s.command}\n${s.output}\n`,
        });
      }

      if (this.diagnostics?.recentLogs) {
        sections.push({
          name: 'logs',
          content: `--- Recent Logs ---\n${this.diagnostics.recentLogs}\n`,
        });
      }

      const totalChars = header.length + sections.reduce((sum, s) => sum + s.content.length, 0);
      this.log(`[BugReport] Report: ${totalChars} chars across ${sections.length} sections`);

      // ----- Build ZIP (for multipart upload on paid plans) -----
      const zip = new AdmZip();
      if (this.diagnostics) {
        zip.addFile('diagnostics.txt', Buffer.from(this.diagnostics.systemInfo, 'utf-8'));
        zip.addFile('logs.txt', Buffer.from(this.diagnostics.recentLogs, 'utf-8'));
      }
      if (mode === 'quick' && description) {
        zip.addFile('description.txt', Buffer.from(description, 'utf-8'));
      }
      if (mode === 'ai' && this.conversationHistory.length > 0) {
        zip.addFile('conversation.json', Buffer.from(JSON.stringify(this.conversationHistory, null, 2), 'utf-8'));
      }
      for (let i = 0; i < this.scriptOutputs.length; i++) {
        const s = this.scriptOutputs[i];
        zip.addFile(`script_output_${i + 1}.txt`, Buffer.from(`$ ${s.command}\n\n${s.output}`, 'utf-8'));
      }
      const zipBuffer = zip.toBuffer();

      // ----- Show success immediately so the user can close the panel -----
      this.log('[BugReport] Report assembled, showing success to user');
      this.postStatus('sent');
      this.bridge.postMessage({ type: 'bugReportSubmitResult', ok: true });

      // ----- Send in the background (fire-and-forget) -----
      const formspree = new FormspreeService(FORMSPREE_FORM_ID);
      formspree.setLogger(this.log);

      this.sendInBackground(formspree, mode, header, sections, zipBuffer);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log(`[BugReport] Submit error: ${msg}`);
      this.postStatus('error', undefined, msg);
      this.bridge.postMessage({ type: 'bugReportSubmitResult', ok: false, error: msg });
    }
  }

  /**
   * Fire-and-forget: send the report via Formspree in the background.
   * The user already sees "sent" and can close the panel.
   */
  private sendInBackground(
    formspree: FormspreeService,
    mode: string,
    header: string,
    sections: Array<{ name: string; content: string }>,
    zipBuffer: Buffer,
  ): void {
    const totalChars = header.length + sections.reduce((sum, s) => sum + s.content.length, 0);

    const doSend = async () => {
      if (totalChars <= MAX_CHUNK_CHARS) {
        this.log('[BugReport] Background: single submission');
        const fullMessage = header + sections.map(s => s.content).join('\n');
        const result = await formspree.submit({
          message: fullMessage,
          subject: `ClaUi Bug Report (${mode})`,
          category: 'bug',
          extensionVersion: this.extensionVersion,
          attachments: [{ filename: 'bug-report.zip', content: zipBuffer, contentType: 'application/zip' }],
        });
        if (!result.ok) {
          this.log(`[BugReport] Background send failed: ${result.error}`);
        } else {
          this.log('[BugReport] Background send complete');
        }
      } else {
        const chunks = this.splitSectionsIntoChunks(header, sections);
        this.log(`[BugReport] Background: chunked submission (${chunks.length} parts)`);

        const payloads = chunks.map((chunk, i) => ({
          message: `${header}[Part ${i + 1} of ${chunks.length}]\n\n${chunk}`,
          subject: `ClaUi Bug Report (${mode}) - Part ${i + 1}/${chunks.length}`,
          category: 'bug',
          extensionVersion: this.extensionVersion,
          ...(i === 0
            ? { attachments: [{ filename: 'bug-report.zip', content: zipBuffer, contentType: 'application/zip' }] }
            : {}),
        }));

        const result = await formspree.submitChunked(payloads, CHUNK_DELAY_MS);
        if (!result.ok) {
          this.log(`[BugReport] Background chunked send failed: ${result.error}`);
        } else {
          this.log(`[BugReport] Background chunked send complete (${chunks.length} parts)`);
        }
      }
    };

    doSend().catch(err => {
      this.log(`[BugReport] Background send error: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  /**
   * Split report sections into chunks where each chunk fits under MAX_CHUNK_CHARS.
   * Sections are kept intact when possible; oversized sections are truncated.
   */
  private splitSectionsIntoChunks(
    header: string,
    sections: Array<{ name: string; content: string }>,
  ): string[] {
    // Reserve space for the header + "[Part N of M]\n\n" label per chunk
    const overhead = header.length + 50;
    const budget = MAX_CHUNK_CHARS - overhead;

    const chunks: string[] = [];
    let currentParts: string[] = [];
    let currentSize = 0;

    for (const section of sections) {
      const len = section.content.length;

      if (len > budget) {
        // Single section exceeds budget — flush current chunk, then truncate
        if (currentParts.length > 0) {
          chunks.push(currentParts.join('\n'));
          currentParts = [];
          currentSize = 0;
        }
        chunks.push(truncateHead(section.content, budget, section.name));
      } else if (currentSize + len > budget) {
        // Adding this section would exceed the budget — start a new chunk
        chunks.push(currentParts.join('\n'));
        currentParts = [section.content];
        currentSize = len;
      } else {
        currentParts.push(section.content);
        currentSize += len;
      }
    }

    if (currentParts.length > 0) {
      chunks.push(currentParts.join('\n'));
    }

    return chunks;
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private postStatus(
    phase: 'collecting' | 'ready' | 'sending' | 'sent' | 'error',
    summary?: DiagnosticsResult['summary'],
    error?: string,
  ): void {
    this.bridge.postMessage({
      type: 'bugReportStatus',
      phase,
      ...(summary ? { summary } : {}),
      ...(error ? { error } : {}),
    } as any);
  }

  dispose(): void {
    this.disposed = true;
    this.diagnostics = null;
    this.conversationHistory = [];
    this.scriptOutputs = [];
  }
}
