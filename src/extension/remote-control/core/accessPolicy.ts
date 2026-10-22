/**
 * Authorization policy for ClaUi Remote Control.
 *
 * Remote callers are trusted local processes of the same OS user (they hold
 * the token), but generic escape hatches (dispatch_ui_action,
 * execute_command, update_setting) must not silently reach credential, git,
 * security-policy, file-system or external-send features. Those are
 * 'sensitive' and need the opt-in setting
 * `claudeMirror.remoteControl.allowSensitiveActions`. 'blocked' is never
 * allowed remotely (e.g. webview lifecycle messages, reconfiguring remote
 * control itself).
 *
 * UI actions are an ALLOWLIST: every action type must be listed in exactly one
 * explicit set below; anything unlisted (e.g. a new UI action added later) is
 * treated as sensitive. A unit test fails when the generated UI catalog has an
 * action that is not classified here, forcing a conscious decision.
 */

export type ActionRisk = 'blocked' | 'sensitive' | 'query' | 'normal';

/** Webview lifecycle / telemetry messages that only the real chat UI may send. */
export const BLOCKED_UI_ACTIONS = new Set<string>([
  'ready',
  'uiDebugLog',
  'adventureDebugLog',
  'skillGenUiLog',
  'skillUsageReport',
]);

/** Read-style UI actions (allowed even in readOnly mode). */
export const QUERY_UI_ACTIONS = new Set<string>([
  'bugReportGetPreview',
  'chatSearchProject',
  'claudeAuthStatus',
  'fileSearch',
  'getAchievementsSnapshot',
  'getCommunityData',
  'getCouncilSettings',
  'getCustomSnippet',
  'getGitPushSettings',
  'getMergePreview',
  'getProjectAnalytics',
  'getPromptHistory',
  'getSkillGenStatus',
  'getTokenRatioData',
  'getWorktreeList',
  'listBranches',
  'mcpPreviewAddServer',
  'mcpRefresh',
  'particleAcceleratorGetStatus',
  'requestMemoryStream',
  'requestSessionRecapSnapshot',
  'requestTabList',
  'requestUsage',
  'secretProtectionGetAuditEvents',
  'secretProtectionGetComplianceReport',
  'secretProtectionGetStatus',
  'superParticleAcceleratorGetAuditEvents',
  'superParticleAcceleratorGetStatus',
  'whatsNewRequestState',
  'workspaceAccessGuardGetAllowedRoots',
  'workspaceAccessGuardGetAuditEvents',
  'workspaceAccessGuardGetOrgPolicyStatus',
  'workspaceAccessGuardGetStatus',
  'workspaceAccessGuardTestCommand',
  'workspaceAccessGuardTestPath',
  'workstreamMapRequestData',
  'workstreamPortfolioRequestData',
]);

/** Ordinary chat / UI features: allowed in full access mode. */
export const NORMAL_UI_ACTIONS = new Set<string>([
  // Conversation
  'cancelRequest',
  'cancelScheduledMessage',
  'clearSession',
  'codexConsult',
  'compact',
  'compactSession',
  'editAndResend',
  'enhancePrompt',
  'forkFromMessage',
  'forkSession',
  'planApprovalResponse',
  'queuePromptUntilUsageReset',
  'resumeSession',
  'scheduleMessage',
  'sendMessage',
  'sendMessageWithImages',
  'startSession',
  'stopSession',
  'switchProviderWithContext',
  'translateMessage',
  'translatePrompt',
  'wakeFromDeepHibernation',
  'wakeFromHibernation',
  // Side conversations / review loop / teams
  'closeBtwSession',
  'sendBtwMessage',
  'startBtwSession',
  'reviewLoopStart',
  'reviewLoopStop',
  'stopMergeAssistant',
  'refreshMergeConflicts',
  'teamCreateTask',
  'teamPanelOpen',
  'teamSendMessage',
  'teamShutdownAgent',
  'teamUpdateTask',
  // Tabs, documents, navigation, panels
  'closeDocument',
  'closeTab',
  'closeTabGroup',
  'createTabGroup',
  'focusDocument',
  'focusTab',
  'focusWorktreeSession',
  'moveTabInNavigation',
  'reorderTabs',
  'setGroupCollapsed',
  'openPlanDocs',
  'openProviderTab',
  'openSessionFromSearch',
  'openSettings',
  'openSkillGenGuide',
  'openSmartSearch',
  'showHistory',
  'chatSearchResumeSession',
  'mcpOpenConfig',
  'mcpOpenLogs',
  'mcpRestartSession',
  'bugReportClose',
  'bugReportInit',
  'whatsNewDismiss',
  'whatsNewOpenChangelog',
  // Workstream map
  'workstreamMapApplyEdit',
  'workstreamMapDismissResumeView',
  'workstreamMapNaturalLanguageEdit',
  'workstreamMapOpen',
  'workstreamMapOpenSession',
  'workstreamMapReclassify',
  'workstreamMapSaveSnapshot',
  'workstreamPortfolioOpenProject',
  // Achievements / analytics (local)
  'refreshFriends',
  'forceResampleTokenRatio',
  'setAchievementsEnabled',
  // Model / provider / display preferences
  'setActivitySummaryEnabled',
  'setAdventureWidgetEnabled',
  'setAnalysisModel',
  'setAutoContinueOnLimit',
  'setAutoEnhance',
  'setAutoTranslate',
  'setBabelFishEnabled',
  'setClaudeEffort',
  'setClaudeFastMode',
  'setCodexReasoningEffort',
  'setCodexServiceTier',
  'setCustomSnippet',
  'setDetailedDiffViewEnabled',
  'setEnhancerModel',
  'setGoalState',
  'setMessageColorScheme',
  'setModel',
  'setPermissionMode',
  'setPromptTranslationEnabled',
  'setProvider',
  'setRestoreSessionsEnabled',
  'setReviewLoopAutoStart',
  'setReviewLoopMaxRounds',
  'setReviewLoopSessionEnabled',
  'setSummaryModeEnabled',
  'setTabLayout',
  'setTranslationLanguage',
  'setTurnAnalysisEnabled',
  'setTypingTheme',
  'setUltrathinkMode',
  'setUsageWidgetEnabled',
  'setVerticalTabRailWidth',
  'setVitalsEnabled',
  'setVpmEnabled',
  'setWeatherWidgetEnabled',
]);

/**
 * Explicitly sensitive UI actions (documentation + test coverage; anything not
 * in the sets above is sensitive anyway): credentials / sign-in, git /
 * worktrees / merges, MCP server config, security policy, bridge provider
 * routing (council providers can point at any URL and key file), file-system
 * changes without confirmation, local files / URLs / terminals / clipboard,
 * external sends, data deletion, network joins, SkillGen (writes CLAUDE.md /
 * runs pipelines).
 */
export const SENSITIVE_UI_ACTIONS = new Set<string>([
  'openCodexLogin',
  'claudeAuthLogin',
  'claudeAuthLogout',
  'setApiKey',
  'githubSync',
  'setGitHubSyncEnabled',
  'addFriend',
  'removeFriend',
  'pickCodexCliPath',
  'autoDetectCodexCliPath',
  'autoSetupCodexCli',
  'gitPush',
  'gitPushConfig',
  'createWorktree',
  'createWorktreeSession',
  'removeWorktree',
  'commitWorktree',
  'performMerge',
  'abortMerge',
  'completeMerge',
  'undoMerge',
  'startMergeAssistant',
  'sendMergeAssistantMessage',
  'openConflictFiles',
  'openWorktreeFolder',
  'mcpAddServer',
  'mcpRemoveServer',
  'mcpResetProjectChoices',
  'mcpImportDesktop',
  'secretProtectionSetSetting',
  'superParticleAcceleratorSetEnabled',
  'superParticleAcceleratorSetMode',
  'superParticleAcceleratorCreateException',
  'superParticleAcceleratorDeleteException',
  'workspaceAccessGuardSetEnabled',
  'workspaceAccessGuardSetMode',
  'workspaceAccessGuardPickAllowedRoots',
  'workspaceAccessGuardAddAllowedRoots',
  'workspaceAccessGuardRemoveAllowedRoot',
  'workspaceAccessGuardAddCurrentWorkspace',
  'particleAcceleratorSetEnabled',
  'particleAcceleratorInstallHooks',
  'particleAcceleratorUninstallHooks',
  'particleAcceleratorClearData',
  'particleAcceleratorOpenTrace',
  'setCouncilSettings',
  'checkpointRedo',
  'checkpointRevert',
  'workstreamMapImportExternalFolder',
  'pickFiles',
  'resolveDroppedFiles',
  'saveDroppedFiles',
  'osFileDragStarted',
  'resolveOsDroppedFiles',
  'openFile',
  'openUrl',
  'openHtmlPreview',
  'openTerminal',
  'openFeedback',
  'copyToClipboard',
  'copyShareCard',
  'bugReportApproveScript',
  'bugReportChat',
  'bugReportSubmit',
  'feedbackAction',
  'clearTokenRatioData',
  'openMultiParticipant',
  'mpJoinSession',
  'mpLeaveSession',
  'mpSendMessage',
  'mpTypingIndicator',
  'mpApprovalDecision',
  'mpRenameParticipant',
  'mpCancelAgent',
  'mpStopA2A',
  'mpResetSession',
  'mpAddReaction',
  'mpRemoveReaction',
  'setSkillGenEnabled',
  'setSkillGenThreshold',
  'skillGenTrigger',
  'skillGenCancel',
  'skillGenOnboardingDecision',
]);

export function classifyUiAction(type: string): ActionRisk {
  if (BLOCKED_UI_ACTIONS.has(type)) {
    return 'blocked';
  }
  if (QUERY_UI_ACTIONS.has(type)) {
    return 'query';
  }
  if (NORMAL_UI_ACTIONS.has(type)) {
    return 'normal';
  }
  // Explicitly sensitive, or not classified yet: sensitive by default.
  return 'sensitive';
}

/** Palette commands that sign in/out, delete data, register with servers or move sessions between worktrees. */
export const SENSITIVE_COMMANDS = new Set<string>([
  'claudeMirror.history.delete',
  'claudeMirror.claudeAccounts.login',
  'claudeMirror.claudeAccounts.logout',
  'claudeMirror.claudeAccounts.manage',
  'claudeMirror.switchClaudeAccountWithContext',
  'claudeMirror.registerUsageReporting',
  'claudeMirror.disableUsageReporting',
  'claudeMirror.reportUsageNow',
  'claudeMirror.authenticateHappy',
  'claudeMirror.joinMultiParticipantSession',
  'claudeMirror.createMultiParticipantSession',
  'claudeMirror.sendFeedback',
  'claudeMirror.moveSessionToWorktree',
  'claudeMirror.createWorktreeSession',
  'claudeMirror.history.revealFile',
  'claudeMirror.openLogDirectory',
]);

export function classifyCommand(command: string): ActionRisk {
  if (!command.startsWith('claudeMirror.')) {
    return 'blocked';
  }
  // Remote control must never reconfigure or re-register itself remotely.
  if (command.startsWith('claudeMirror.remoteControl.')) {
    return 'blocked';
  }
  if (SENSITIVE_COMMANDS.has(command)) {
    return 'sensitive';
  }
  return 'normal';
}

/** Normalize "claudeMirror.foo" / "foo" to the short key "foo". */
export function shortSettingKey(key: string): string {
  return key.startsWith('claudeMirror.') ? key.slice('claudeMirror.'.length) : key;
}

const SECRET_KEY_PATTERN = /(token|apikey|api_key|secret|password|credential|clientid|(^|\.)pat$)/i;
const SENSITIVE_SETTING_PATTERN =
  /(cliPath|Path$|Directory$|executable|command|serverUrl|webhook|url$|endpoint|baseUrl|hooks|policy|Roots$|Globs$)/i;
/** Whole setting families whose values route prompts / credentials / scripts outside ClaUi. */
const SENSITIVE_SETTING_PREFIXES = [
  'bridge.', // provider routing: OpenAI-compatible base URLs + key files, council members, external CLIs
  'usageReporting.',
  'multiParticipant.',
  'skillGen.',
  'srPtdAutoInject',
  'gitPush.',
  'worktree.',
  'claudeAccounts.',
  'achievements.githubSync',
  'smartSearch.allowBash',
  'secretProtection.',
  'superParticleAccelerator.',
  'workspaceAccessGuard.',
  'particleAccelerator.',
];

/** Settings whose values must never be returned to remote callers. */
export function isSecretSettingKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(shortSettingKey(key));
}

/** Risk of WRITING a setting remotely. */
export function classifySettingWrite(key: string): ActionRisk {
  const short = shortSettingKey(key);
  if (short.startsWith('remoteControl.')) {
    return 'blocked';
  }
  if (SENSITIVE_SETTING_PREFIXES.some((prefix) => short === prefix || short.startsWith(prefix))) {
    return 'sensitive';
  }
  if (isSecretSettingKey(short) || SENSITIVE_SETTING_PATTERN.test(short)) {
    return 'sensitive';
  }
  return 'normal';
}
