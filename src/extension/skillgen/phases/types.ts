import type { SkillGenRunStatus } from '../../types/webview-messages';

/** All pipeline phase identifiers */
export enum PhaseId {
  B = 'B',
  C0_C1 = 'C.0-C.1',
  C2 = 'C.2',
  C3 = 'C.3',
  C4 = 'C.4',
  C5 = 'C.5',
  SANITY = 'sanity',
  D = 'D',
}

/** Result of running a single phase */
export interface PhaseResult {
  success: boolean;
  error?: string;
  durationMs: number;
}

/** Callback for reporting progress from a phase */
export type PhaseProgressCallback = (phaseId: PhaseId, progress: number, label: string) => void;

/** Progress mapping: each phase gets a progress range within 0-100 */
export const PHASE_PROGRESS_RANGES: Record<PhaseId, { start: number; end: number }> = {
  [PhaseId.B]: { start: 5, end: 15 },
  [PhaseId.C0_C1]: { start: 15, end: 25 },
  [PhaseId.C2]: { start: 25, end: 40 },
  [PhaseId.C3]: { start: 40, end: 55 },
  [PhaseId.C4]: { start: 55, end: 65 },
  [PhaseId.C5]: { start: 65, end: 70 },
  [PhaseId.SANITY]: { start: 70, end: 72 },
  [PhaseId.D]: { start: 72, end: 95 },
};

/** Pipeline progress checkpoint format (matches Python's .pipeline_progress.json) */
export interface PipelineProgress {
  [phaseId: string]: {
    status: 'SUCCESS' | 'FAILED';
    timestamp: string;
  };
  last_phase?: string;
  last_status?: string;
}

/** Pipeline workspace directory layout */
export interface WorkspacePaths {
  workspaceDir: string;
  srptdRawDir: string;
  extractionsDir: string;
  clustersDir: string;
  skillsOutDir: string;
  logsDir: string;
}

/** Pipeline progress update for the webview */
export interface PipelineProgressUpdate {
  status: SkillGenRunStatus;
  progress: number;       // 0-100
  progressLabel: string;
}

/** Full pipeline run result */
export interface PipelineRunResult {
  success: boolean;
  skillsOutputDir: string;
  durationMs: number;
  error?: string;
}
