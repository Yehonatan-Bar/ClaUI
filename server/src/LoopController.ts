import { v4 as uuid } from 'uuid';
import {
  AgentLoopControlState, ApprovalEvent, ApprovalDecisionPayload,
  Message, Participant,
} from './types';

export type LoopControlAction =
  | { action: 'deliver' }
  | { action: 'pause'; approval: ApprovalEvent }
  | { action: 'guard-check' };

export class LoopController {
  private loopState: AgentLoopControlState;
  private pendingApprovals: Map<string, ApprovalEvent> = new Map();
  private pendingDeliveryData: Map<string, { message: Message; targetAgent: Participant }> = new Map();
  private log: (msg: string) => void;

  constructor(sessionId: string, log?: (msg: string) => void) {
    this.log = log || console.log;
    this.loopState = {
      sessionId,
      mode: 'ask',
      remainingBudget: null,
      consecutiveA2aCount: 0,
      lastGuardCheckAt: 0,
      approvedByParticipantId: null,
      updatedAt: new Date().toISOString(),
    };
  }

  getState(): AgentLoopControlState {
    return { ...this.loopState };
  }

  isAgentToAgent(author: Participant, recipient: Participant): boolean {
    return author.kind === 'agent' && recipient.kind === 'agent';
  }

  processA2A(
    sessionId: string,
    sourceAgent: Participant,
    targetAgent: Participant,
    pendingMessage: Message,
  ): LoopControlAction {
    const now = new Date().toISOString();

    switch (this.loopState.mode) {
      case 'ask': {
        const approval = this.createApproval(sessionId, sourceAgent, targetAgent, pendingMessage, now);
        return { action: 'pause', approval };
      }

      case 'budget': {
        if (this.loopState.remainingBudget !== null && this.loopState.remainingBudget > 0) {
          this.loopState.remainingBudget--;
          this.loopState.consecutiveA2aCount++;
          this.loopState.updatedAt = now;
          this.log(`A2A budget: ${this.loopState.remainingBudget} remaining`);
          return { action: 'deliver' };
        }
        this.log('A2A budget depleted, pausing for approval');
        const approval = this.createApproval(sessionId, sourceAgent, targetAgent, pendingMessage, now);
        return { action: 'pause', approval };
      }

      case 'always': {
        this.loopState.consecutiveA2aCount++;
        this.loopState.updatedAt = now;
        if (this.loopState.consecutiveA2aCount - this.loopState.lastGuardCheckAt >= 20) {
          this.log(`A2A guard check triggered at count ${this.loopState.consecutiveA2aCount}`);
          return { action: 'guard-check' };
        }
        return { action: 'deliver' };
      }

      case 'force': {
        this.loopState.consecutiveA2aCount++;
        this.loopState.updatedAt = now;
        return { action: 'deliver' };
      }
    }
  }

  createGuardPauseApproval(
    sessionId: string,
    sourceAgent: Participant,
    targetAgent: Participant,
    pendingMessage: Message,
  ): ApprovalEvent {
    return this.createApproval(
      sessionId, sourceAgent, targetAgent, pendingMessage, new Date().toISOString(),
    );
  }

  advanceGuardCheckpoint(): void {
    this.loopState.lastGuardCheckAt = this.loopState.consecutiveA2aCount;
    this.loopState.updatedAt = new Date().toISOString();
  }

  resetOnHumanIntervention(): void {
    this.loopState.consecutiveA2aCount = 0;
    this.loopState.lastGuardCheckAt = 0;
    this.loopState.updatedAt = new Date().toISOString();
  }

  processApprovalDecision(
    eventId: string,
    decision: ApprovalDecisionPayload,
    decidedByParticipantId: string,
  ): { approval: ApprovalEvent; pendingMessage: Message; targetAgent: Participant } | null {
    const approval = this.pendingApprovals.get(eventId);
    const pending = this.pendingDeliveryData.get(eventId);
    if (!approval || !pending) return null;

    const now = new Date().toISOString();
    approval.decision = decision.type;
    approval.decidedByParticipantId = decidedByParticipantId;
    approval.decidedAt = now;

    if (decision.type === 'approve-count') {
      approval.budgetCount = decision.budgetCount ?? null;
    }

    switch (decision.type) {
      case 'deny':
        this.loopState.mode = 'ask';
        this.loopState.updatedAt = now;
        break;

      case 'approve-count':
        this.loopState.mode = 'budget';
        this.loopState.remainingBudget = decision.budgetCount ?? 5;
        this.loopState.consecutiveA2aCount = 0;
        this.loopState.approvedByParticipantId = decidedByParticipantId;
        this.loopState.updatedAt = now;
        break;

      case 'approve-always':
        this.loopState.mode = 'always';
        this.loopState.consecutiveA2aCount = 0;
        this.loopState.lastGuardCheckAt = 0;
        this.loopState.approvedByParticipantId = decidedByParticipantId;
        this.loopState.updatedAt = now;
        break;

      case 'approve-force':
        this.loopState.mode = 'force';
        this.loopState.approvedByParticipantId = decidedByParticipantId;
        this.loopState.updatedAt = now;
        break;
    }

    this.pendingApprovals.delete(eventId);
    this.pendingDeliveryData.delete(eventId);

    return { approval, pendingMessage: pending.message, targetAgent: pending.targetAgent };
  }

  getPendingApprovals(): ApprovalEvent[] {
    return [...this.pendingApprovals.values()];
  }

  restoreState(state: AgentLoopControlState): void {
    this.loopState = { ...state };
  }

  restoreApprovals(
    approvals: ApprovalEvent[],
    pendingData: Map<string, { message: Message; targetAgent: Participant }>,
  ): void {
    for (const a of approvals) {
      if (a.decision === null) {
        this.pendingApprovals.set(a.eventId, a);
        const data = pendingData.get(a.eventId);
        if (data) {
          this.pendingDeliveryData.set(a.eventId, data);
        }
      }
    }
  }

  private createApproval(
    sessionId: string,
    sourceAgent: Participant,
    targetAgent: Participant,
    pendingMessage: Message,
    now: string,
  ): ApprovalEvent {
    const approval: ApprovalEvent = {
      eventId: uuid(),
      sessionId,
      type: 'agent-to-agent',
      sourceAgentId: sourceAgent.participantId,
      targetAgentId: targetAgent.participantId,
      pendingMessageId: pendingMessage.messageId,
      decision: null,
      budgetCount: null,
      decidedByParticipantId: null,
      createdAt: now,
      decidedAt: null,
    };

    this.pendingApprovals.set(approval.eventId, approval);
    this.pendingDeliveryData.set(approval.eventId, { message: pendingMessage, targetAgent });

    return approval;
  }
}
