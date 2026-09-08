/**
 * "What's New" orchestration, independent of the VS Code API.
 *
 * Everything that touches VS Code (globalState, toasts, the receipt file,
 * revealing tabs, markdown preview) is injected through `WhatsNewPorts`, so the
 * whole lifecycle is unit-tested in tests/unit/whatsNewCore.test.ts and the
 * `WhatsNewService` adapter stays thin.
 *
 * All state mutations run through one promise queue: activation, dismissal,
 * the palette command, the setting toggle and per-tab resyncs cannot interleave
 * and resurrect a banner the user just dismissed.
 */
import type { WhatsNewAnnouncement, WhatsNewStateMessage } from '../types/webview-messages';
import {
  WHATS_NEW_MAX_BANNER_ITEMS,
  computeWhatsNewState,
  dismissAllEligible,
  normalizeAnnouncements,
  sanitizePersistedState,
  selectEligible,
  unionIds,
  type WhatsNewPersistedState,
} from './whatsNewLogic';

export const WHATS_NEW_TOAST_ACTIONS = {
  whatsNew: "What's New",
  changelog: 'Full changelog',
  dismiss: 'Dismiss',
} as const;

export type WhatsNewToastAction = (typeof WHATS_NEW_TOAST_ACTIONS)[keyof typeof WHATS_NEW_TOAST_ACTIONS];

/** Everything the core needs from the host. Implemented by WhatsNewService (VS Code) and by test fakes. */
export interface WhatsNewPorts {
  /** Installed extension version from the manifest. */
  readonly currentVersion: string;
  /** True when this machine already ran ClaUi before (upgrade), false on a brand-new install. */
  readonly isExistingInstall: boolean;
  /** Raw bundled announcements JSON. */
  loadAnnouncements(): unknown;
  /** The `claudeMirror.showWhatsNew` setting, read live. */
  getNotificationsEnabled(): boolean;
  /** Raw persisted state (may be undefined or corrupt). */
  readPersisted(): unknown;
  writePersisted(state: WhatsNewPersistedState): Promise<void>;
  /** At-most-once toast per version across VS Code windows. True = this window may show it. */
  claimToastReceipt(version: string): Promise<boolean>;
  /** Show the toast; resolves with the clicked action, or undefined when closed. */
  showToast(message: string, actions: readonly WhatsNewToastAction[]): Promise<WhatsNewToastAction | undefined>;
  /** Reveal (or create) an ordinary chat tab that can render the banner. */
  revealChatTab(): void;
  openChangelog(): Promise<void>;
  showInfo(message: string): void;
  log(message: string): void;
}

type StateSender = (msg: WhatsNewStateMessage) => void;

export class WhatsNewCore {
  private readonly senders = new Map<string, StateSender>();
  /** Announcements the banner currently shows because of the update flow. */
  private pending: WhatsNewAnnouncement[] = [];
  /** Palette-command override: shown regardless of dismissal/setting until dismissed. */
  private forced: WhatsNewAnnouncement[] | null = null;
  private queue: Promise<void> = Promise.resolve();
  private toastInFlight: Promise<void> | null = null;

  constructor(private readonly ports: WhatsNewPorts) {}

  // ---------------------------------------------------------------------------
  // Tab fan-out
  // ---------------------------------------------------------------------------

  /** Register a tab's sender and immediately sync it so late-opened tabs are never stale. */
  registerTab(tabId: string, sender: StateSender): void {
    this.senders.set(tabId, sender);
    this.safeSend(tabId, sender, this.stateMessage());
  }

  unregisterTab(tabId: string): void {
    this.senders.delete(tabId);
  }

  /**
   * Re-send the authoritative state to one tab. Called when a webview mounts
   * (first load, reload, or rebuild after deep hibernation, which drops the
   * activation broadcast). Re-reads storage so a dismissal made in another
   * VS Code window is honored.
   */
  resendTo(tabId: string): Promise<void> {
    return this.enqueue('resendTo', async () => {
      this.refreshPendingFromStorage();
      const sender = this.senders.get(tabId);
      if (sender) {
        this.safeSend(tabId, sender, this.stateMessage());
      }
    });
  }

  /** Current banner payload (forced palette view wins over the update flow). */
  stateMessage(): WhatsNewStateMessage {
    return {
      type: 'whatsNewState',
      items: (this.forced ?? this.pending).slice(0, WHATS_NEW_MAX_BANNER_ITEMS),
      currentVersion: this.ports.currentVersion,
    };
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /** Post-update check: persist, broadcast the banner, and attempt the one-time toast. */
  checkOnActivation(): Promise<void> {
    return this.enqueue('checkOnActivation', async () => {
      const { currentVersion } = this.ports;
      const result = computeWhatsNewState({
        announcements: this.ports.loadAnnouncements(),
        currentVersion,
        persisted: sanitizePersistedState(this.ports.readPersisted()),
        isExistingInstall: this.ports.isExistingInstall,
        notificationsEnabled: this.ports.getNotificationsEnabled(),
      });

      if (result.invalidEntryCount > 0) {
        this.ports.log(`[WhatsNew] Ignored ${result.invalidEntryCount} malformed announcement entr(y/ies) in announcements.json`);
      }
      if (!result.validVersion) {
        this.ports.log(`[WhatsNew] Skipped: installed version "${currentVersion}" is not a numeric version`);
        return;
      }

      // Derive the banner from the COMMITTED state, not from the pre-write
      // snapshot: another window may have dismissed between our read and write.
      const committed = await this.mergeAndWrite(result.nextPersisted);
      const committedDismissed = new Set(committed.dismissedIds);
      this.pending = result.pending.filter((entry) => !committedDismissed.has(entry.id));
      this.broadcast();
      this.ports.log(
        `[WhatsNew] version=${currentVersion} existingInstall=${this.ports.isExistingInstall} ` +
          `eligible=${result.eligible.length} new=${result.newlyDiscovered.length} ` +
          `pending=${result.pending.length} toast=${result.shouldToast}`,
      );

      if (!result.shouldToast) {
        return;
      }
      const claimed = await this.ports.claimToastReceipt(currentVersion);
      if (!claimed) {
        this.ports.log('[WhatsNew] Toast already shown for this version (another window claimed it)');
        return;
      }
      // The toast may stay open for minutes; do not hold the queue for it.
      const headline = result.newlyDiscovered[0];
      this.toastInFlight = this.showUpdateToast(currentVersion, headline).finally(() => {
        this.toastInFlight = null;
      });
    });
  }

  /** Dismiss: acknowledge every eligible entry, clear the banner in all tabs. */
  dismiss(): Promise<void> {
    return this.enqueue('dismiss', async () => {
      const persisted = sanitizePersistedState(this.ports.readPersisted());
      const eligible = selectEligible(this.ports.loadAnnouncements(), this.ports.currentVersion);
      await this.mergeAndWrite(dismissAllEligible(persisted, eligible));
      this.pending = [];
      this.forced = null;
      this.broadcast();
      this.ports.log('[WhatsNew] Dismissed');
    });
  }

  /**
   * Palette command "ClaUi: What's New": show the newest eligible entries even
   * if dismissed or the setting is off. Falls back to the newest bundled entry
   * when none is eligible yet, so a dev build can preview an upcoming release.
   */
  showLatest(): Promise<void> {
    return this.enqueue('showLatest', async () => {
      const { valid } = normalizeAnnouncements(this.ports.loadAnnouncements());
      const eligible = selectEligible(this.ports.loadAnnouncements(), this.ports.currentVersion);
      const items = eligible.length > 0 ? eligible.slice(0, WHATS_NEW_MAX_BANNER_ITEMS) : valid.slice(0, 1);
      if (items.length === 0) {
        this.ports.showInfo("ClaUi has no bundled What's New entries yet.");
        return;
      }
      this.forced = items;
      this.ports.revealChatTab();
      this.broadcast();
      this.ports.log(`[WhatsNew] Showing latest on request (${items.length} item(s))`);
    });
  }

  /** Setting toggled at runtime: turning it off hides and acknowledges the banner. */
  onNotificationsSettingChanged(enabled: boolean): void {
    if (!enabled) {
      void this.dismiss();
    }
  }

  /** Test helper: resolves when the queue and any open toast have settled. */
  async whenIdle(): Promise<void> {
    await this.queue;
    if (this.toastInFlight) {
      await this.toastInFlight;
    }
    await this.queue;
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async showUpdateToast(version: string, headline: WhatsNewAnnouncement): Promise<void> {
    try {
      const message = `ClaUi updated to ${version}: ${headline.title}`;
      const choice = await this.ports.showToast(message, [
        WHATS_NEW_TOAST_ACTIONS.whatsNew,
        WHATS_NEW_TOAST_ACTIONS.changelog,
        WHATS_NEW_TOAST_ACTIONS.dismiss,
      ]);
      if (choice === WHATS_NEW_TOAST_ACTIONS.whatsNew) {
        // The banner is already pending; just bring a chat tab into view.
        this.ports.revealChatTab();
        this.broadcast();
      } else if (choice === WHATS_NEW_TOAST_ACTIONS.changelog) {
        await this.ports.openChangelog();
      } else if (choice === WHATS_NEW_TOAST_ACTIONS.dismiss) {
        await this.dismiss();
      }
      // Closed without choosing: keep the banner pending until dismissed.
    } catch (err) {
      this.ports.log(`[WhatsNew] Toast handling failed: ${describeError(err)}`);
    }
  }

  /** Recompute `pending` from storage without discovering anything new (no toast). */
  private refreshPendingFromStorage(): void {
    if (this.forced) {
      return;
    }
    if (!this.ports.getNotificationsEnabled()) {
      this.pending = [];
      return;
    }
    const persisted = sanitizePersistedState(this.ports.readPersisted());
    const dismissed = new Set(persisted.dismissedIds);
    this.pending = selectEligible(this.ports.loadAnnouncements(), this.ports.currentVersion)
      .filter((entry) => !dismissed.has(entry.id))
      .slice(0, WHATS_NEW_MAX_BANNER_ITEMS);
  }

  /**
   * Union with the latest stored sets right before writing so concurrent
   * windows rarely lose ids, and return what was committed. (globalState has
   * no compare-and-set; a true write-write race between two windows can still
   * drop one side's ids, which at worst re-shows a dismissible banner once.)
   */
  private async mergeAndWrite(next: WhatsNewPersistedState): Promise<WhatsNewPersistedState> {
    const latest = sanitizePersistedState(this.ports.readPersisted());
    const merged: WhatsNewPersistedState = {
      knownIds: unionIds(latest.knownIds, next.knownIds),
      dismissedIds: unionIds(latest.dismissedIds, next.dismissedIds),
    };
    await this.ports.writePersisted(merged);
    return merged;
  }

  private broadcast(): void {
    const message = this.stateMessage();
    for (const [tabId, sender] of this.senders) {
      this.safeSend(tabId, sender, message);
    }
  }

  private safeSend(tabId: string, sender: StateSender, message: WhatsNewStateMessage): void {
    try {
      sender(message);
    } catch (err) {
      this.ports.log(`[WhatsNew] Failed to post state to tab ${tabId}: ${describeError(err)}`);
    }
  }

  private enqueue(label: string, work: () => Promise<void>): Promise<void> {
    const run = this.queue.then(work).catch((err) => {
      this.ports.log(`[WhatsNew] ${label} failed: ${describeError(err)}`);
    });
    this.queue = run;
    return run;
  }
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
