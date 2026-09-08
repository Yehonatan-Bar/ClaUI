import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  WHATS_NEW_TOAST_ACTIONS,
  WhatsNewCore,
  type WhatsNewPorts,
  type WhatsNewToastAction,
} from '../../src/extension/whatsnew/whatsNewCore';
import type { WhatsNewStateMessage } from '../../src/extension/types/webview-messages';

interface HarnessOptions {
  currentVersion?: string;
  isExistingInstall?: boolean;
  notificationsEnabled?: boolean;
  persisted?: unknown;
  /** Values returned by successive readPersisted() calls before falling back to `persisted`. */
  readSequence?: unknown[];
  announcements?: unknown;
  toastChoice?: WhatsNewToastAction | undefined;
  receiptClaimed?: boolean;
}

function entry(id: string, version: string) {
  return { id, version, title: `Title ${id}`, highlights: [`Highlight ${id}`] };
}

/** Fake ports with call recording. */
function createHarness(options: HarnessOptions = {}) {
  const state = {
    persisted: options.persisted as unknown,
    readSequence: [...(options.readSequence ?? [])],
    notificationsEnabled: options.notificationsEnabled ?? true,
    toastChoice: options.toastChoice,
    receiptClaimed: options.receiptClaimed ?? true,
  };
  const calls = {
    toasts: [] as string[],
    receiptVersions: [] as string[],
    reveals: 0,
    changelogOpens: 0,
    infos: [] as string[],
    logs: [] as string[],
    writes: 0,
  };
  const sent = new Map<string, WhatsNewStateMessage[]>();

  const ports: WhatsNewPorts = {
    currentVersion: options.currentVersion ?? '0.1.229',
    isExistingInstall: options.isExistingInstall ?? true,
    loadAnnouncements: () => options.announcements ?? [entry('feature', '0.1.228')],
    getNotificationsEnabled: () => state.notificationsEnabled,
    readPersisted: () => (state.readSequence.length > 0 ? state.readSequence.shift() : state.persisted),
    writePersisted: async (next) => {
      calls.writes++;
      state.persisted = next;
    },
    claimToastReceipt: async (version) => {
      calls.receiptVersions.push(version);
      return state.receiptClaimed;
    },
    showToast: async (message) => {
      calls.toasts.push(message);
      return state.toastChoice;
    },
    revealChatTab: () => {
      calls.reveals++;
    },
    openChangelog: async () => {
      calls.changelogOpens++;
    },
    showInfo: (message) => {
      calls.infos.push(message);
    },
    log: (message) => {
      calls.logs.push(message);
    },
  };

  const core = new WhatsNewCore(ports);
  const attachTab = (tabId: string) => {
    sent.set(tabId, []);
    core.registerTab(tabId, (msg) => sent.get(tabId)!.push(msg));
  };
  const lastSent = (tabId: string) => {
    const messages = sent.get(tabId) ?? [];
    return messages[messages.length - 1];
  };
  return { core, calls, state, sent, attachTab, lastSent };
}

test('activation on an existing install: persists, broadcasts the banner, shows the toast once', async () => {
  const h = createHarness();
  h.attachTab('tab-1');
  await h.core.checkOnActivation();
  await h.core.whenIdle();

  assert.deepEqual(h.state.persisted, { knownIds: ['feature'], dismissedIds: [] });
  assert.deepEqual(h.lastSent('tab-1').items.map((a) => a.id), ['feature']);
  assert.equal(h.lastSent('tab-1').currentVersion, '0.1.229');
  assert.deepEqual(h.calls.receiptVersions, ['0.1.229']);
  assert.deepEqual(h.calls.toasts, ['ClaUi updated to 0.1.229: Title feature']);
});

test('fresh install: nothing broadcast, no toast, ids seeded as dismissed', async () => {
  const h = createHarness({ isExistingInstall: false });
  h.attachTab('tab-1');
  await h.core.checkOnActivation();
  await h.core.whenIdle();

  assert.deepEqual(h.calls.toasts, []);
  assert.deepEqual(h.lastSent('tab-1').items, []);
  assert.deepEqual(h.state.persisted, { knownIds: ['feature'], dismissedIds: ['feature'] });
});

test('receipt already claimed by another window: banner still shown, toast skipped', async () => {
  const h = createHarness({ receiptClaimed: false });
  h.attachTab('tab-1');
  await h.core.checkOnActivation();
  await h.core.whenIdle();

  assert.deepEqual(h.calls.toasts, []);
  assert.deepEqual(h.lastSent('tab-1').items.map((a) => a.id), ['feature']);
});

test('toast "Dismiss": persisted dismissal and empty broadcast to every tab', async () => {
  const h = createHarness({ toastChoice: WHATS_NEW_TOAST_ACTIONS.dismiss });
  h.attachTab('tab-1');
  h.attachTab('tab-2');
  await h.core.checkOnActivation();
  await h.core.whenIdle();

  assert.deepEqual(h.state.persisted, { knownIds: ['feature'], dismissedIds: ['feature'] });
  assert.deepEqual(h.lastSent('tab-1').items, []);
  assert.deepEqual(h.lastSent('tab-2').items, []);
});

test('toast "What\'s New": reveals a chat tab and keeps the banner; "Full changelog" opens it', async () => {
  const reveal = createHarness({ toastChoice: WHATS_NEW_TOAST_ACTIONS.whatsNew });
  reveal.attachTab('tab-1');
  await reveal.core.checkOnActivation();
  await reveal.core.whenIdle();
  assert.equal(reveal.calls.reveals, 1);
  assert.deepEqual(reveal.lastSent('tab-1').items.map((a) => a.id), ['feature']);

  const changelog = createHarness({ toastChoice: WHATS_NEW_TOAST_ACTIONS.changelog });
  await changelog.core.checkOnActivation();
  await changelog.core.whenIdle();
  assert.equal(changelog.calls.changelogOpens, 1);
});

test('toast closed without a choice: banner stays pending, nothing dismissed', async () => {
  const h = createHarness({ toastChoice: undefined });
  h.attachTab('tab-1');
  await h.core.checkOnActivation();
  await h.core.whenIdle();
  assert.deepEqual(h.state.persisted, { knownIds: ['feature'], dismissedIds: [] });
  assert.deepEqual(h.lastSent('tab-1').items.map((a) => a.id), ['feature']);
});

test('tab registered after activation receives the current banner immediately', async () => {
  const h = createHarness();
  await h.core.checkOnActivation();
  h.attachTab('late-tab');
  assert.deepEqual(h.lastSent('late-tab').items.map((a) => a.id), ['feature']);
  h.core.unregisterTab('late-tab');
  await h.core.dismiss();
  assert.equal(h.sent.get('late-tab')!.length, 1, 'unregistered tab gets no further messages');
});

test('notifications disabled: toast suppressed, everything acknowledged, later enable shows no backlog', async () => {
  const h = createHarness({ notificationsEnabled: false });
  h.attachTab('tab-1');
  await h.core.checkOnActivation();
  await h.core.whenIdle();
  assert.deepEqual(h.calls.toasts, []);
  assert.deepEqual(h.lastSent('tab-1').items, []);
  assert.deepEqual(h.state.persisted, { knownIds: ['feature'], dismissedIds: ['feature'] });

  h.state.notificationsEnabled = true;
  await h.core.resendTo('tab-1');
  assert.deepEqual(h.lastSent('tab-1').items, [], 'previously acknowledged entries do not come back');
});

test('setting turned off at runtime dismisses the banner everywhere', async () => {
  const h = createHarness();
  h.attachTab('tab-1');
  await h.core.checkOnActivation();
  h.state.notificationsEnabled = false;
  h.core.onNotificationsSettingChanged(false);
  await h.core.whenIdle();
  assert.deepEqual(h.lastSent('tab-1').items, []);
  assert.deepEqual(h.state.persisted, { knownIds: ['feature'], dismissedIds: ['feature'] });
});

test('dismiss called right after activation (not awaited) is serialized: final state is empty', async () => {
  const h = createHarness();
  h.attachTab('tab-1');
  void h.core.checkOnActivation();
  await h.core.dismiss();
  await h.core.whenIdle();
  assert.deepEqual(h.lastSent('tab-1').items, []);
  assert.deepEqual(h.state.persisted, { knownIds: ['feature'], dismissedIds: ['feature'] });
});

test('activation derives the banner from the committed state when another window dismissed mid-flight', async () => {
  // First read (compute): nothing dismissed. Second read (merge before write):
  // another window has dismissed in the meantime. The banner must stay hidden.
  const h = createHarness({
    readSequence: [undefined, { knownIds: ['feature'], dismissedIds: ['feature'] }],
  });
  h.attachTab('tab-1');
  await h.core.checkOnActivation();
  await h.core.whenIdle();
  assert.deepEqual(h.lastSent('tab-1').items, []);
  assert.deepEqual(h.state.persisted, { knownIds: ['feature'], dismissedIds: ['feature'] });
});

test('resendTo honors a dismissal persisted by another window', async () => {
  const h = createHarness();
  h.attachTab('tab-1');
  await h.core.checkOnActivation();
  assert.deepEqual(h.lastSent('tab-1').items.map((a) => a.id), ['feature']);

  // Another VS Code window wrote the dismissal into the shared globalState.
  h.state.persisted = { knownIds: ['feature'], dismissedIds: ['feature'] };
  await h.core.resendTo('tab-1');
  assert.deepEqual(h.lastSent('tab-1').items, []);
});

test('showLatest: forces the newest eligible entries even after dismissal, reveals a chat tab', async () => {
  const h = createHarness({ persisted: { knownIds: ['feature'], dismissedIds: ['feature'] } });
  h.attachTab('tab-1');
  await h.core.checkOnActivation();
  assert.deepEqual(h.lastSent('tab-1').items, []);

  await h.core.showLatest();
  assert.equal(h.calls.reveals, 1);
  assert.deepEqual(h.lastSent('tab-1').items.map((a) => a.id), ['feature']);

  await h.core.dismiss();
  assert.deepEqual(h.lastSent('tab-1').items, [], 'dismiss clears the forced view too');
});

test('showLatest on a dev build previews an upcoming entry; empty catalog shows an info message', async () => {
  const preview = createHarness({ currentVersion: '0.1.228', announcements: [entry('upcoming', '0.1.229')] });
  preview.attachTab('tab-1');
  await preview.core.showLatest();
  assert.deepEqual(preview.lastSent('tab-1').items.map((a) => a.id), ['upcoming']);

  const empty = createHarness({ announcements: [] });
  await empty.core.showLatest();
  assert.equal(empty.calls.infos.length, 1);
  assert.equal(empty.calls.reveals, 0);
});

test('invalid installed version: logs and does nothing, storage untouched', async () => {
  const h = createHarness({ currentVersion: 'dev', persisted: { knownIds: ['keep'], dismissedIds: [] } });
  h.attachTab('tab-1');
  await h.core.checkOnActivation();
  await h.core.whenIdle();
  assert.equal(h.calls.writes, 0);
  assert.deepEqual(h.calls.toasts, []);
  assert.ok(h.calls.logs.some((line) => line.includes('not a numeric version')));
});

test('a throwing tab sender never breaks the broadcast to other tabs', async () => {
  const h = createHarness();
  h.core.registerTab('broken', () => {
    throw new Error('webview gone');
  });
  h.attachTab('healthy');
  await h.core.checkOnActivation();
  assert.deepEqual(h.lastSent('healthy').items.map((a) => a.id), ['feature']);
  assert.ok(h.calls.logs.some((line) => line.includes('Failed to post state to tab broken')));
});
