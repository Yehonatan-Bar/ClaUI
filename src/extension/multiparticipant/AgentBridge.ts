import * as vscode from 'vscode';
import { MultiParticipantClient } from './MultiParticipantClient';
import { HeadlessAgentRunner } from './HeadlessAgentRunner';
import type {
  ServerToClientMessage, AgentEventPayload, MPAgentBusyPolicy,
  MPFileChange, MPFileChangeReportSource,
} from './MultiParticipantProtocol';

/**
 * Connects server delivery commands to the local HeadlessAgentRunner,
 * and reports agent lifecycle events back to the server.
 *
 * This is the core integration bridge:
 *   Server -> deliverPrompt -> AgentBridge -> HeadlessAgentRunner -> local agent
 *   local agent -> events -> AgentBridge -> server
 */
export class AgentBridge {
  private client: MultiParticipantClient;
  private runner: HeadlessAgentRunner;
  private agentParticipantId: string | null = null;
  private log: (msg: string) => void;

  constructor(
    client: MultiParticipantClient,
    runner: HeadlessAgentRunner,
    log?: (msg: string) => void,
  ) {
    this.client = client;
    this.runner = runner;
    this.log = log || (() => {});
    this.wireEvents();
  }

  setAgentParticipantId(id: string): void {
    this.agentParticipantId = id;
  }

  private wireEvents(): void {
    // Server -> Agent: listen for deliverPrompt and cancelAgent commands
    this.client.on('message', (msg: ServerToClientMessage) => {
      if (msg.type === 'deliverPrompt') {
        this.handleDeliverPrompt(msg.deliveryId, msg.agentParticipantId, msg.prompt, msg.busyPolicy);
      }
      if (msg.type === 'cancelAgent') {
        this.handleCancelAgent(msg.deliveryId, msg.agentParticipantId, msg.reason);
      }
    });

    // Agent -> Server: forward all agent events
    this.runner.on('agentEvent', (deliveryId: string, event: AgentEventPayload) => {
      this.log(`[AgentBridge] agentEvent: delivery=${deliveryId} kind=${event.kind}`);
      this.client.send({
        type: 'agentEvent',
        deliveryId,
        event,
      });
    });

    // Agent -> Server: forward file change reports
    this.runner.on('fileChanges', (deliveryId: string, changes: MPFileChange[], source: MPFileChangeReportSource) => {
      this.log(`[AgentBridge] fileChanges: delivery=${deliveryId} count=${changes.length} source=${source}`);
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      this.client.send({
        type: 'fileChangeReport',
        report: {
          deliveryId,
          agentParticipantId: this.agentParticipantId || undefined,
          workspaceId: workspaceFolder?.uri.toString() || 'unknown',
          workspaceRoot: workspaceFolder?.uri.fsPath,
          source,
          changes,
          reportedAt: new Date().toISOString(),
        },
      });
    });
  }

  private handleDeliverPrompt(
    deliveryId: string,
    agentParticipantId: string,
    prompt: string,
    busyPolicy: MPAgentBusyPolicy | null,
  ): void {
    // Only handle prompts for our agent
    if (this.agentParticipantId && agentParticipantId !== this.agentParticipantId) {
      this.log(`[AgentBridge] ignoring delivery for different agent: ${agentParticipantId}`);
      return;
    }

    this.log(`[AgentBridge] delivering prompt: id=${deliveryId} len=${prompt.length} policy=${busyPolicy}\n  prompt preview: ${prompt.slice(0, 200)}`);

    this.runner.deliver(deliveryId, prompt, busyPolicy).catch((err) => {
      this.log(`[AgentBridge] delivery error: ${err}`);
      this.client.send({
        type: 'agentEvent',
        deliveryId,
        event: { kind: 'failed', error: err instanceof Error ? err.message : String(err) },
      });
    });
  }

  private handleCancelAgent(deliveryId: string, agentParticipantId: string, reason?: string): void {
    if (this.agentParticipantId && agentParticipantId !== this.agentParticipantId) {
      this.log(`[AgentBridge] ignoring cancel for different agent: ${agentParticipantId}`);
      return;
    }

    this.log(`[AgentBridge] canceling agent: delivery=${deliveryId} reason=${reason || 'none'}`);
    this.runner.cancel(deliveryId);
  }

  dispose(): void {
    this.runner.dispose();
  }
}
