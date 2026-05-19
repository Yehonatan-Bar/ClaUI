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
import { GitCommitIngestor } from './GitCommitIngestor';
import { UserPortfolioManager } from './UserPortfolioManager';
import { ExternalWorkFolderIngestor } from './ExternalWorkFolderIngestor';
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
  private readonly gitIngestor: GitCommitIngestor;
  private readonly externalIngestor: ExternalWorkFolderIngestor;
  private portfolioManager: UserPortfolioManager | null = null;

  private progressCallback?: (progress: number, phase: string) => void;

  constructor(
    private readonly workspaceState: vscode.Memento,
    private readonly log: OutputChannel,
    private readonly getCliPath: () => string,
    private readonly getWorkspacePath: () => string,
  ) {
    const logFn = (msg: string) => this.log.appendLine(`[WorkstreamMap] ${msg}`);
    this.store = new WorkstreamStore(workspaceState);
    this.snapshotStore = new WorkstreamSnapshotStore(workspaceState);
    this.classifier = new WorkstreamClassifier(logFn);
    this.stationExtractor = new StationExtractor(logFn);
    this.currentStateSynthesizer = new CurrentStateSynthesizer(logFn);
    this.resumeStateBuilder = new ResumeStateBuilder(this.snapshotStore);
    this.planAnalyzer = new PlanRealityAnalyzer();
    this.nlEditor = new WorkstreamNLEditor();
    this.scorer = new WorkstreamImportanceScorer();
    this.backfiller = new SessionBackfiller();
    this.gitIngestor = new GitCommitIngestor(logFn);
    this.externalIngestor = new ExternalWorkFolderIngestor(logFn);
  }

  setPortfolioManager(manager: UserPortfolioManager): void {
    this.portfolioManager = manager;
  }

  getPortfolioManager(): UserPortfolioManager | null {
    return this.portfolioManager;
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
    allSessionSummaries?: SessionSummary[],
  ): Promise<ProjectMapState> {
    const cliPath = this.getCliPath();
    const workspacePath = this.getWorkspacePath();
    const existingState = this.store.getProjectMapState(projectId);

    this.log.appendLine(`[WorkstreamMap] classifyProject START: projectId="${projectId}", cliPath="${cliPath}", workspacePath="${workspacePath}"`);
    this.log.appendLine(`[WorkstreamMap] Input: ${sessionSummaries.length} summaries, ${sessionMetadataMap.size} metadata entries, existingState=${!!existingState}`);

    this.reportProgress(0.05, 'Enriching session data...');

    // Phase 1: Enrich sessions
    const enrichedSessions = this.backfiller.enrichMultiple(sessionSummaries, sessionMetadataMap);
    const adequateSessions = enrichedSessions.filter(s => this.backfiller.isAdequatelyEnriched(s));

    this.log.appendLine(`[WorkstreamMap] Enrichment: ${enrichedSessions.length} enriched, ${adequateSessions.length} adequate`);
    if (adequateSessions.length < enrichedSessions.length) {
      const rejected = enrichedSessions.filter(s => !this.backfiller.isAdequatelyEnriched(s));
      for (const r of rejected.slice(0, 5)) {
        this.log.appendLine(`[WorkstreamMap]   Rejected session ${r.sessionId.slice(0, 8)}: firstPrompt=${!!r.firstPrompt}, summary=${!!r.summary}, startedAt=${!!r.startedAt}`);
      }
    }

    // Phase 2: Ingest orphan git commits as synthetic sessions
    this.reportProgress(0.10, 'Scanning git history...');
    const knownCommitHashes = new Set<string>();
    const sessionTimeWindows: Array<{ start: number; end: number }> = [];
    for (const s of (allSessionSummaries ?? sessionSummaries)) {
      if (s.gitCommit) { knownCommitHashes.add(s.gitCommit); }
      const start = s.startedAt ? new Date(s.startedAt).getTime() : 0;
      const end = s.endedAt ? new Date(s.endedAt).getTime() : 0;
      if (start > 0 && end > 0) {
        sessionTimeWindows.push({ start, end });
      }
    }

    let gitSessions: import('../types/workstreamTypes').EnrichedSessionData[] = [];
    try {
      gitSessions = this.gitIngestor.ingest(workspacePath, knownCommitHashes, sessionTimeWindows);
      this.log.appendLine(`[WorkstreamMap] Git ingestion: ${gitSessions.length} synthetic sessions from orphan commits`);
    } catch (e) {
      this.log.appendLine(`[WorkstreamMap] Git ingestion failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`);
    }

    const allAdequateSessions = [...adequateSessions, ...gitSessions];

    if (allAdequateSessions.length === 0) {
      this.log.appendLine('[WorkstreamMap] No adequately enriched sessions for classification');
      return this.createEmptyState(projectId, workspacePath);
    }

    this.reportProgress(0.15, 'Classifying workstreams...');

    // Phase 3: Classify
    let classificationOutput;
    try {
      classificationOutput = await this.classifier.classify(
        allAdequateSessions, existingState, { ...options, force: options.force ?? !existingState }, cliPath, workspacePath
      );
    } catch (e) {
      this.log.appendLine(`[WorkstreamMap] Classification FAILED: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
      if (existingState) { return existingState; }
      return this.createEmptyState(projectId, workspacePath);
    }

    this.log.appendLine(`[WorkstreamMap] Classification output: ${classificationOutput.workstreams.length} workstreams`);
    for (const cw of classificationOutput.workstreams) {
      this.log.appendLine(`[WorkstreamMap]   ws="${cw.label}" type=${cw.type} status=${cw.status} sessions=${cw.sessionIds.length} confidence=${cw.confidence}`);
    }

    this.reportProgress(0.40, 'Building workstream model...');

    // Build workstreams from classification output
    const now = new Date().toISOString();
    const workstreams: Workstream[] = classificationOutput.workstreams.map((cw, idx) => {
      const existing = existingState?.workstreams.find(w => w.id === cw.id);
      const wsId = cw.id ?? existing?.id ?? crypto.randomUUID();

      const sessionData = allAdequateSessions.filter(s => cw.sessionIds.includes(s.sessionId));
      const allFiles = sessionData.flatMap(s => s.filesModified ?? []);
      const allReadFiles = sessionData.flatMap(s => s.filesRead ?? []);

      const ws: Workstream = {
        id: wsId,
        projectId,
        label: cw.label.replace(/\bultrathink\b\s*/gi, '').trim(),
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
        allAdequateSessions, wsMap, cliPath, workspacePath,
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
            timestamp: allAdequateSessions.find(s => s.sessionId === sessionId)?.startedAt ?? now,
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

    const externalWorkstreams = existingState?.workstreams.filter(ws => ws.source === 'external_folder') ?? [];
    const externalWorkstreamIds = new Set(externalWorkstreams.map(ws => ws.id));
    const externalStations = existingState?.stations.filter(station => externalWorkstreamIds.has(station.workstreamId)) ?? [];
    const preservedExternalWorkstreams = externalWorkstreams.map((ws, idx) => ({
      ...ws,
      order: workstreams.length + idx,
    }));
    if (preservedExternalWorkstreams.length > 0) {
      this.log.appendLine(`[WorkstreamMap] Preserving ${preservedExternalWorkstreams.length} external-folder workstreams across reclassification`);
    }
    const allWorkstreams = [...workstreams, ...preservedExternalWorkstreams];
    const allStations = [...stations, ...externalStations];

    this.reportProgress(0.75, 'Synthesizing current state...');

    // Build preliminary state for current state synthesis
    const mapState: ProjectMapState = {
      projectId,
      projectLabel: this.deriveProjectLabel(workspacePath),
      workspacePath,
      workstreams: allWorkstreams,
      stations: allStations,
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

    // Publish project summary to cross-project portfolio
    if (this.portfolioManager) {
      try {
        await this.portfolioManager.publishProjectSummary(projectId, finalState);
        this.log.appendLine(`[WorkstreamMap] Published project summary to portfolio`);
      } catch (e) {
        this.log.appendLine(`[WorkstreamMap] Portfolio publish failed: ${e}`);
      }
    }

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

  async ingestExternalFolder(projectId: string, folderPath: string): Promise<ProjectMapState> {
    const cliPath = this.getCliPath();
    const workspacePath = this.getWorkspacePath();

    this.log.appendLine(`[WorkstreamMap] ingestExternalFolder START: projectId="${projectId}", folderPath="${folderPath}"`);
    this.reportProgress(0.05, 'Reading external work folder...');

    const digest = await this.externalIngestor.ingest(folderPath, cliPath, workspacePath);

    this.reportProgress(0.65, 'Adding external workstream...');

    const now = new Date().toISOString();
    const existingState = this.store.getProjectMapState(projectId);
    const state = existingState ?? this.createEmptyState(projectId, workspacePath);
    const normalizedFolder = this.normalizePathForCompare(digest.folderPath);
    const existingWorkstream = state.workstreams.find(ws =>
      ws.source === 'external_folder' &&
      ws.sourceFolderPath &&
      this.normalizePathForCompare(ws.sourceFolderPath) === normalizedFolder
    );
    const workstreamId = existingWorkstream?.id ?? crypto.randomUUID();
    const sourceFilePaths = digest.documents.map(doc => doc.absolutePath);
    const relativeToAbsolute = new Map(digest.documents.map(doc => [doc.relativePath, doc.absolutePath]));

    const retainedStations = state.stations.filter(station => station.workstreamId !== workstreamId);
    const importedStations: Station[] = digest.stations.map((station, idx) => {
      const absoluteSourcePaths = station.sourceFilePaths
        .map(filePath => relativeToAbsolute.get(filePath) ?? filePath)
        .map(filePath => filePath.replace(/\\/g, '/'));
      const stationId = crypto.randomUUID();

      return {
        id: stationId,
        projectId,
        workstreamId,
        type: station.type,
        status: station.status,
        label: station.label,
        description: station.description,
        whyItMatters: station.whyItMatters,
        sourceFilePaths: absoluteSourcePaths,
        order: retainedStations.length + idx,
        timestamp: this.latestDate(
          station.sourceFilePaths
            .map(filePath => digest.documents.find(doc => doc.relativePath === filePath)?.modifiedAt)
            .filter(Boolean) as string[]
        ) ?? now,
        importanceScore: station.importanceScore,
        attentionScore: station.attentionScore,
        visibleInProjectMap: this.scorer.shouldShowInProjectMap({
          importanceScore: station.importanceScore,
          type: station.type,
        } as Station),
        confidence: station.confidence,
        evidence: station.evidenceText
          ? [{
              kind: 'external_document',
              text: station.evidenceText,
              filePath: absoluteSourcePaths[0],
            }]
          : [],
        visual: {
          size: station.importanceScore > 0.7 ? 'large' : station.importanceScore > 0.4 ? 'medium' : 'small',
          glow: station.attentionScore > 0.5 ? 'attention' : 'none',
          labelVisible: station.importanceScore > 0.6,
        },
      };
    });

    const blockers = digest.currentState.blockers.map(blocker => ({
      id: crypto.randomUUID(),
      label: blocker.label,
      description: blocker.description,
      severity: blocker.severity,
      createdAt: now,
    }));
    const pendingDecisions = digest.currentState.pendingDecisions.map(decision => ({
      id: crypto.randomUUID(),
      label: decision.label,
      options: decision.options,
      createdAt: now,
    }));

    const importedWorkstream: Workstream = {
      id: workstreamId,
      projectId,
      label: digest.label,
      goal: digest.goal,
      type: digest.type,
      status: digest.status,
      sessionIds: [],
      source: 'external_folder',
      sourceFolderPath: digest.folderPath,
      sourceFilePaths,
      sourceImportedAt: now,
      sourceDocumentCount: digest.documents.length,
      sourceTotalBytes: digest.totalBytes,
      relatedWorkstreamIds: existingWorkstream?.relatedWorkstreamIds ?? [],
      parentWorkstreamId: existingWorkstream?.parentWorkstreamId,
      childWorkstreamIds: existingWorkstream?.childWorkstreamIds ?? [],
      mergedIntoWorkstreamId: existingWorkstream?.mergedIntoWorkstreamId,
      confidence: digest.confidence,
      confidenceReasons: digest.confidenceReasons.length > 0
        ? digest.confidenceReasons
        : [`Imported ${digest.documents.length} external document${digest.documents.length === 1 ? '' : 's'}`],
      autoGenerated: true,
      userPinned: existingWorkstream?.userPinned ?? false,
      importanceScore: 0,
      attentionScore: 0,
      currentState: {
        phase: digest.currentState.phase,
        summary: digest.currentState.summary,
        lastMeaningfulProgress: digest.currentState.lastMeaningfulProgress,
        nextLikelyAction: digest.currentState.nextLikelyAction,
        openQuestions: digest.currentState.openQuestions,
        blockers,
        pendingDecisions,
        evidenceSessionIds: [],
        evidenceStationIds: importedStations.map(station => station.id),
        generatedBy: 'sonnet',
        generatedAt: now,
      },
      startedAt: this.earliestDate(digest.documents.map(doc => doc.modifiedAt)) ?? now,
      lastActivityAt: this.latestDate(digest.documents.map(doc => doc.modifiedAt)) ?? now,
      completedAt: digest.status === 'completed' ? now : undefined,
      lastViewedAt: existingWorkstream?.lastViewedAt,
      planId: existingWorkstream?.planId,
      planReality: existingWorkstream?.planReality,
      metrics: {
        totalSessions: 0,
        totalTurns: 0,
        totalCostUsd: 0,
        filesModified: [],
        filesRead: sourceFilePaths,
        failureCount: importedStations.filter(station => station.status === 'failed').length,
        blockerCount: blockers.length + importedStations.filter(station => station.type === 'blocker').length,
        decisionCount: pendingDecisions.length + importedStations.filter(station => station.type === 'decision').length,
      },
      visual: {
        ...this.computeVisualState(digest.status, digest.confidence, 0.6, existingWorkstream?.order ?? state.workstreams.length, existingWorkstream),
        texture: 'dashed',
      },
      order: existingWorkstream?.order ?? state.workstreams.length,
    };

    importedWorkstream.importanceScore = this.scorer.scoreWorkstream(importedWorkstream);
    importedWorkstream.attentionScore = this.scorer.scoreAttention(importedWorkstream);
    importedWorkstream.visual.thickness = importedWorkstream.importanceScore > 0.7 ? 3 : importedWorkstream.importanceScore > 0.4 ? 2 : 1;
    importedWorkstream.visual.needsAttention = importedWorkstream.status === 'blocked' || importedWorkstream.currentState.blockers.length > 0;

    state.workstreams = [
      ...state.workstreams.filter(ws => ws.id !== workstreamId),
      importedWorkstream,
    ];
    state.stations = [...retainedStations, ...importedStations];
    state.lastClassifiedAt = now;
    this.refreshProjectCurrentStateFromWorkstreams(state, importedWorkstream, now);

    const finalState = this.store.enforceCapLimits(state);
    await this.store.saveProjectMapState(finalState);
    await this.snapshotStore.captureSnapshot(finalState);

    if (this.portfolioManager) {
      try {
        await this.portfolioManager.publishProjectSummary(projectId, finalState);
        this.log.appendLine('[WorkstreamMap] Published external work summary to portfolio');
      } catch (e) {
        this.log.appendLine(`[WorkstreamMap] Portfolio publish after external ingest failed: ${e}`);
      }
    }

    this.reportProgress(1.0, 'External work imported');
    this.log.appendLine(`[WorkstreamMap] ingestExternalFolder COMPLETE: ws="${importedWorkstream.label}", docs=${digest.documents.length}, stations=${importedStations.length}`);
    return finalState;
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

  private refreshProjectCurrentStateFromWorkstreams(
    state: ProjectMapState,
    latestWorkstream: Workstream,
    now: string,
  ): void {
    state.currentState.activeWorkstreamIds = state.workstreams
      .filter(ws => ws.status === 'active')
      .map(ws => ws.id);
    state.currentState.blockedWorkstreamIds = state.workstreams
      .filter(ws => ws.status === 'blocked' || ws.currentState.blockers.some(blocker => !blocker.resolvedAt))
      .map(ws => ws.id);
    state.currentState.completedWorkstreamIds = state.workstreams
      .filter(ws => ws.status === 'completed')
      .map(ws => ws.id);
    state.currentState.uncertainWorkstreamIds = state.workstreams
      .filter(ws => ws.status === 'uncertain' || ws.confidence < 0.5)
      .map(ws => ws.id);

    state.currentState.blockers = state.workstreams.flatMap(ws => ws.currentState.blockers.filter(blocker => !blocker.resolvedAt));
    state.currentState.openQuestions = [
      ...new Set(state.workstreams.flatMap(ws => ws.currentState.openQuestions)),
    ].slice(0, 12);

    const recommended = this.scorer.recommendResumeWorkstream(state.workstreams);
    state.currentState.recommendedResumeWorkstreamId = recommended ?? latestWorkstream.id;
    state.currentState.recommendedNextAction = latestWorkstream.currentState.nextLikelyAction || state.currentState.recommendedNextAction;

    if (!state.currentState.summary || state.currentState.summary === 'No workstreams classified yet.') {
      state.currentState.summary = latestWorkstream.currentState.summary;
    }

    state.currentState.generatedAt = now;
    state.currentState.generatedBy = 'local_heuristic';
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

  private normalizePathForCompare(filePath: string): string {
    return filePath.replace(/\\/g, '/').toLowerCase();
  }

  private reportProgress(progress: number, phase: string): void {
    this.progressCallback?.(progress, phase);
  }
}
