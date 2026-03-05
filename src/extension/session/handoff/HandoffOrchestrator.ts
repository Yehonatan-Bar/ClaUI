import type { SerializedChatMessage } from '../../types/webview-messages';
import { HandoffContextBuilder } from './HandoffContextBuilder';
import { HandoffPromptComposer } from './HandoffPromptComposer';
import { HandoffArtifactStore } from './HandoffArtifactStore';
import type {
  HandoffProvider,
  HandoffProgressUpdate,
  HandoffRunResult,
  HandoffSourceSnapshot,
} from './HandoffTypes';

export interface HandoffTargetRuntime {
  id: string;
  sessionId: string | null;
  setForkInit(init: { promptText: string; messages: SerializedChatMessage[] }): void;
  startSession(options?: { cwd?: string }): Promise<void>;
  sendText(text: string): void | Promise<void>;
  waitForNextAssistantReply(timeoutMs: number): Promise<boolean>;
}

export class HandoffOrchestrator {
  constructor(
    private readonly contextBuilder: HandoffContextBuilder,
    private readonly promptComposer: HandoffPromptComposer,
    private readonly artifactStore: HandoffArtifactStore,
    private readonly log: (msg: string) => void,
  ) {}

  async run(params: {
    source: HandoffSourceSnapshot;
    targetProvider: HandoffProvider;
    autoSend: boolean;
    createTargetTab: (provider: HandoffProvider) => HandoffTargetRuntime;
    onProgress: (update: HandoffProgressUpdate) => void;
  }): Promise<HandoffRunResult> {
    const startedAt = Date.now();
    const emit = (update: Omit<HandoffProgressUpdate, 'sourceProvider' | 'targetProvider'>): void => {
      params.onProgress({
        ...update,
        sourceProvider: params.source.provider,
        targetProvider: params.targetProvider,
      });
    };

    let prompt = '';
    let targetTab: HandoffTargetRuntime | null = null;
    let artifactPath: string | undefined;

    try {
      emit({ stage: 'collecting_context', detail: 'Building provider-neutral capsule' });
      const capsule = this.contextBuilder.buildCapsule({
        source: params.source,
        targetProvider: params.targetProvider,
      });

      prompt = this.promptComposer.compose(capsule);
      const artifact = this.artifactStore.save(capsule, prompt);
      artifactPath = artifact?.markdownPath ?? artifact?.jsonPath;

      emit({
        stage: 'creating_target_tab',
        detail: 'Opening target tab',
        artifactPath,
      });
      targetTab = params.createTargetTab(params.targetProvider);
      targetTab.setForkInit({
        promptText: capsule.task.objective || '',
        messages: params.source.messages,
      });

      emit({ stage: 'starting_target_session', detail: 'Starting fresh target session', artifactPath });
      await targetTab.startSession({ cwd: params.source.cwd });

      emit({ stage: 'injecting_handoff_prompt', detail: 'Injecting handoff opening prompt', artifactPath });
      if (params.autoSend) {
        await Promise.resolve(targetTab.sendText(prompt));
      }

      if (params.autoSend) {
        emit({ stage: 'awaiting_first_reply', detail: 'Waiting for first target reply', artifactPath });
        const gotReply = await targetTab.waitForNextAssistantReply(120_000);
        if (!gotReply) {
          throw new Error('Timed out while waiting for first reply from target session');
        }
      }

      emit({ stage: 'completed', detail: 'Handoff completed', artifactPath, manualPrompt: prompt });
      this.log(`[Handoff] completed source=${params.source.tabId} target=${targetTab.id} durationMs=${Date.now() - startedAt}`);

      return {
        targetTabId: targetTab.id,
        targetSessionId: targetTab.sessionId || undefined,
        artifact,
        capsule,
        prompt,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      emit({
        stage: 'failed',
        detail: 'Handoff failed',
        error: message,
        artifactPath,
        manualPrompt: prompt || undefined,
      });
      this.log(
        `[Handoff] failed source=${params.source.tabId} target=${params.targetProvider} durationMs=${Date.now() - startedAt} error=${message}`,
      );
      throw err;
    }
  }
}
