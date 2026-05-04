import { spawn } from 'child_process';
import type {
  EnrichedSessionData,
  StationExtractionOutput,
  Workstream,
} from '../types/workstreamTypes';

const MAX_STATIONS_PER_SESSION = 5;

export class StationExtractor {
  constructor(private readonly log: (msg: string) => void = () => {}) {}

  async extractStations(
    session: EnrichedSessionData,
    workstream: Workstream,
    cliPath: string,
    workspacePath: string,
  ): Promise<StationExtractionOutput> {
    const prompt = this.buildExtractionPrompt(session, workstream);
    return await this.callSonnet(prompt, cliPath, workspacePath);
  }

  async extractBatch(
    sessions: EnrichedSessionData[],
    workstreams: Map<string, Workstream>,
    cliPath: string,
    workspacePath: string,
  ): Promise<Map<string, StationExtractionOutput>> {
    const results = new Map<string, StationExtractionOutput>();

    this.log(`[StationExtractor] extractBatch: ${sessions.length} sessions, ${workstreams.size} workstreams`);
    for (const session of sessions) {
      const ws = [...workstreams.values()].find(w => w.sessionIds.includes(session.sessionId));
      if (!ws) {
        this.log(`[StationExtractor] Session ${session.sessionId.slice(0, 8)} has no matching workstream, skipping`);
        continue;
      }

      try {
        this.log(`[StationExtractor] Extracting session ${session.sessionId.slice(0, 8)} (ws="${ws.label}")`);
        const output = await this.extractStations(session, ws, cliPath, workspacePath);
        output.stations = output.stations.slice(0, MAX_STATIONS_PER_SESSION);
        this.log(`[StationExtractor] Session ${session.sessionId.slice(0, 8)}: ${output.stations.length} stations extracted`);
        results.set(session.sessionId, output);
      } catch (err) {
        this.log(`[StationExtractor] Session ${session.sessionId.slice(0, 8)} FAILED: ${err instanceof Error ? err.message : String(err)}`);
        results.set(session.sessionId, { stations: [] });
      }
    }

    return results;
  }

  private buildExtractionPrompt(session: EnrichedSessionData, workstream: Workstream): string {
    return `You are a session event extractor for a project work visualization.

Extract the most important events from this coding session as "stations" for a subway-style map.

Session:
- First prompt: ${session.firstPrompt?.slice(0, 300) ?? 'unknown'}
- Summary: ${session.summary?.slice(0, 500) ?? 'unknown'}
- Task outcome: ${session.outcome ?? 'unknown'}
- Files modified: ${(session.filesModified ?? []).slice(0, 15).join(', ')}
- Total turns: ${session.totalTurns ?? 'unknown'}
- Git branch: ${session.gitBranch ?? 'unknown'}

Workstream context:
- Label: ${workstream.label}
- Goal: ${workstream.goal}
- Current status: ${workstream.status}

Rules:
- Extract between 1 and ${MAX_STATIONS_PER_SESSION} stations
- Prefer fewer stations when the session is repetitive
- Always include: failures that affect current state, blockers, decisions that shape implementation, meaningful plan changes
- Collapse repetitive debugging into one station
- Collapse small edits supporting the same goal into one code_change station
- Mark low confidence stations as uncertain

Respond with ONLY valid JSON:
{
  "stations": [{
    "type": "session|decision|code_change|problem|milestone|failure|uncertainty|blocker|direction_change|merge_point|split_point|plan_step",
    "label": "string (max 60 chars, human-readable)",
    "description": "string (1-2 sentences)",
    "whyItMatters": "string (why this event matters for the workstream)",
    "status": "completed|partial|failed|pending|skipped",
    "importanceScore": 0.0-1.0,
    "attentionScore": 0.0-1.0,
    "evidence": [{
      "kind": "session_summary|tool_use|file_change|test_result|user_message|assistant_message",
      "sessionId": "${session.sessionId}",
      "text": "string (brief evidence excerpt)"
    }],
    "confidence": 0.0-1.0
  }]
}`;
  }

  private async callSonnet(prompt: string, cliPath: string, workspacePath: string): Promise<StationExtractionOutput> {
    return new Promise((resolve, reject) => {
      const args = ['-p', '--output-format', 'json', '--model', 'claude-sonnet-4-6'];
      this.log(`[StationExtractor] Spawning CLI: path="${cliPath}", promptLen=${prompt.length}, cwd="${workspacePath}"`);

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
          this.log(`[StationExtractor] TIMEOUT after 45s`);
          reject(new Error('Station extraction timed out after 45s'));
        }
      }, 45_000);

      proc.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
      proc.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.log(`[StationExtractor] Process closed: exitCode=${code}, stdoutLen=${stdout.length}, stderrLen=${stderr.length}`);
        if (stderr.length > 0) {
          this.log(`[StationExtractor] stderr: ${stderr.slice(-300)}`);
        }
        if (code !== 0) {
          reject(new Error(`Station extraction failed (exit ${code}): ${stderr}`));
          return;
        }
        try {
          let textToSearch = stdout;
          try {
            const envelope = JSON.parse(stdout);
            if (envelope?.result && typeof envelope.result === 'string') {
              textToSearch = envelope.result;
              this.log(`[StationExtractor] Unwrapped CLI envelope, result length=${textToSearch.length}`);
            }
          } catch { /* not an envelope */ }

          const jsonMatch = textToSearch.match(/\{[\s\S]*\}/);
          if (!jsonMatch) {
            this.log(`[StationExtractor] No JSON in text`);
            resolve({ stations: [] });
            return;
          }
          const parsed = JSON.parse(jsonMatch[0]) as StationExtractionOutput;
          if (!parsed.stations || !Array.isArray(parsed.stations)) {
            this.log(`[StationExtractor] No stations array in parsed JSON`);
            resolve({ stations: [] });
            return;
          }
          this.log(`[StationExtractor] Parsed OK: ${parsed.stations.length} stations`);
          resolve(parsed);
        } catch (e) {
          this.log(`[StationExtractor] JSON parse error: ${e}`);
          resolve({ stations: [] });
        }
      });

      proc.on('error', (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          this.log(`[StationExtractor] Process error: ${err.message}`);
          reject(err);
        }
      });

      proc.stdin?.write(prompt, 'utf-8');
      proc.stdin?.end();
    });
  }
}
