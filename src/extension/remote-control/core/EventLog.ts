import type { RemoteEvent } from '../../../remote-control-shared/protocol';
import { compactPayload } from './payloadCompactor';

/**
 * Ordered log of everything remote callers can observe: chat-UI messages
 * (out), UI/remote actions (in) and synthesized tab lifecycle events
 * (system). Every event gets a monotonically increasing `seq`.
 *
 * High-frequency types (streaming deltas, tab-list broadcasts, memory
 * samples) are delivered to live subscribers (SSE, turn waiters) but are not
 * kept in the ring buffer, so they cannot evict meaningful history.
 */

export interface EventFilter {
  tabId?: string | null;
  types?: string[];
  direction?: RemoteEvent['direction'];
}

export interface EventInput {
  tabId: string | null;
  direction: RemoteEvent['direction'];
  type: string;
  data: unknown;
}

/** Types delivered live only (never stored). */
export const LIVE_ONLY_EVENT_TYPES = new Set<string>([
  'streamingText',
  'toolUseInput',
  'tabList',
  'memorySnapshot',
  'btwStreamingText',
  'mergeAssistantStreamingText',
  'mpAgentStreamingText',
  'mpTypingIndicator',
  'focusInput',
  'requestTabList',
  'requestMemoryStream',
]);

export type EventListener = (event: RemoteEvent) => void;

export class EventLog {
  private readonly buffer: RemoteEvent[] = [];
  private seq = 0;
  private readonly listeners = new Set<EventListener>();

  constructor(private readonly capacity = 3000) {}

  get lastSeq(): number {
    return this.seq;
  }

  /** Oldest seq still stored (0 when empty). */
  get oldestSeq(): number {
    return this.buffer.length > 0 ? this.buffer[0].seq : 0;
  }

  record(input: EventInput): RemoteEvent {
    const event: RemoteEvent = {
      seq: ++this.seq,
      time: new Date().toISOString(),
      tabId: input.tabId,
      direction: input.direction,
      type: input.type,
      data: compactPayload(input.data),
    };
    if (!LIVE_ONLY_EVENT_TYPES.has(input.type)) {
      this.buffer.push(event);
      if (this.buffer.length > this.capacity) {
        this.buffer.splice(0, this.buffer.length - this.capacity);
      }
    }
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        // A faulty subscriber must never break event recording.
      }
    }
    return event;
  }

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  get subscriberCount(): number {
    return this.listeners.size;
  }

  static matches(event: RemoteEvent, filter: EventFilter): boolean {
    if (filter.tabId !== undefined && event.tabId !== filter.tabId) {
      return false;
    }
    if (filter.direction && event.direction !== filter.direction) {
      return false;
    }
    if (filter.types && filter.types.length > 0 && !filter.types.includes(event.type)) {
      return false;
    }
    return true;
  }

  /** Stored events with seq > sinceSeq matching the filter, oldest first, at most `limit`. */
  query(sinceSeq: number, filter: EventFilter = {}, limit = 100): RemoteEvent[] {
    const out: RemoteEvent[] = [];
    for (const event of this.buffer) {
      if (event.seq <= sinceSeq || !EventLog.matches(event, filter)) {
        continue;
      }
      out.push(event);
      if (out.length >= limit) {
        break;
      }
    }
    return out;
  }

  /** The newest `limit` stored events matching the filter, oldest first. */
  tail(filter: EventFilter = {}, limit = 100): RemoteEvent[] {
    const out: RemoteEvent[] = [];
    for (let i = this.buffer.length - 1; i >= 0 && out.length < limit; i--) {
      if (EventLog.matches(this.buffer[i], filter)) {
        out.push(this.buffer[i]);
      }
    }
    return out.reverse();
  }

  /**
   * Long-poll: resolves with stored matching events after sinceSeq as soon as
   * at least one exists, or with [] after timeoutMs (or when aborted).
   */
  waitForEvents(
    sinceSeq: number,
    filter: EventFilter,
    limit: number,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<RemoteEvent[]> {
    const existing = this.query(sinceSeq, filter, limit);
    if (existing.length > 0 || timeoutMs <= 0 || signal?.aborted) {
      return Promise.resolve(existing);
    }
    return new Promise((resolve) => {
      let unsubscribe: () => void = () => undefined;
      const finish = (): void => {
        clearTimeout(timer);
        unsubscribe();
        signal?.removeEventListener('abort', finish);
        resolve(this.query(sinceSeq, filter, limit));
      };
      const timer = setTimeout(finish, timeoutMs);
      unsubscribe = this.subscribe((event) => {
        if (!LIVE_ONLY_EVENT_TYPES.has(event.type) && event.seq > sinceSeq && EventLog.matches(event, filter)) {
          finish();
        }
      });
      signal?.addEventListener('abort', finish);
    });
  }
}
