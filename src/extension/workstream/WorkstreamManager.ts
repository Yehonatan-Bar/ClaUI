import * as vscode from 'vscode';
import * as crypto from 'crypto';
import type { OutputChannel } from 'vscode';
import type {
  ClassificationOptions,
  EnrichedSessionData,
  MapInteractionContext,
  ProjectCurrentState,
  ProjectMapState,
  ResumeState,
  Station,
  UserEdit,
  Workstream,
  WorkstreamCurrentState,
  WorkstreamVisualState,
  CURRENT_SCHEMA_VERSION,
} from '../types/workstreamTypes';
import type { SessionSummary } from '../types/webview-messages';
import type { SessionMetadata } from '../session/SessionStore';
import { WorkstreamStore } from './WorkstreamStore';
import { WorkstreamSnapshotStore } from './WorkstreamSnapshotStore';
import { WorkstreamClassifier } from './WorkstreamClassifier';
import { StationExtractor } from './StationExtractor';
import { CurrentStateSynthesizer } from './CurrentStateSynthesizer';
import { ResumeStateBuilder } from './ResumeStateBuilder';
import { PlanRealityAnalyzer } from './PlanRealityAnalyzer';
import { WorkstreamNLEditor } from './WorkstreamNLEditor';
import { WorkstreamImportanceScorer } from './WorkstreamImportanceScorer';
import { SessionBackfiller } from './SessionBackfiller';
import { WORKSTREAM_STATUS_COLORS } from '../types/workstreamTypes';

export class WorkstreamManager {
  private readonly store: WorkstreamStore;
  private readonly snapshotStore: WorkstreamSnapshotStore;
  private readonly classifier: WorkstreamClassifier;
  private readonly stationExtractor: StationExtractor;
  private readonly currentStateSynthesizer: CurrentStateSynthesizer;
  private readonly resumeStateBuilder: ResumeStateBuilder;
  private readonly planAnalyzer: PlanRealityAnalyzer;
  private readonly nlEditor: WorkstreamNLEditor;
  private readonly scorer: WorkstreamImportanceScorer;
  private readonly backfiller: SessionBackfiller;

  private progressCallback?: (progress: number, phase: string) => void;

  constructor(
    private readonly workspaceState: vscode.Memento,
    private readonly log: OutputChannel,
    private readonly getCliPath: () => string,
    private readonly getWorkspacePath: () => string,
  ) {
    this.store = new WorkstreamStore(workspaceState);
    this.snapshotStore = new WorkstreamSnapshotStore(workspaceState);
    this.classifier = new WorkstreamClassifier();
    this.stationExtractor = new StationExtractor();
    this.currentStateSynthesizer = new CurrentStateSynthesizer();
    this.resumeStateBuilder = new ResumeStateBuilder(this.snapshotStore);
    this.planAnalyzer = new PlanRealityAnalyzer();
    this.nlEditor = new WorkstreamNLEditor();
    this.scorer = new WorkstreamImportanceScorer();
    this.backfiller = new SessionBackfiller();
  }

  onProgress(callback: (progress: number, phase: string) => void): void {
    this.progressCallback = callback;
  }

  getProjectMapState(projectId: string): ProjectMapState | null {
    return this.store.getProjectMapState(projectId);
  }

  async classifyProject(
    projectId: string,
    sessionSummaries: SessionSummary[],
    sessionMetadataMap: Map<string, SessionMetadata>,
    options: ClassificationOptions = {},
  ): Promise<ProjectMapState> {
    const cliPath = this.getCliPath();
    const workspacePath = this.getWorkspacePath();
    const existingState = this.store.getProjectMapState(projectId);

    this.reportProgress(0.05, 'Enriching session data...');

    // Phase 1: Enrich sessions
    const enrichedSessions = this.backfiller.enrichMultiple(sessionSummaries, sessionMetadataMap);
    const adequateSessions = enrichedSessions.filter(s => this.backfiller.isAdequatelyEnriched(s));

    if (adequateSessions.length === 0) {
      this.log.appendLine('[WorkstreamMap] No adequately enriched sessions for classification');
      return this.createEmptyState(projectId, workspacePath);
    }

    this.reportProgress(0.15, 'Classifying workstreams...');

    // Phase 3: Classify
    let classificationOutput;
    try {
      classificationOutput = await this.classifier.classify(
        adequateSessions, existingState, { ...options, force: options.force ?? !existingState }, cliPath, workspacePath
      );
    } catch (e) {
      this.log.appendLine(`[WorkstreamMap] Classification failed: ${e}`);
      if (existingState) { return existingState; }
      return this.createEmptyState(projectId, workspacePath);
    }

    this.reportProgress(0.40, 'Building workstream model...');

    // Build workstreams from classification output
    const now = new Date().toISOString();
    const workstreams: Workstream[] = classificationOutput.workstreams.map((cw, idx) => {
      const existing = existingState?.workstreams.find(w => w.id === cw.id);
      const wsId = cw.id ?? existing?.id ?? crypto.randomUUID();

      const sessionData = adequateSessions.filter(s => cw.sessionIds.includes(s.sessionId));
      const allFiles = sessionData.flatMap(s => s.filesModified ?? []);
      const allReadFiles = sessionData.flatMap(s => s.filesRead ?? []);

      const ws: Workstream = {
        id: wsId,
        projectId,
        label: cw.label,
        goal: cw.goal,
        type: cw.type,
        status: cw.status,
        sessionIds: cw.sessionIds,
        relatedWorkstreamIds: existing?.relatedWorkstreamIds ?? [],
        parentWorkstreamId: existing?.parentWorkstreamId,
        childWorkstreamIds: existing?.childWorkstreamIds ?? [],
        mergedIntoWorkstreamId: existing?.mergedIntoWorkstreamId,
        confidence: cw.confidence,
        confidenceReasons: cw.confidenceReasons,
        autoGenerated: true,
        userPinned: existing?.userPinned ?? false,
        importanceScore: cw.importanceScore,
        attentionScore: 0,
        currentState: {
          phase: cw.currentState.phase ?? 'unknown',
          summary: cw.currentState.summary ?? '',
          lastMeaningfulProgress: cw.currentState.lastMeaningfulProgress ?? '',
          nextLikelyAction: cw.currentState.nextLikelyAction ?? '',
          openQuestions: cw.currentState.openQuestions ?? [],
          blockers: cw.currentState.blockers ?? [],
          pendingDecisions: cw.currentState.pendingDecisions ?? [],
          evidenceSessionIds: cw.sessionIds,
          evidenceStationIds: [],
          generatedBy: 'sonnet',
          generatedAt: now,
        },
        startedAt: this.earliestDate(sessionData.map(s => s.startedAt).filter(Boolean) as string[]) ?? now,
        lastActivityAt: this.latestDate(sessionData.map(s => s.endedAt ?? s.startedAt).filter(Boolean) as string[]) ?? now,
        completedAt: cw.status === 'completed' ? now : undefined,
        lastViewedAt: existing?.lastViewedAt,
        planId: existing?.planId,
        planReality: existing?.planReality,
        metrics: {
          totalSessions: cw.sessionIds.length,
          totalTurns: sessionData.reduce((sum, s) => sum + (s.totalTurns ?? 0), 0),
          totalCostUsd: sessionData.reduce((sum, s) => sum + (s.totalCostUsd ?? 0), 0),
          filesModified: [...new Set(allFiles)],
          filesRead: [...new Set(allReadFiles)],
          failureCount: sessionData.filter(s => s.outcome === 'failed').length,
          blockerCount: 0,
          decisionCount: 0,
        },
        visual: this.computeVisualState(cw.status, cw.confidence, cw.importanceScore, idx, existing),
        order: idx,
      };

      ws.importanceScore = this.scorer.scoreWorkstream(ws);
      ws.attentionScore = this.scorer.scoreAttention(ws);

      return ws;
    });

    this.reportProgress(0.55, 'Extracting stations...');

    // Phase 4: Extract stations
    const wsMap = new Map<string, Workstream>();
    workstreams.forEach(ws => wsMap.set(ws.id, ws));

    let stations: Station[] = existingState?.stations ?? [];
    try {
      const extractionResults = await this.stationExtractor.extractBatch(
        adequateSessions, wsMap, cliPath, workspacePath,
      );

      const newStations: Station[] = [];
      for (const [sessionId, output] of extractionResults) {
        const ws = workstreams.find(w => w.sessionIds.includes(sessionId));
        if (!ws) { continue; }

        for (const extracted of output.stations) {
          const stationId = crypto.randomUUID();
          const station: Station = {
            id: stationId,
            projectId,
            workstreamId: ws.id,
            type: extracted.type,
            status: extracted.status,
            label: extracted.label,
            description: extracted.description,
            whyItMatters: extracted.whyItMatters,
            sessionId,
            order: newStations.length,
            timestamp: adequateSessions.find(s => s.sessionId === sessionId)?.startedAt ?? now,
            importanceScore: extracted.importanceScore,
            attentionScore: extracted.attentionScore,
            visibleInProjectMap: this.scorer.shouldShowInProjectMap({
              importanceScore: extracted.importanceScore,
              type: extracted.type,
            } as Station),
            confidence: extracted.confidence,
            evidence: extracted.evidence,
            visual: {
              size: extracted.importanceScore > 0.7 ? 'large' : extracted.importanceScore > 0.4 ? 'medium' : 'small',
              glow: extracted.attentionScore > 0.5 ? 'attention' : 'none',
              labelVisible: extracted.importanceScore > 0.6,
            },
          };
          newStations.push(station);
        }
      }

      stations = newStations;
    } catch (e) {
      this.log.appendLine(`[WorkstreamMap] Station extraction failed: ${e}`);
    }

    this.reportProgress(0.75, 'Synthesizing current state...');

    // Build preliminary state for current state synthesis
    const mapState: ProjectMapState = {
      projectId,
      projectLabel: this.deriveProjectLabel(workspacePath),
      workspacePath,
      workstreams,
      stations,
      splits: existingState?.splits ?? [],
      merges: existingState?.merges ?? [],
      currentState: existingState?.currentState ?? this.emptyProjectCurrentState(now),
      resumeState: existingState?.resumeState,
      lastClassifiedAt: now,
      lastOpenedAt: existingState?.lastOpenedAt,
      lastViewedSnapshotId: existingState?.lastViewedSnapshotId,
      userEdits: existingState?.userEdits ?? [],
      archivedWorkstreamIds: existingState?.archivedWorkstreamIds ?? [],
      modelRunLog: existingState?.modelRunLog ?? [],
      schemaVersion: 1,
    };

    // Phase 5: Synthesize current state
    try {
      const synthesis = await this.currentStateSynthesizer.synthesize(mapState, cliPath, workspacePath);
      mapState.currentState = synthesis.projectState;

      for (const [wsId, wsState] of synthesis.workstreamStates) {
        const ws = mapState.workstreams.find(w => w.id === wsId);
        if (ws) { ws.currentState = wsState; }
      }
    } catch (e) {
      this.log.appendLine(`[WorkstreamMap] Current state synthesis failed: ${e}`);
    }

    this.reportProgress(0.90, 'Saving and building resume state...');

    // Enforce limits and save
    const finalState = this.store.enforceCapLimits(mapState);
    await this.store.saveProjectMapState(finalState);

    // Capture snapshot for future resume comparison
    await this.snapshotStore.captureSnapshot(finalState);

    this.reportProgress(1.0, 'Complete');
    return finalState;
  }

  async classifyNewSession(
    projectId: string,
    sessionSummary: SessionSummary,
    metadata?: SessionMetadata,
  ): Promise<void> {
    const existingState = this.store.getProjectMapState(projectId);
    if (!existingState) { return; }

    const enriched = this.backfiller.enrichFromSummary(sessionSummary, metadata);
    if (!this.backfiller.isAdequatelyEnriched(enriched)) { return; }

    // Incremental: try to assign to existing workstream by heuristic
    const clusters = this.classifier.heuristicPreCluster([enriched]);
    if (clusters.length > 0) {
      const bestCluster = clusters[0];
      const matchingWs = existingState.workstreams.find(
        ws => ws.sessionIds.some(sid => bestCluster.sessionIds.includes(sid))
      );
      if (matchingWs && bestCluster.confidence > 0.5) {
        if (!matchingWs.sessionIds.includes(enriched.sessionId)) {
          matchingWs.sessionIds.push(enriched.sessionId);
          matchingWs.lastActivityAt = new Date().toISOString();
          matchingWs.metrics.totalSessions++;
          await this.store.saveProjectMapState(existingState);
          return;
        }
      }
    }

    // If no match, mark for full reclassification on next map open
    this.log.appendLine(`[WorkstreamMap] Session ${enriched.sessionId} needs full classification`);
  }

  async applyUserEdit(projectId: string, edit: UserEdit): Promise<ProjectMapState | null> {
    const state = this.store.getProjectMapState(projectId);
    if (!state) { return null; }

    state.userEdits.push(edit);
    this.applyEditToState(state, edit);
    await this.store.saveProjectMapState(state);
    return state;
  }

  async applyNaturalLanguageEdit(
    text: string,
    context: MapInteractionContext,
    projectId: string,
  ): Promise<{ state: ProjectMapState; result: import('../types/workstreamTypes').NLEditResult } | null> {
    const state = this.store.getProjectMapState(projectId);
    if (!state) { return null; }

    const cliPath = this.getCliPath();
    const workspacePath = this.getWorkspacePath();

    const result = await this.nlEditor.processCommand(text, context, state, cliPath, workspacePath);

    if (!result.requiresConfirmation) {
      for (const edit of result.edits) {
        state.userEdits.push(edit);
        this.applyEditToState(state, edit);
      }
      await this.store.saveProjectMapState(state);
    }

    return { state, result };
  }

  async buildResumeState(projectId: string): Promise<ResumeState | undefined> {
    const state = this.store.getProjectMapState(projectId);
    if (!state) { return undefined; }

    const cliPath = this.getCliPath();
    const workspacePath = this.getWorkspacePath();

    if (!this.resumeStateBuilder.shouldShowResumeView(state)) { return undefined; }

    return await this.resumeStateBuilder.buildResumeState(state, cliPath, workspacePath);
  }

  async markMapOpened(projectId: string): Promise<void> {
    const state = this.store.getProjectMapState(projectId);
    if (!state) { return; }

    state.lastOpenedAt = new Date().toISOString();
    await this.store.saveProjectMapState(state);
    await this.snapshotStore.captureSnapshot(state);
  }

  private applyEditToState(state: ProjectMapState, edit: UserEdit): void {
    const details = edit.details as Record<string, unknown>;

    switch (edit.type) {
      case 'mark_complete': {
        const ws = state.workstreams.find(w => w.id === details.workstreamId);
        if (ws) {
          ws.status = 'completed';
          ws.completedAt = new Date().toISOString();
          ws.visual.colorToken = WORKSTREAM_STATUS_COLORS.completed;
        }
        break;
      }
      case 'mark_abandoned': {
        const ws = state.workstreams.find(w => w.id === details.workstreamId);
        if (ws) {
          ws.status = 'abandoned';
          ws.visual.colorToken = WORKSTREAM_STATUS_COLORS.abandoned;
        }
        break;
      }
      case 'rename_workstream': {
        const ws = state.workstreams.find(w => w.id === details.workstreamId);
        if (ws && typeof details.newLabel === 'string') {
          ws.label = details.newLabel;
        }
        break;
      }
      case 'change_status': {
        const ws = state.workstreams.find(w => w.id === details.workstreamId);
        if (ws && typeof details.newStatus === 'string') {
          ws.status = details.newStatus as Workstream['status'];
          ws.visual.colorToken = WORKSTREAM_STATUS_COLORS[ws.status] ?? '#9CA3AF';
        }
        break;
      }
      case 'pin_workstream': {
        const ws = state.workstreams.find(w => w.id === details.workstreamId);
        if (ws) { ws.userPinned = true; }
        break;
      }
      case 'unpin_workstream': {
        const ws = state.workstreams.find(w => w.id === details.workstreamId);
        if (ws) { ws.userPinned = false; }
        break;
      }
      case 'move_session': {
        const fromWs = state.workstreams.find(w => w.id === details.fromWorkstreamId);
        const toWs = state.workstreams.find(w => w.id === details.toWorkstreamId);
        const sid = details.sessionId as string;
        if (fromWs && toWs && sid) {
          fromWs.sessionIds = fromWs.sessionIds.filter(id => id !== sid);
          if (!toWs.sessionIds.includes(sid)) {
            toWs.sessionIds.push(sid);
          }
        }
        break;
      }
      case 'hide_station': {
        const station = state.stations.find(s => s.id === details.stationId);
        if (station) { station.visibleInProjectMap = false; }
        break;
      }
      case 'reclassify_workstream': {
        const ws = state.workstreams.find(w => w.id === details.workstreamId);
        if (ws && typeof details.newType === 'string') {
          ws.type = details.newType as Workstream['type'];
        }
        break;
      }
    }
  }

  private computeVisualState(
    status: string,
    confidence: number,
    importance: number,
    order: number,
    existing?: Workstream,
  ): WorkstreamVisualState {
    const colorToken = WORKSTREAM_STATUS_COLORS[status as keyof typeof WORKSTREAM_STATUS_COLORS] ?? '#9CA3AF';

    return {
      colorToken,
      texture: confidence < 0.4 ? 'blurred' : confidence < 0.7 ? 'dashed' : 'solid',
      thickness: importance > 0.7 ? 3 : importance > 0.4 ? 2 : 1,
      opacity: status === 'abandoned' ? 0.4 : status === 'completed' ? 0.6 : 1.0,
      collapsed: existing?.visual.collapsed ?? false,
      highlighted: false,
      needsAttention: status === 'blocked',
      resumeRecommended: false,
    };
  }

  private createEmptyState(projectId: string, workspacePath: string): ProjectMapState {
    const now = new Date().toISOString();
    return {
      projectId,
      projectLabel: this.deriveProjectLabel(workspacePath),
      workspacePath,
      workstreams: [],
      stations: [],
      splits: [],
      merges: [],
      currentState: this.emptyProjectCurrentState(now),
      lastClassifiedAt: now,
      userEdits: [],
      archivedWorkstreamIds: [],
      modelRunLog: [],
      schemaVersion: 1,
    };
  }

  private emptyProjectCurrentState(now: string): ProjectCurrentState {
    return {
      summary: 'No workstreams classified yet.',
      activeWorkstreamIds: [],
      blockedWorkstreamIds: [],
      completedWorkstreamIds: [],
      uncertainWorkstreamIds: [],
      openQuestions: [],
      blockers: [],
      generatedAt: now,
      generatedBy: 'local_heuristic',
    };
  }

  private deriveProjectLabel(workspacePath: string): string {
    const parts = workspacePath.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] || 'Project';
  }

  private earliestDate(dates: string[]): string | undefined {
    if (dates.length === 0) { return undefined; }
    return dates.sort()[0];
  }

  private latestDate(dates: string[]): string | undefined {
    if (dates.length === 0) { return undefined; }
    return dates.sort().reverse()[0];
  }

  private reportProgress(progress: number, phase: string): void {
    this.progressCallback?.(progress, phase);
  }
}
