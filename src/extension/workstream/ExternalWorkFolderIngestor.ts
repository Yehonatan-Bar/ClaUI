import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import AdmZip from 'adm-zip';
import type {
  StationStatus,
  StationType,
  WorkstreamCurrentState,
  WorkstreamStatus,
  WorkstreamType,
} from '../types/workstreamTypes';

const MAX_FILES = 80;
const MAX_DEPTH = 6;
const MAX_CHARS_PER_FILE = 8_000;
const MAX_TOTAL_CHARS = 70_000;
const MAX_STATIONS = 8;

const SUPPORTED_EXTENSIONS = new Set([
  '.md',
  '.markdown',
  '.txt',
  '.rst',
  '.adoc',
  '.json',
  '.jsonl',
  '.yaml',
  '.yml',
  '.csv',
  '.tsv',
  '.html',
  '.htm',
  '.xml',
  '.docx',
]);

const SKIP_DIRECTORIES = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'dist',
  'out',
  'build',
  'coverage',
  '.next',
  '.turbo',
  'target',
  'bin',
  'obj',
]);

export interface ExternalWorkDocument {
  absolutePath: string;
  relativePath: string;
  modifiedAt: string;
  sizeBytes: number;
  text: string;
  truncated: boolean;
}

export interface ExternalWorkDigestStation {
  type: StationType;
  status: StationStatus;
  label: string;
  description: string;
  whyItMatters: string;
  importanceScore: number;
  attentionScore: number;
  confidence: number;
  sourceFilePaths: string[];
  evidenceText: string;
}

export interface ExternalWorkDigest {
  folderPath: string;
  folderName: string;
  documents: ExternalWorkDocument[];
  skippedFiles: number;
  totalBytes: number;
  label: string;
  goal: string;
  type: WorkstreamType;
  status: WorkstreamStatus;
  confidence: number;
  confidenceReasons: string[];
  currentState: {
    phase: WorkstreamCurrentState['phase'];
    summary: string;
    lastMeaningfulProgress: string;
    nextLikelyAction: string;
    openQuestions: string[];
    blockers: Array<{ label: string; description: string; severity: 'low' | 'medium' | 'high' }>;
    pendingDecisions: Array<{ label: string; options?: string[] }>;
  };
  stations: ExternalWorkDigestStation[];
}

interface RawDigest {
  label?: unknown;
  goal?: unknown;
  type?: unknown;
  status?: unknown;
  confidence?: unknown;
  confidenceReasons?: unknown;
  currentState?: {
    phase?: unknown;
    summary?: unknown;
    lastMeaningfulProgress?: unknown;
    nextLikelyAction?: unknown;
    openQuestions?: unknown;
    blockers?: unknown;
    pendingDecisions?: unknown;
  };
  stations?: unknown;
}

export class ExternalWorkFolderIngestor {
  constructor(private readonly log: (msg: string) => void = () => {}) {}

  async ingest(folderPath: string, cliPath: string, workspacePath: string): Promise<ExternalWorkDigest> {
    const normalizedFolder = path.resolve(folderPath);
    const stat = await fs.stat(normalizedFolder);
    if (!stat.isDirectory()) {
      throw new Error(`External work path is not a folder: ${normalizedFolder}`);
    }

    const { documents, skippedFiles } = await this.collectDocuments(normalizedFolder);
    if (documents.length === 0) {
      throw new Error(`No supported text documents found in ${normalizedFolder}`);
    }

    this.log(`[ExternalIngest] Collected ${documents.length} documents from "${normalizedFolder}" (skipped=${skippedFiles})`);

    try {
      const raw = await this.callSonnet(
        this.buildDigestPrompt(normalizedFolder, documents, skippedFiles),
        cliPath,
        workspacePath,
      );
      return this.normalizeDigest(raw, normalizedFolder, documents, skippedFiles);
    } catch (err) {
      this.log(`[ExternalIngest] AI digest failed, using heuristic fallback: ${err instanceof Error ? err.message : String(err)}`);
      return this.buildHeuristicDigest(normalizedFolder, documents, skippedFiles);
    }
  }

  private async collectDocuments(folderPath: string): Promise<{ documents: ExternalWorkDocument[]; skippedFiles: number }> {
    const documents: ExternalWorkDocument[] = [];
    let skippedFiles = 0;
    let totalChars = 0;

    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > MAX_DEPTH || documents.length >= MAX_FILES || totalChars >= MAX_TOTAL_CHARS) {
        return;
      }

      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (documents.length >= MAX_FILES || totalChars >= MAX_TOTAL_CHARS) {
          break;
        }

        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!SKIP_DIRECTORIES.has(entry.name)) {
            await walk(fullPath, depth + 1);
          }
          continue;
        }

        if (!entry.isFile()) {
          skippedFiles++;
          continue;
        }

        const ext = path.extname(entry.name).toLowerCase();
        if (!SUPPORTED_EXTENSIONS.has(ext)) {
          skippedFiles++;
          continue;
        }

        try {
          const stat = await fs.stat(fullPath);
          const rawText = await this.readTextFile(fullPath, ext);
          const cleaned = this.cleanText(rawText);
          if (!cleaned) {
            skippedFiles++;
            continue;
          }

          const remaining = MAX_TOTAL_CHARS - totalChars;
          const text = cleaned.slice(0, Math.min(MAX_CHARS_PER_FILE, remaining));
          const truncated = cleaned.length > text.length;
          totalChars += text.length;

          documents.push({
            absolutePath: this.normalizePath(fullPath),
            relativePath: this.normalizePath(path.relative(folderPath, fullPath)),
            modifiedAt: stat.mtime.toISOString(),
            sizeBytes: stat.size,
            text,
            truncated,
          });
        } catch (err) {
          skippedFiles++;
          this.log(`[ExternalIngest] Skipped "${fullPath}": ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    };

    await walk(folderPath, 0);
    return { documents, skippedFiles };
  }

  private async readTextFile(filePath: string, ext: string): Promise<string> {
    if (ext === '.docx') {
      return this.readDocx(filePath);
    }

    const buf = await fs.readFile(filePath);
    if (buf.includes(0)) {
      throw new Error('Binary-looking file');
    }
    return buf.toString('utf8');
  }

  private readDocx(filePath: string): string {
    const zip = new AdmZip(filePath);
    const entry = zip.getEntry('word/document.xml');
    if (!entry) {
      throw new Error('DOCX document body not found');
    }

    const xml = entry.getData().toString('utf8');
    return this.decodeXmlEntities(
      xml
        .replace(/<\/w:p>/g, '\n')
        .replace(/<[^>]+>/g, ' ')
    );
  }

  private cleanText(text: string): string {
    const withoutTags = text
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ');

    return this.decodeXmlEntities(withoutTags)
      .replace(/\r\n/g, '\n')
      .replace(/\t/g, ' ')
      .replace(/[ \f\v]+/g, ' ')
      .replace(/\n{4,}/g, '\n\n\n')
      .trim();
  }

  private decodeXmlEntities(text: string): string {
    return text
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  }

  private buildDigestPrompt(folderPath: string, documents: ExternalWorkDocument[], skippedFiles: number): string {
    const folderName = path.basename(folderPath);
    const docBlock = documents.map((doc, index) => {
      return [
        `### Document ${index + 1}: ${doc.relativePath}`,
        `modifiedAt: ${doc.modifiedAt}`,
        `sizeBytes: ${doc.sizeBytes}`,
        `truncated: ${doc.truncated}`,
        '```text',
        doc.text,
        '```',
      ].join('\n');
    }).join('\n\n');

    return `You digest explicitly imported external work documents into a single project workstream.

The user intentionally selected this folder. Treat its documents as evidence of work that happened outside this Claude/Codex session, such as emails, model chats, specs, notes, meeting summaries, or planning docs.

Folder: ${folderName}
Path: ${folderPath}
Documents included: ${documents.length}
Skipped unsupported/binary files: ${skippedFiles}

Rules:
- Produce one coherent workstream representing the external work in this folder.
- Use the documents as evidence. Do not invent facts that are not in the documents.
- Prefer concrete project wording over generic labels like "External Work".
- If the folder contains multiple unrelated efforts, describe the dominant effort and put uncertainty in openQuestions.
- Stations should be meaningful events: requirements, decisions, blockers, milestones, plan changes, unresolved questions.
- Source file paths in stations must exactly match document relative paths from the input.
- Return confidence scores from 0 to 1.

Documents:
${docBlock}

Respond with ONLY valid JSON matching this schema:
{
  "label": "string, max 50 chars",
  "goal": "string, one sentence",
  "type": "feature|bug_fix|research|refactor|infrastructure|experiment|abandoned_experiment|uncategorized",
  "status": "active|completed|blocked|uncertain|research|abandoned|planning",
  "confidence": 0.0,
  "confidenceReasons": ["string"],
  "currentState": {
    "phase": "not_started|planning|implementation|debugging|testing|review|blocked|complete|abandoned|unknown",
    "summary": "string",
    "lastMeaningfulProgress": "string",
    "nextLikelyAction": "string",
    "openQuestions": ["string"],
    "blockers": [{"label": "string", "description": "string", "severity": "low|medium|high"}],
    "pendingDecisions": [{"label": "string", "options": ["string"]}]
  },
  "stations": [{
    "type": "session|decision|code_change|problem|milestone|failure|uncertainty|blocker|direction_change|merge_point|split_point|plan_step",
    "status": "completed|partial|failed|pending|skipped",
    "label": "string, max 60 chars",
    "description": "string",
    "whyItMatters": "string",
    "importanceScore": 0.0,
    "attentionScore": 0.0,
    "confidence": 0.0,
    "sourceFilePaths": ["relative/path/from/input.md"],
    "evidenceText": "brief supporting excerpt or paraphrase"
  }]
}`;
  }

  private async callSonnet(prompt: string, cliPath: string, workspacePath: string): Promise<RawDigest> {
    return await new Promise<RawDigest>((resolve, reject) => {
      const args = ['-p', '--output-format', 'json', '--model', 'claude-sonnet-4-6'];
      this.log(`[ExternalIngest] Spawning CLI: path="${cliPath}", promptLen=${prompt.length}, cwd="${workspacePath}"`);

      const proc = spawn(cliPath, args, {
        cwd: workspacePath,
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      let stdout = '';
      let stderr = '';
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          proc.kill();
          reject(new Error('External folder digest timed out after 90s'));
        }
      }, 90_000);

      proc.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
      proc.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        if (settled) { return; }
        settled = true;
        clearTimeout(timer);

        this.log(`[ExternalIngest] Process closed: exitCode=${code}, stdoutLen=${stdout.length}, stderrLen=${stderr.length}`);
        if (stderr.length > 0) {
          this.log(`[ExternalIngest] stderr: ${stderr.slice(-300)}`);
        }
        if (code !== 0) {
          reject(new Error(`External folder digest failed (exit ${code}): ${stderr}`));
          return;
        }

        try {
          let textToSearch = stdout;
          try {
            const envelope = JSON.parse(stdout) as { result?: unknown };
            if (typeof envelope.result === 'string') {
              textToSearch = envelope.result;
            }
          } catch {
            // stdout may already be raw model text.
          }

          const jsonMatch = textToSearch.match(/\{[\s\S]*\}/);
          if (!jsonMatch) {
            reject(new Error('No JSON found in external folder digest output'));
            return;
          }
          resolve(JSON.parse(jsonMatch[0]) as RawDigest);
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });

      proc.on('error', (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(err);
        }
      });

      proc.stdin?.write(prompt, 'utf-8');
      proc.stdin?.end();
    });
  }

  private normalizeDigest(
    raw: RawDigest,
    folderPath: string,
    documents: ExternalWorkDocument[],
    skippedFiles: number,
  ): ExternalWorkDigest {
    const folderName = path.basename(folderPath);
    const sourceFiles = new Set(documents.map(d => d.relativePath));
    const rawState = raw.currentState ?? {};
    const stations = this.normalizeStations(raw.stations, sourceFiles);
    const openQuestions = this.stringArray(rawState.openQuestions).slice(0, 8);

    return {
      folderPath: this.normalizePath(folderPath),
      folderName,
      documents,
      skippedFiles,
      totalBytes: documents.reduce((sum, d) => sum + d.sizeBytes, 0),
      label: this.cleanLabel(this.stringValue(raw.label, folderName)),
      goal: this.stringValue(raw.goal, `Digest external work documented in ${folderName}.`).slice(0, 240),
      type: this.workstreamType(raw.type),
      status: this.workstreamStatus(raw.status),
      confidence: this.score(raw.confidence, 0.65),
      confidenceReasons: this.stringArray(raw.confidenceReasons).slice(0, 5),
      currentState: {
        phase: this.phase(rawState.phase),
        summary: this.stringValue(rawState.summary, `Imported ${documents.length} external document${documents.length === 1 ? '' : 's'} from ${folderName}.`).slice(0, 800),
        lastMeaningfulProgress: this.stringValue(rawState.lastMeaningfulProgress, documents[0]?.relativePath ?? folderName).slice(0, 400),
        nextLikelyAction: this.stringValue(rawState.nextLikelyAction, openQuestions[0] ? `Resolve: ${openQuestions[0]}` : 'Review imported external work and decide the next project action.').slice(0, 400),
        openQuestions,
        blockers: this.normalizeBlockers(rawState.blockers),
        pendingDecisions: this.normalizePendingDecisions(rawState.pendingDecisions),
      },
      stations: stations.length > 0 ? stations : this.fallbackStations(documents),
    };
  }

  private normalizeStations(rawStations: unknown, sourceFiles: Set<string>): ExternalWorkDigestStation[] {
    if (!Array.isArray(rawStations)) {
      return [];
    }

    return rawStations.slice(0, MAX_STATIONS).map((raw): ExternalWorkDigestStation | null => {
      if (!raw || typeof raw !== 'object') {
        return null;
      }
      const item = raw as Record<string, unknown>;
      const relativeSources = this.stringArray(item.sourceFilePaths)
        .filter(p => sourceFiles.has(p))
        .slice(0, 5);

      return {
        type: this.stationType(item.type),
        status: this.stationStatus(item.status),
        label: this.cleanLabel(this.stringValue(item.label, 'External work event'), 60),
        description: this.stringValue(item.description, '').slice(0, 500),
        whyItMatters: this.stringValue(item.whyItMatters, '').slice(0, 300),
        importanceScore: this.score(item.importanceScore, 0.55),
        attentionScore: this.score(item.attentionScore, 0.2),
        confidence: this.score(item.confidence, 0.6),
        sourceFilePaths: relativeSources,
        evidenceText: this.stringValue(item.evidenceText, '').slice(0, 260),
      };
    }).filter((station): station is ExternalWorkDigestStation => station !== null);
  }

  private buildHeuristicDigest(folderPath: string, documents: ExternalWorkDocument[], skippedFiles: number): ExternalWorkDigest {
    const folderName = path.basename(folderPath);
    return {
      folderPath: this.normalizePath(folderPath),
      folderName,
      documents,
      skippedFiles,
      totalBytes: documents.reduce((sum, d) => sum + d.sizeBytes, 0),
      label: this.cleanLabel(folderName || 'External Work'),
      goal: `Digest external work documented in ${folderName || 'the selected folder'}.`,
      type: 'research',
      status: 'planning',
      confidence: 0.45,
      confidenceReasons: ['AI digest was unavailable; fallback used folder and document metadata.'],
      currentState: {
        phase: 'planning',
        summary: `Imported ${documents.length} external document${documents.length === 1 ? '' : 's'} from ${folderName}.`,
        lastMeaningfulProgress: documents[0]?.relativePath ?? folderName,
        nextLikelyAction: 'Review imported documents and refine the workstream manually if needed.',
        openQuestions: [],
        blockers: [],
        pendingDecisions: [],
      },
      stations: this.fallbackStations(documents),
    };
  }

  private fallbackStations(documents: ExternalWorkDocument[]): ExternalWorkDigestStation[] {
    return documents.slice(0, Math.min(MAX_STATIONS, 5)).map((doc) => ({
      type: 'plan_step',
      status: 'completed',
      label: this.cleanLabel(doc.relativePath.split('/').pop() ?? doc.relativePath, 60),
      description: `Imported external document ${doc.relativePath}.`,
      whyItMatters: 'This document is part of the explicitly imported external work evidence.',
      importanceScore: 0.45,
      attentionScore: 0.1,
      confidence: 0.45,
      sourceFilePaths: [doc.relativePath],
      evidenceText: doc.text.slice(0, 220),
    }));
  }

  private normalizeBlockers(raw: unknown): Array<{ label: string; description: string; severity: 'low' | 'medium' | 'high' }> {
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw.slice(0, 6).map((item) => {
      const value = item && typeof item === 'object' ? item as Record<string, unknown> : {};
      return {
        label: this.cleanLabel(this.stringValue(value.label, 'External blocker'), 80),
        description: this.stringValue(value.description, '').slice(0, 300),
        severity: this.severity(value.severity),
      };
    });
  }

  private normalizePendingDecisions(raw: unknown): Array<{ label: string; options?: string[] }> {
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw.slice(0, 8).map((item) => {
      const value = item && typeof item === 'object' ? item as Record<string, unknown> : {};
      const options = this.stringArray(value.options).slice(0, 6);
      return {
        label: this.cleanLabel(this.stringValue(value.label, 'Pending decision'), 100),
        options: options.length > 0 ? options : undefined,
      };
    });
  }

  private stringValue(value: unknown, fallback: string): string {
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
  }

  private stringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(s => s.trim());
  }

  private score(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.max(0, Math.min(1, value))
      : fallback;
  }

  private cleanLabel(label: string, max = 50): string {
    const cleaned = label.replace(/\s+/g, ' ').trim();
    return cleaned.length > max ? `${cleaned.slice(0, max - 3)}...` : cleaned;
  }

  private workstreamType(value: unknown): WorkstreamType {
    const allowed: WorkstreamType[] = ['feature', 'bug_fix', 'research', 'refactor', 'infrastructure', 'experiment', 'abandoned_experiment', 'uncategorized'];
    return allowed.includes(value as WorkstreamType) ? value as WorkstreamType : 'research';
  }

  private workstreamStatus(value: unknown): WorkstreamStatus {
    const allowed: WorkstreamStatus[] = ['active', 'completed', 'blocked', 'uncertain', 'research', 'abandoned', 'planning'];
    return allowed.includes(value as WorkstreamStatus) ? value as WorkstreamStatus : 'planning';
  }

  private stationType(value: unknown): StationType {
    const allowed: StationType[] = ['session', 'decision', 'code_change', 'problem', 'milestone', 'failure', 'uncertainty', 'blocker', 'direction_change', 'merge_point', 'split_point', 'plan_step'];
    return allowed.includes(value as StationType) ? value as StationType : 'plan_step';
  }

  private stationStatus(value: unknown): StationStatus {
    const allowed: StationStatus[] = ['completed', 'partial', 'failed', 'pending', 'skipped'];
    return allowed.includes(value as StationStatus) ? value as StationStatus : 'completed';
  }

  private phase(value: unknown): WorkstreamCurrentState['phase'] {
    const allowed: Array<WorkstreamCurrentState['phase']> = ['not_started', 'planning', 'implementation', 'debugging', 'testing', 'review', 'blocked', 'complete', 'abandoned', 'unknown'];
    return allowed.includes(value as WorkstreamCurrentState['phase']) ? value as WorkstreamCurrentState['phase'] : 'planning';
  }

  private severity(value: unknown): 'low' | 'medium' | 'high' {
    return value === 'low' || value === 'medium' || value === 'high' ? value : 'medium';
  }

  private normalizePath(filePath: string): string {
    return filePath.replace(/\\/g, '/');
  }
}
