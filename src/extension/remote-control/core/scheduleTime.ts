import { ERROR_CODES, RemoteControlError } from '../../../remote-control-shared/protocol';

/** Parse "+15m" / "+2h" / "+30s" / "+1d", an ISO date-time, or epoch ms into epoch ms. */
export function parseScheduleTime(at: unknown, now = Date.now()): number {
  if (typeof at === 'number' && Number.isFinite(at)) {
    return at;
  }
  if (typeof at === 'string') {
    const rel = /^\+\s*(\d+(?:\.\d+)?)\s*([smhd])$/i.exec(at.trim());
    if (rel) {
      const unitMs = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[rel[2].toLowerCase() as 's' | 'm' | 'h' | 'd'];
      return now + Number(rel[1]) * unitMs;
    }
    const parsed = Date.parse(at);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  throw new RemoteControlError(ERROR_CODES.invalidArgs, 'at: expected an ISO date-time, epoch milliseconds, or "+<n>s|m|h|d"');
}
