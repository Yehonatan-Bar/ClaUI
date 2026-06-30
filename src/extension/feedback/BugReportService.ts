/**
 * BugReportService - orchestrates the full bug report lifecycle:
 * auto-collection, AI conversation, script execution, ZIP packaging, submission.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import { exec } from 'child_process';
import AdmZip from 'adm-zip';
import { collectDiagnostics, DiagnosticsResult } from './DiagnosticsCollector';
import { FormspreeService, type FeedbackResult } from './FormspreeService';
import { ClaudeCliCaller } from '../skillgen/ClaudeCliCaller';
import type { WebviewBridge } from './BugReportTypes';
import type { BugReportContext } from '../types/webview-messages';

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
  private context: BugReportContext | null = null;
  private secretProtectionService: import('../secret-protection/SecretProtectionService').SecretProtectionService | null = null;

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

  setSecretProtectionService(service: import('../secret-protection/SecretProtectionService').SecretProtectionService): void {
    this.secretProtectionService = service;
  }

  // -----------------------------------------------------------------------
  // Auto-collection
  // -----------------------------------------------------------------------

  async startAutoCollection(context?: BugReportContext): Promise<void> {
    this.context = context ?? null;
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
    const featureContext = this.context?.metadataText
      ? `\n\nFeature-specific context snapshot:\n${truncateHead(this.context.metadataText, 6_000, 'feature context')}\nUse it as current state unless the user corrects it.`
      : '';

    const prompt = `${buildSystemPrompt()}${featureContext}\n\nConversation so far:\n${historyText}\n\nRespond as the Assistant:`;

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

    if (this.context?.metadataText) {
      files.push({
        name: this.context.source === 'mcp' ? 'MCP context snapshot' : 'Feature context snapshot',
        sizeBytes: Buffer.byteLength(this.context.metadataText, 'utf-8'),
        preview: truncateHead(this.context.metadataText, 500, 'feature context'),
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
      const reportLabel = this.context?.source === 'mcp' ? 'ClaUi MCP Bug Report' : 'ClaUi Bug Report';

      const header = [
        `=== ${reportLabel} (${mode} mode) ===`,
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

      if (this.context?.metadataText) {
        sections.push({
          name: 'feature_context',
          content: `--- ${this.context.source === 'mcp' ? 'MCP' : 'Feature'} Context Snapshot ---\n${this.context.metadataText}\n`,
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

      // ----- DLP scan before sending externally -----
      if (this.secretProtectionService?.isEnabled()) {
        const broker = this.secretProtectionService.getBroker();
        if (broker) {
          const fullContent = header + sections.map(s => s.content).join('\n');
          const decision = await broker.scanDiagnosticExport(fullContent, 'formspree.io');
          if (decision.action === 'block' || decision.action === 'require_approval') {
            this.log(`[SecretProtection] Bug report blocked: ${decision.reason}`);
            if (this.disposed) return;
            this.postStatus('error', undefined, `Secret protection blocked this report: ${decision.reason}`);
            this.bridge.postMessage({
              type: 'bugReportSubmitResult',
              ok: false,
              error: `Secret protection blocked this report: ${decision.reason}`,
            });
            return;
          }
          if (decision.action === 'redact' && decision.redactedContent) {
            this.log(`[SecretProtection] Bug report redacted: ${decision.audit.redactionCount} redactions`);
            // The redacted content is the full concatenated text (header + all sections).
            // Re-split it back into sections by matching each section's separator line.
            let remaining = decision.redactedContent;
            const headerEnd = remaining.indexOf('\n---');
            if (headerEnd >= 0) {
              remaining = remaining.slice(headerEnd);
            }
            for (const section of sections) {
              const sectionHeader = section.content.split('\n')[0];
              const startIdx = remaining.indexOf(sectionHeader);
              if (startIdx < 0) continue;
              const afterStart = remaining.indexOf('\n---', startIdx + sectionHeader.length);
              const sectionEnd = afterStart >= 0 ? afterStart : remaining.length;
              section.content = remaining.slice(startIdx, sectionEnd) + '\n';
            }
          }
        }
      }

      // ----- Build ZIP from the (potentially redacted) sections -----
      // The ZIP must use section content, NOT the raw source fields, because DLP
      // redaction above only modifies sections. Using raw fields would leak secrets.
      const zip = new AdmZip();
      const sectionByName = new Map(sections.map(s => [s.name, s.content]));

      if (sectionByName.has('diagnostics')) {
        zip.addFile('diagnostics.txt', Buffer.from(sectionByName.get('diagnostics')!, 'utf-8'));
      }
      if (sectionByName.has('logs')) {
        zip.addFile('logs.txt', Buffer.from(sectionByName.get('logs')!, 'utf-8'));
      }
      if (sectionByName.has('feature_context')) {
        zip.addFile(
          this.context?.source === 'mcp' ? 'mcp-context.txt' : 'feature-context.txt',
          Buffer.from(sectionByName.get('feature_context')!, 'utf-8'),
        );
      }
      if (sectionByName.has('description')) {
        zip.addFile('description.txt', Buffer.from(sectionByName.get('description')!, 'utf-8'));
      }
      if (sectionByName.has('conversation')) {
        zip.addFile('conversation.json', Buffer.from(sectionByName.get('conversation')!, 'utf-8'));
      }
      for (let i = 0; i < this.scriptOutputs.length; i++) {
        const key = `script_${i + 1}`;
        if (sectionByName.has(key)) {
          zip.addFile(`script_output_${i + 1}.txt`, Buffer.from(sectionByName.get(key)!, 'utf-8'));
        }
      }
      const zipBuffer = zip.toBuffer();

      // ----- Send and report the REAL result -----
      // Success ("sent") is shown ONLY after every part has actually been sent,
      // so the user is never told the report went out when parts are still in
      // flight (or failed). The UI shows the 'sending' spinner meanwhile.
      this.log('[BugReport] Report assembled, sending now');
      const formspree = new FormspreeService(FORMSPREE_FORM_ID);
      formspree.setLogger(this.log);

      const sendResult = await this.sendReport(formspree, mode, reportLabel, header, sections, zipBuffer);
      if (this.disposed) return;

      if (sendResult.ok) {
        this.log('[BugReport] Report sent successfully (all parts confirmed)');
        this.postStatus('sent');
        this.bridge.postMessage({ type: 'bugReportSubmitResult', ok: true });
      } else {
        this.log(`[BugReport] Report send failed: ${sendResult.error}`);
        this.postStatus('error', undefined, sendResult.error);
        this.bridge.postMessage({ type: 'bugReportSubmitResult', ok: false, error: sendResult.error });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log(`[BugReport] Submit error: ${msg}`);
      if (this.disposed) return;
      this.postStatus('error', undefined, msg);
      this.bridge.postMessage({ type: 'bugReportSubmitResult', ok: false, error: msg });
    }
  }

  /**
   * Send the report via Formspree and return the real result. Resolves only
   * after every part has been attempted, so the caller can show a truthful
   * "sent"/"error" state instead of an optimistic one.
   */
  private async sendReport(
    formspree: FormspreeService,
    mode: string,
    reportLabel: string,
    header: string,
    sections: Array<{ name: string; content: string }>,
    zipBuffer: Buffer,
  ): Promise<FeedbackResult> {
    const totalChars = header.length + sections.reduce((sum, s) => sum + s.content.length, 0);

    if (totalChars <= MAX_CHUNK_CHARS) {
      this.log('[BugReport] Single submission');
      const fullMessage = header + sections.map(s => s.content).join('\n');
      const result = await formspree.submit({
        message: fullMessage,
        subject: `${reportLabel} (${mode})`,
        category: 'bug',
        extensionVersion: this.extensionVersion,
        attachments: [{ filename: 'bug-report.zip', content: zipBuffer, contentType: 'application/zip' }],
      });
      this.log(result.ok ? '[BugReport] Single send complete' : `[BugReport] Single send failed: ${result.error}`);
      return result;
    }

    const chunks = this.splitSectionsIntoChunks(header, sections);
    this.log(`[BugReport] Chunked submission (${chunks.length} parts)`);

    const payloads = chunks.map((chunk, i) => ({
      message: `${header}[Part ${i + 1} of ${chunks.length}]\n\n${chunk}`,
      subject: `${reportLabel} (${mode}) - Part ${i + 1}/${chunks.length}`,
      category: 'bug',
      extensionVersion: this.extensionVersion,
      ...(i === 0
        ? { attachments: [{ filename: 'bug-report.zip', content: zipBuffer, contentType: 'application/zip' }] }
        : {}),
    }));

    const result = await formspree.submitChunked(payloads, CHUNK_DELAY_MS);
    this.log(
      result.ok
        ? `[BugReport] Chunked send complete (${chunks.length} parts accepted)`
        : `[BugReport] Chunked send failed: ${result.error}`,
    );
    return result;
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
    this.context = null;
  }
}
