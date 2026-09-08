/**
 * Pure "What's New" selection logic.
 *
 * No `vscode` import on purpose: the service layer supplies the installed
 * version, the persisted id sets and the bundled announcements, and this module
 * decides what is eligible, what is newly discovered, and what the banner shows.
 * Everything here is covered by tests/unit/whatsNewLogic.test.ts.
 *
 * State model (recommended by the architecture review):
 *   - eligible   = announcements whose `version` <= installed version
 *   - new        = eligible ids the user has never been exposed to (not in knownIds)
 *   - pending    = eligible ids not dismissed (what the banner renders, newest first)
 * Both persisted sets are monotonic (they only grow), which makes concurrent
 * writes from several VS Code windows idempotent and keeps a downgrade from
 * resurrecting announcements.
 */
import type { WhatsNewAnnouncement } from '../types/webview-messages';

/** Maximum announcements rendered in the banner at once (newest first). */
export const WHATS_NEW_MAX_BANNER_ITEMS = 3;

/** Persisted under a single globalState key so both sets commit atomically. */
export interface WhatsNewPersistedState {
  /** Ids the user has been exposed to, or that were seeded silently on a fresh install. */
  knownIds: string[];
  /** Ids acknowledged by Dismiss, or auto-dismissed (fresh install / notifications off). */
  dismissedIds: string[];
}

export interface WhatsNewComputeInput {
  /** Raw bundled JSON (either an array or `{ announcements: [...] }`). Validated here. */
  announcements: unknown;
  /** Installed extension version from the manifest (major.minor.patch). */
  currentVersion: string;
  persisted: WhatsNewPersistedState;
  /** False on a brand-new install: eligible entries are seeded as seen, nothing is shown. */
  isExistingInstall: boolean;
  /** The `claudeMirror.showWhatsNew` setting. */
  notificationsEnabled: boolean;
}

export interface WhatsNewComputeResult {
  /** False when `currentVersion` is not a numeric dotted version; nothing else is meaningful then. */
  validVersion: boolean;
  /** All valid announcements with version <= currentVersion, newest first. */
  eligible: WhatsNewAnnouncement[];
  /** Eligible entries the user has never seen (drive the one-time toast). */
  newlyDiscovered: WhatsNewAnnouncement[];
  /** What the banner should render right now (capped). */
  pending: WhatsNewAnnouncement[];
  /** Persisted state to write back (monotonic superset of the input). */
  nextPersisted: WhatsNewPersistedState;
  /** True when a one-time toast should be attempted. */
  shouldToast: boolean;
  /** Number of bundled entries dropped for being malformed (logged by the caller). */
  invalidEntryCount: number;
}

const MAX_VERSION_PARTS = 4;

/**
 * Parse a numeric dotted version ("0.1.229", "v1.2", "1.2.3.4") into number parts.
 * Returns null for anything else (pre-release tags, empty strings, garbage).
 */
export function parseVersion(value: unknown): number[] | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim().replace(/^v/i, '');
  if (trimmed.length === 0) {
    return null;
  }
  const parts = trimmed.split('.');
  if (parts.length === 0 || parts.length > MAX_VERSION_PARTS) {
    return null;
  }
  const numbers: number[] = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) {
      return null;
    }
    numbers.push(Number.parseInt(part, 10));
  }
  return numbers;
}

export function isValidVersion(value: unknown): value is string {
  return parseVersion(value) !== null;
}

/**
 * Compare two valid numeric versions. Missing trailing parts count as 0, so
 * "1.2" equals "1.2.0". Callers must validate with `isValidVersion` first;
 * invalid input sorts as the lowest possible version.
 */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a) ?? [];
  const right = parseVersion(b) ?? [];
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index++) {
    const leftPart = left[index] ?? 0;
    const rightPart = right[index] ?? 0;
    if (leftPart !== rightPart) {
      return leftPart < rightPart ? -1 : 1;
    }
  }
  return 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Validate a single raw entry; returns null when it cannot be rendered safely. */
function normalizeEntry(raw: unknown): WhatsNewAnnouncement | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const entry = raw as Record<string, unknown>;
  if (!isNonEmptyString(entry.id) || !isNonEmptyString(entry.title) || !isValidVersion(entry.version)) {
    return null;
  }
  const highlightsRaw = entry.highlights;
  if (highlightsRaw !== undefined && !Array.isArray(highlightsRaw)) {
    return null;
  }
  const highlights = Array.isArray(highlightsRaw)
    ? highlightsRaw.filter(isNonEmptyString).map((text) => text.trim())
    : [];
  const normalized: WhatsNewAnnouncement = {
    id: entry.id.trim(),
    version: entry.version.trim().replace(/^v/i, ''),
    title: entry.title.trim(),
    highlights,
  };
  if (isNonEmptyString(entry.date)) {
    normalized.date = entry.date.trim();
  }
  // Hebrew block is optional and lenient: a malformed Hebrew field never drops
  // the entry, it just falls back to English only.
  if (isNonEmptyString(entry.titleHe)) {
    normalized.titleHe = entry.titleHe.trim();
  }
  if (Array.isArray(entry.highlightsHe)) {
    const highlightsHe = entry.highlightsHe.filter(isNonEmptyString).map((text) => text.trim());
    if (highlightsHe.length > 0) {
      normalized.highlightsHe = highlightsHe;
    }
  }
  return normalized;
}

/**
 * Validate the bundled JSON: drop malformed entries, dedupe by id (first wins),
 * and sort newest first (version desc, then date desc, then file order).
 */
export function normalizeAnnouncements(raw: unknown): { valid: WhatsNewAnnouncement[]; invalidCount: number } {
  let list: unknown[] = [];
  if (Array.isArray(raw)) {
    list = raw;
  } else if (raw && typeof raw === 'object' && Array.isArray((raw as { announcements?: unknown }).announcements)) {
    list = (raw as { announcements: unknown[] }).announcements;
  }

  const seenIds = new Set<string>();
  const valid: WhatsNewAnnouncement[] = [];
  let invalidCount = 0;
  list.forEach((entry, fileIndex) => {
    const normalized = normalizeEntry(entry);
    if (!normalized) {
      invalidCount++;
      return;
    }
    if (seenIds.has(normalized.id)) {
      invalidCount++;
      return;
    }
    seenIds.add(normalized.id);
    valid.push({ ...normalized, ...({ __fileIndex: fileIndex } as object) } as WhatsNewAnnouncement);
  });

  // Stable newest-first ordering. The temporary __fileIndex keeps "later in the
  // file" ahead of "earlier in the file" when version and date tie.
  const withIndex = valid as Array<WhatsNewAnnouncement & { __fileIndex: number }>;
  withIndex.sort((a, b) => {
    const byVersion = compareVersions(b.version, a.version);
    if (byVersion !== 0) {
      return byVersion;
    }
    const byDate = (b.date ?? '').localeCompare(a.date ?? '');
    if (byDate !== 0) {
      return byDate;
    }
    return b.__fileIndex - a.__fileIndex;
  });

  const sorted = withIndex.map((entry) => {
    const { __fileIndex: _dropped, ...rest } = entry;
    return rest;
  });
  return { valid: sorted, invalidCount };
}

/** Valid announcements whose version is at or below the installed version, newest first. */
export function selectEligible(raw: unknown, currentVersion: string): WhatsNewAnnouncement[] {
  if (!isValidVersion(currentVersion)) {
    return [];
  }
  return normalizeAnnouncements(raw).valid.filter(
    (entry) => compareVersions(entry.version, currentVersion) <= 0,
  );
}

/** Union of two id lists, preserving first-seen order. */
export function unionIds(first: readonly string[], second: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const id of [...first, ...second]) {
    if (typeof id === 'string' && id.length > 0 && !seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}

/** Corruption-safe read of the persisted state (unknown shapes become empty sets). */
export function sanitizePersistedState(raw: unknown): WhatsNewPersistedState {
  const asObject = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const readIds = (value: unknown): string[] =>
    Array.isArray(value) ? unionIds([], value.filter((id): id is string => typeof id === 'string')) : [];
  return {
    knownIds: readIds(asObject.knownIds),
    dismissedIds: readIds(asObject.dismissedIds),
  };
}

/** Persisted state after the user dismissed the banner: every eligible id is acknowledged. */
export function dismissAllEligible(
  persisted: WhatsNewPersistedState,
  eligible: readonly WhatsNewAnnouncement[],
): WhatsNewPersistedState {
  const eligibleIds = eligible.map((entry) => entry.id);
  return {
    knownIds: unionIds(persisted.knownIds, eligibleIds),
    dismissedIds: unionIds(persisted.dismissedIds, eligibleIds),
  };
}

/**
 * The activation-time decision. Pure: the caller persists `nextPersisted`,
 * broadcasts `pending`, and attempts the toast when `shouldToast` is true.
 */
export function computeWhatsNewState(input: WhatsNewComputeInput): WhatsNewComputeResult {
  const persisted = sanitizePersistedState(input.persisted);
  const { valid, invalidCount } = normalizeAnnouncements(input.announcements);

  if (!isValidVersion(input.currentVersion)) {
    return {
      validVersion: false,
      eligible: [],
      newlyDiscovered: [],
      pending: [],
      nextPersisted: persisted,
      shouldToast: false,
      invalidEntryCount: invalidCount,
    };
  }

  const eligible = valid.filter((entry) => compareVersions(entry.version, input.currentVersion) <= 0);
  const eligibleIds = eligible.map((entry) => entry.id);
  const known = new Set(persisted.knownIds);
  const newlyDiscovered = eligible.filter((entry) => !known.has(entry.id));
  const knownIds = unionIds(persisted.knownIds, eligibleIds);

  // Fresh install: the user never saw an older version, so nothing is "new" to
  // them. Notifications off: honor it silently, and make sure re-enabling later
  // does not dump a backlog. Both cases acknowledge everything eligible.
  const suppress = !input.isExistingInstall || !input.notificationsEnabled;
  if (suppress) {
    return {
      validVersion: true,
      eligible,
      newlyDiscovered,
      pending: [],
      nextPersisted: { knownIds, dismissedIds: unionIds(persisted.dismissedIds, eligibleIds) },
      shouldToast: false,
      invalidEntryCount: invalidCount,
    };
  }

  const dismissed = new Set(persisted.dismissedIds);
  const pending = eligible.filter((entry) => !dismissed.has(entry.id)).slice(0, WHATS_NEW_MAX_BANNER_ITEMS);
  return {
    validVersion: true,
    eligible,
    newlyDiscovered,
    pending,
    nextPersisted: { knownIds, dismissedIds: persisted.dismissedIds },
    shouldToast: newlyDiscovered.length > 0,
    invalidEntryCount: invalidCount,
  };
}
