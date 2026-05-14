import * as fs from 'fs';
import * as path from 'path';
import {
  Session, Participant, Message, AgentDelivery, AgentSeenState,
  AgentLoopControlState, ApprovalEvent, RenameEvent,
} from './types';

export interface SessionState {
  session: Session;
  participants: Participant[];
  transcript: Message[];
  deliveries: Map<string, AgentDelivery>;
  seenState: Map<string, AgentSeenState>;
  loopState: AgentLoopControlState | null;
  approvals: ApprovalEvent[];
  renameEvents: RenameEvent[];
}

interface PersistenceRecord {
  ts: string;
  ev: string;
  d: any;
}

export class SessionPersistence {
  private filePath: string;
  private writeStream: fs.WriteStream | null = null;
  private log: (msg: string) => void;

  constructor(dataDir: string, sessionId: string, log?: (msg: string) => void) {
    this.filePath = path.join(dataDir, `session-${sessionId}.jsonl`);
    this.log = log || console.log;
  }

  init(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.writeStream = fs.createWriteStream(this.filePath, { flags: 'a', encoding: 'utf-8' });
    this.log(`Persistence: writing to ${this.filePath}`);
  }

  append(ev: string, data: any): void {
    if (!this.writeStream) return;
    const record: PersistenceRecord = {
      ts: new Date().toISOString(),
      ev,
      d: data,
    };
    this.writeStream.write(JSON.stringify(record) + '\n');
  }

  /** Sort session files by modification time, newest first. */
  private static sortFilesByMtime(dataDir: string): string[] {
    return fs.readdirSync(dataDir)
      .filter(f => f.startsWith('session-') && f.endsWith('.jsonl'))
      .map(f => ({ name: f, mtimeMs: fs.statSync(path.join(dataDir, f)).mtimeMs }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .map(f => f.name);
  }

  static loadLatestSession(dataDir: string, log?: (msg: string) => void): SessionState | null {
    const logger = log || console.log;
    if (!fs.existsSync(dataDir)) return null;

    const files = SessionPersistence.sortFilesByMtime(dataDir);

    if (files.length === 0) return null;

    const filePath = path.join(dataDir, files[0]);
    logger(`Persistence: loading from ${filePath}`);
    return SessionPersistence.loadFromFile(filePath, log);
  }

  /**
   * Load all persisted sessions and return them keyed by sessionNumber.
   * Files are sorted by mtime newest-first so the latest file per sessionNumber wins
   * (handles reset scenarios where multiple files exist for the same room).
   * Legacy sessions without sessionNumber are skipped.
   */
  static loadAllSessions(dataDir: string, log?: (msg: string) => void): Map<number, SessionState> {
    const logger = log || console.log;
    const result = new Map<number, SessionState>();
    if (!fs.existsSync(dataDir)) return result;

    const files = SessionPersistence.sortFilesByMtime(dataDir);

    for (const file of files) {
      const filePath = path.join(dataDir, file);
      const state = SessionPersistence.loadFromFile(filePath, log);
      if (!state) continue;

      if (state.session.sessionNumber == null) {
        logger(`Persistence: skipping legacy session without sessionNumber from ${file}`);
        continue;
      }

      const num = state.session.sessionNumber;
      if (result.has(num)) {
        logger(`Persistence: skipping older room ${num} from ${file} (latest already loaded)`);
        continue;
      }

      result.set(num, state);
      logger(`Persistence: loaded room ${num} from ${file}`);
    }

    return result;
  }

  static loadFromFile(filePath: string, log?: (msg: string) => void): SessionState | null {
    const logger = log || console.log;
    if (!fs.existsSync(filePath)) return null;

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    if (lines.length === 0) return null;

    let session: Session | null = null;
    const participants: Participant[] = [];
    const transcript: Message[] = [];
    const deliveries = new Map<string, AgentDelivery>();
    const seenState = new Map<string, AgentSeenState>();
    let loopState: AgentLoopControlState | null = null;
    const approvals: ApprovalEvent[] = [];
    const renameEvents: RenameEvent[] = [];

    for (const line of lines) {
      try {
        const record: PersistenceRecord = JSON.parse(line);
        switch (record.ev) {
          case 'init':
            session = record.d.session;
            break;

          case 'join': {
            const { human, agent, agentSeen } = record.d;
            if (!participants.find(p => p.participantId === human.participantId)) {
              participants.push(human);
            }
            if (!participants.find(p => p.participantId === agent.participantId)) {
              participants.push(agent);
            }
            if (agentSeen) {
              seenState.set(agentSeen.agentParticipantId, agentSeen);
            }
            break;
          }

          case 'msg':
            transcript.push(record.d);
            if (session && record.d.seq >= session.nextSeq) {
              session.nextSeq = record.d.seq + 1;
            }
            break;

          case 'dlv':
            deliveries.set(record.d.deliveryId, record.d);
            break;

          case 'seen':
            seenState.set(record.d.agentParticipantId, record.d);
            break;

          case 'pstat': {
            const p = participants.find(pp => pp.participantId === record.d.participantId);
            if (p) p.status = record.d.status;
            break;
          }

          case 'leave': {
            const p = participants.find(pp => pp.participantId === record.d.participantId);
            if (p) p.status = 'offline';
            break;
          }

          case 'rename': {
            const { event: renameEvent, participant: updated } = record.d;
            const p = participants.find(pp => pp.participantId === updated.participantId);
            if (p) {
              p.displayName = updated.displayName;
              p.canonicalName = updated.canonicalName;
              p.routeKey = updated.routeKey;
            }
            renameEvents.push(renameEvent);
            break;
          }

          case 'loop':
            loopState = record.d;
            break;

          case 'session-update':
            if (session) {
              Object.assign(session, record.d);
            }
            break;

          case 'appr': {
            const existing = approvals.find(a => a.eventId === record.d.eventId);
            if (existing) {
              Object.assign(existing, record.d);
            } else {
              approvals.push(record.d);
            }
            break;
          }
        }
      } catch (err) {
        logger(`Persistence: error parsing line: ${err}`);
      }
    }

    if (!session) return null;

    logger(`Persistence: loaded ${transcript.length} messages, ${participants.length} participants`);
    return {
      session,
      participants,
      transcript,
      deliveries,
      seenState,
      loopState,
      approvals,
      renameEvents,
    };
  }

  close(): void {
    if (this.writeStream) {
      this.writeStream.end();
      this.writeStream = null;
      this.log('Persistence: closed');
    }
  }
}
