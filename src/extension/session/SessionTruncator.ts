import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { findSessionJsonlPath } from './sessionPathResolver';

export interface TruncationResult {
  newSessionId: string;
  jsonlPath: string;
  linesWritten: number;
  uiMessagesKept: number;
}

enum LineRole {
  METADATA,
  REAL_USER,
  TOOL_RESULT_USER,
  META_USER,
  ASSISTANT,
}

interface LineAnnotation {
  lineIndex: number;
  role: LineRole;
  assistantMsgId?: string;
  uiMessageIndex?: number;
}

export class SessionTruncator {
  constructor(private readonly log: (msg: string) => void = () => {}) {}

  truncateSession(
    originalSessionId: string,
    forkMessageIndex: number,
    workspacePath?: string,
    claudeConfigDir?: string
  ): TruncationResult | null {
    const jsonlPath = findSessionJsonlPath(originalSessionId, workspacePath, claudeConfigDir);
    if (!jsonlPath) {
      this.log(`[SessionTruncator] JSONL not found for ${originalSessionId}`);
      return null;
    }

    let content: string;
    try {
      content = fs.readFileSync(jsonlPath, 'utf-8');
    } catch (err) {
      this.log(`[SessionTruncator] Failed to read ${jsonlPath}: ${err}`);
      return null;
    }

    const rawLines = content.split('\n').filter(l => l.trim());
    const parsedLines: (Record<string, unknown> | null)[] = rawLines.map(l => {
      try { return JSON.parse(l); } catch { return null; }
    });

    const annotations = this.buildAnnotations(parsedLines);
    let cutLine = this.findCutPoint(annotations, forkMessageIndex);
    cutLine = this.ensureValidConversation(parsedLines, annotations, cutLine);
    cutLine = this.ensureEndsWithAssistant(parsedLines, annotations, cutLine);

    // Check if the truncation would produce any actual conversation content
    const hasUiContent = annotations.slice(0, cutLine).some(a => a.uiMessageIndex !== undefined);
    if (cutLine <= 0 || !hasUiContent) {
      this.log('[SessionTruncator] Cut point leaves no conversation content');
      return null;
    }

    const sourceDir = path.dirname(jsonlPath);
    return this.writeTruncatedFile(parsedLines, annotations, cutLine, sourceDir);
  }

  private classifyLine(entry: Record<string, unknown> | null): LineRole {
    if (!entry) return LineRole.METADATA;

    const type = entry.type as string;
    if (type !== 'user' && type !== 'assistant') {
      return LineRole.METADATA;
    }

    if (type === 'assistant') {
      return LineRole.ASSISTANT;
    }

    if (entry.isMeta === true) {
      return LineRole.META_USER;
    }

    const msg = entry.message as { content?: unknown } | undefined;
    if (!msg) return LineRole.METADATA;

    const contentArr = msg.content;
    if (Array.isArray(contentArr)) {
      const hasToolResult = contentArr.some(
        (b: Record<string, unknown>) => b.type === 'tool_result'
      );
      if (hasToolResult) return LineRole.TOOL_RESULT_USER;
    }

    return LineRole.REAL_USER;
  }

  private buildAnnotations(parsedLines: (Record<string, unknown> | null)[]): LineAnnotation[] {
    const annotations: LineAnnotation[] = [];
    let uiIndex = 0;
    const pendingAssistantIds: string[] = [];
    const pendingAnnotationsByMsgId = new Map<string, number[]>();

    for (let i = 0; i < parsedLines.length; i++) {
      const entry = parsedLines[i];
      const role = this.classifyLine(entry);
      const annotation: LineAnnotation = { lineIndex: i, role };

      if (role === LineRole.REAL_USER || role === LineRole.TOOL_RESULT_USER || role === LineRole.META_USER) {
        for (const id of pendingAssistantIds) {
          const indices = pendingAnnotationsByMsgId.get(id);
          if (indices) {
            for (const idx of indices) {
              annotations[idx].uiMessageIndex = uiIndex;
            }
            uiIndex++;
          }
        }
        pendingAssistantIds.length = 0;
        pendingAnnotationsByMsgId.clear();

        if (role === LineRole.REAL_USER) {
          annotation.uiMessageIndex = uiIndex;
          uiIndex++;
        } else if (role === LineRole.META_USER) {
          annotation.uiMessageIndex = uiIndex;
          uiIndex++;
        }
      } else if (role === LineRole.ASSISTANT && entry) {
        const msg = entry.message as { id?: string } | undefined;
        const msgId = msg?.id || `unknown-${i}`;
        annotation.assistantMsgId = msgId;

        if (!pendingAnnotationsByMsgId.has(msgId)) {
          pendingAssistantIds.push(msgId);
          pendingAnnotationsByMsgId.set(msgId, []);
        }
        pendingAnnotationsByMsgId.get(msgId)!.push(i);
      }

      annotations.push(annotation);
    }

    // Flush remaining assistant messages
    for (const id of pendingAssistantIds) {
      const indices = pendingAnnotationsByMsgId.get(id);
      if (indices) {
        for (const idx of indices) {
          annotations[idx].uiMessageIndex = uiIndex;
        }
        uiIndex++;
      }
    }

    return annotations;
  }

  private findCutPoint(annotations: LineAnnotation[], forkMessageIndex: number): number {
    for (const ann of annotations) {
      if (ann.uiMessageIndex !== undefined && ann.uiMessageIndex >= forkMessageIndex) {
        return ann.lineIndex;
      }
    }
    return annotations.length;
  }

  private ensureValidConversation(
    parsedLines: (Record<string, unknown> | null)[],
    annotations: LineAnnotation[],
    initialCut: number
  ): number {
    let cut = initialCut;

    while (true) {
      let lastAssistantLine = -1;
      for (let i = cut - 1; i >= 0; i--) {
        if (annotations[i].role === LineRole.ASSISTANT) {
          lastAssistantLine = i;
          break;
        }
      }

      if (lastAssistantLine === -1) break;

      const msgId = annotations[lastAssistantLine].assistantMsgId;
      const allBlocks: unknown[] = [];
      for (let i = 0; i < cut; i++) {
        if (annotations[i].role === LineRole.ASSISTANT && annotations[i].assistantMsgId === msgId) {
          const entry = parsedLines[i];
          const blocks = (entry as any)?.message?.content ?? [];
          if (Array.isArray(blocks)) {
            allBlocks.push(...blocks);
          }
        }
      }

      const lastBlock = allBlocks[allBlocks.length - 1] as Record<string, unknown> | undefined;
      if (!lastBlock || lastBlock.type !== 'tool_use') {
        break;
      }

      // Dangling tool_use: extend forward to include tool_result + next assistant
      let extended = false;
      for (let i = cut; i < annotations.length; i++) {
        if (annotations[i].role === LineRole.TOOL_RESULT_USER) {
          cut = i + 1;
          for (let j = i + 1; j < annotations.length; j++) {
            if (annotations[j].role === LineRole.ASSISTANT) {
              const aid = annotations[j].assistantMsgId;
              let k = j;
              while (k < annotations.length
                     && annotations[k].role === LineRole.ASSISTANT
                     && annotations[k].assistantMsgId === aid) {
                k++;
              }
              cut = k;
              extended = true;
              break;
            }
            if (annotations[j].role === LineRole.REAL_USER) {
              break;
            }
          }
          break;
        }
        if (annotations[i].role === LineRole.REAL_USER) {
          break;
        }
      }

      if (!extended) break;
    }

    return cut;
  }

  private isUserRole(role: LineRole): boolean {
    return role === LineRole.REAL_USER
      || role === LineRole.META_USER
      || role === LineRole.TOOL_RESULT_USER;
  }

  private ensureEndsWithAssistant(
    parsedLines: (Record<string, unknown> | null)[],
    annotations: LineAnnotation[],
    cut: number,
  ): number {
    let newCut = cut;

    while (newCut > 0) {
      let lastContentIdx = -1;
      for (let i = newCut - 1; i >= 0; i--) {
        if (annotations[i].role !== LineRole.METADATA) {
          lastContentIdx = i;
          break;
        }
      }

      if (lastContentIdx === -1) break;

      // A trailing user-role line (real / meta / tool_result) can't be the last
      // message: drop it so the conversation ends on an assistant turn.
      if (annotations[lastContentIdx].role !== LineRole.ASSISTANT) {
        newCut = lastContentIdx;
        continue;
      }

      // Landed on an assistant. It is a valid terminal turn ONLY if its merged
      // content does not end with a tool_use block. If it does, the matching
      // tool_result lives after this line and has been trimmed away — keeping it
      // would leave a dangling tool_use that the Anthropic API rejects. Drop the
      // whole group and keep walking back to the previous terminal assistant.
      const groupStart = this.assistantGroupStart(annotations, lastContentIdx);
      if (this.assistantGroupEndsWithToolUse(parsedLines, annotations, groupStart, lastContentIdx)) {
        newCut = groupStart;
        continue;
      }

      break;
    }

    return newCut;
  }

  /** First line index of the contiguous assistant group (same message id) ending at `endIdx`. */
  private assistantGroupStart(annotations: LineAnnotation[], endIdx: number): number {
    const msgId = annotations[endIdx].assistantMsgId;
    let start = endIdx;
    while (
      start - 1 >= 0 &&
      annotations[start - 1].role === LineRole.ASSISTANT &&
      annotations[start - 1].assistantMsgId === msgId
    ) {
      start--;
    }
    return start;
  }

  /** True when the merged blocks of the assistant group [start..end] end with a tool_use. */
  private assistantGroupEndsWithToolUse(
    parsedLines: (Record<string, unknown> | null)[],
    annotations: LineAnnotation[],
    start: number,
    end: number,
  ): boolean {
    const msgId = annotations[end].assistantMsgId;
    const blocks: unknown[] = [];
    for (let i = start; i <= end; i++) {
      if (annotations[i].role === LineRole.ASSISTANT && annotations[i].assistantMsgId === msgId) {
        const content = (parsedLines[i] as any)?.message?.content;
        if (Array.isArray(content)) {
          blocks.push(...content);
        }
      }
    }
    const lastBlock = blocks[blocks.length - 1] as Record<string, unknown> | undefined;
    return !!lastBlock && lastBlock.type === 'tool_use';
  }

  private writeTruncatedFile(
    parsedLines: (Record<string, unknown> | null)[],
    annotations: LineAnnotation[],
    cutLineIndex: number,
    sourceDir: string
  ): TruncationResult {
    const newSessionId = crypto.randomUUID();
    const outputPath = path.join(sourceDir, `${newSessionId}.jsonl`);

    const outputLines: string[] = [];
    let maxUiMessage = -1;

    for (let i = 0; i < cutLineIndex; i++) {
      const entry = parsedLines[i];
      if (!entry) continue;

      const type = entry.type as string;

      // Skip last-prompt markers (the CLI writes its own on resume)
      if (type === 'last-prompt') continue;

      if ('sessionId' in entry) {
        entry.sessionId = newSessionId;
      }

      if (annotations[i].uiMessageIndex !== undefined && annotations[i].uiMessageIndex! > maxUiMessage) {
        maxUiMessage = annotations[i].uiMessageIndex!;
      }

      outputLines.push(JSON.stringify(entry));
    }

    fs.writeFileSync(outputPath, outputLines.join('\n') + '\n', 'utf-8');

    this.log(`[SessionTruncator] Wrote ${outputLines.length} lines to ${outputPath}`);

    return {
      newSessionId,
      jsonlPath: outputPath,
      linesWritten: outputLines.length,
      uiMessagesKept: maxUiMessage + 1,
    };
  }
}
