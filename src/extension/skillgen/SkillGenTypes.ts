/**
 * Extension-internal types for the Auto Skill Generation feature.
 * Webview-facing types (SkillGenRunStatus, SkillGenRunHistoryEntry, message types) live in webview-messages.ts.
 */

/** Pipeline integration mode - which Python entry point to use */
export type SkillGenIntegrationMode = 'run_pipeline' | 'python_api' | 'create_skills';

/** Result of a deduplication check for a single candidate skill */
export type DeduplicationDecision = 'new' | 'upgrade' | 'skip';

export interface DeduplicationResult {
  candidateName: string;
  decision: DeduplicationDecision;
  existingSkillPath?: string;
  reason: string;
}

/** Settings read from VS Code configuration (claudeMirror.skillGen.*) */
export interface SkillGenConfig {
  enabled: boolean;
  threshold: number;
  documentsFolder: string;
  documentsGlob: string;
  skillsFolder: string;
  pythonPath: string;
  toolkitPath: string;
  workspaceFolder: string;
  integrationMode: SkillGenIntegrationMode;
  resumeOnFailure: boolean;
  timeoutMs: number;
  autoRun: boolean;
  aiDeduplication: boolean;
}
