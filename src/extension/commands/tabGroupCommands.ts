import * as vscode from 'vscode';
import type { TabManager } from '../session/TabManager';
import type { TabGroup, TabGroupStore } from '../session/TabGroupStore';
import type { TabGroupTreeNode } from '../views/TabGroupsTreeProvider';

const FOLDER_COLOR_PRESETS: Array<{ label: string; value: string }> = [
  { label: 'Blue', value: '#4A9FD9' },
  { label: 'Coral', value: '#E06C75' },
  { label: 'Green', value: '#98C379' },
  { label: 'Orange', value: '#D19A66' },
  { label: 'Purple', value: '#C678DD' },
  { label: 'Cyan', value: '#56B6C2' },
  { label: 'Gold', value: '#E5C07B' },
  { label: 'Brick', value: '#BE5046' },
];

function isGroupNode(arg: unknown): arg is TabGroupTreeNode & { kind: 'group' } {
  return !!arg && typeof arg === 'object' && (arg as TabGroupTreeNode).kind === 'group';
}

function isTabNode(arg: unknown): arg is TabGroupTreeNode & { kind: 'tab' } {
  return !!arg && typeof arg === 'object' && (arg as TabGroupTreeNode).kind === 'tab';
}

async function pickFolder(
  tabGroupStore: TabGroupStore,
  placeHolder: string,
  excludeId?: string
): Promise<TabGroup | null | undefined> {
  const groups = tabGroupStore.listGroups().filter((g) => g.id !== excludeId);
  type GroupItem = vscode.QuickPickItem & { group?: TabGroup; sentinel?: 'topLevel' | 'cancel' };
  const items: GroupItem[] = [
    { label: '$(symbol-namespace) Top level', description: 'No folder', sentinel: 'topLevel' },
    ...groups.map<GroupItem>((g) => ({
      label: `$(folder) ${g.label}`,
      description: g.parentId ? 'sub-folder' : 'folder',
      group: g,
    })),
  ];
  const picked = await vscode.window.showQuickPick<GroupItem>(items, { placeHolder, ignoreFocusOut: true });
  if (!picked) {
    return undefined;
  }
  if (picked.sentinel === 'topLevel') {
    return null;
  }
  return picked.group;
}

export function registerTabGroupCommands(
  context: vscode.ExtensionContext,
  tabManager: TabManager,
  tabGroupStore: TabGroupStore,
  log: (msg: string) => void
): void {
  context.subscriptions.push(
    // Focus a tab from the TreeView
    vscode.commands.registerCommand('claudeMirror.tabs.focus', (tabId: string) => {
      tabManager.focusTab(tabId);
    }),

    // Create a top-level folder
    vscode.commands.registerCommand('claudeMirror.groups.create', async () => {
      const label = await vscode.window.showInputBox({
        prompt: 'New folder name',
        placeHolder: 'e.g. Refactor work',
      });
      if (!label) return;
      const group = await tabGroupStore.createGroup({ label });
      log(`[TabGroups] Created folder "${group.label}" id=${group.id}`);
    }),

    // Create a sub-folder under the right-clicked folder (or prompted one)
    vscode.commands.registerCommand('claudeMirror.groups.createSubfolder', async (arg?: unknown) => {
      let parentId: string | undefined;
      if (isGroupNode(arg)) {
        parentId = arg.group.id;
      } else {
        const parent = await pickFolder(tabGroupStore, 'Pick a parent folder');
        if (parent === undefined) return;
        parentId = parent ? parent.id : undefined;
      }
      const label = await vscode.window.showInputBox({
        prompt: 'New sub-folder name',
        placeHolder: 'e.g. Hotfixes',
      });
      if (!label) return;
      const group = await tabGroupStore.createGroup({ label, parentId });
      log(`[TabGroups] Created sub-folder "${group.label}" parent=${parentId ?? '(top)'}`);
    }),

    // Rename a folder
    vscode.commands.registerCommand('claudeMirror.groups.rename', async (arg?: unknown) => {
      let target: TabGroup | undefined;
      if (isGroupNode(arg)) {
        target = arg.group;
      } else {
        const picked = await pickFolder(tabGroupStore, 'Pick a folder to rename');
        if (picked === undefined || picked === null) return;
        target = picked;
      }
      if (!target) return;
      const next = await vscode.window.showInputBox({
        prompt: 'Rename folder',
        value: target.label,
      });
      if (!next || next === target.label) return;
      await tabGroupStore.renameGroup(target.id, next);
    }),

    // Change a folder's color
    vscode.commands.registerCommand('claudeMirror.groups.changeColor', async (arg?: unknown) => {
      let target: TabGroup | undefined;
      if (isGroupNode(arg)) {
        target = arg.group;
      } else {
        const picked = await pickFolder(tabGroupStore, 'Pick a folder to recolor');
        if (picked === undefined || picked === null) return;
        target = picked;
      }
      if (!target) return;
      const choice = await vscode.window.showQuickPick(
        FOLDER_COLOR_PRESETS.map((p) => ({ label: p.label, description: p.value, value: p.value })),
        { placeHolder: `Pick a color for "${target.label}"` }
      );
      if (!choice) return;
      await tabGroupStore.setGroupColor(target.id, choice.value);
    }),

    // Delete a folder (cascade close tabs vs reparent)
    vscode.commands.registerCommand('claudeMirror.groups.delete', async (arg?: unknown) => {
      let target: TabGroup | undefined;
      if (isGroupNode(arg)) {
        target = arg.group;
      } else {
        const picked = await pickFolder(tabGroupStore, 'Pick a folder to delete');
        if (picked === undefined || picked === null) return;
        target = picked;
      }
      if (!target) return;

      const action = await vscode.window.showQuickPick(
        [
          {
            label: '$(close-all) Close all tabs inside',
            description: 'Closes every tab in this folder and its sub-folders',
            value: 'cascade' as const,
          },
          {
            label: '$(arrow-up) Move tabs to parent',
            description: 'Lifts tabs and sub-folders one level up before deleting',
            value: 'reparent' as const,
          },
          { label: '$(circle-slash) Cancel', value: 'cancel' as const },
        ],
        { placeHolder: `Delete folder "${target.label}"?`, ignoreFocusOut: true }
      );
      if (!action || action.value === 'cancel') return;

      const allTabs = tabManager.listTabs();
      // Collect tab ids inside the folder *before* the delete mutates state.
      const descendantGroupIds = new Set<string>([target.id]);
      const collectDescendants = (gid: string) => {
        for (const g of tabGroupStore.listGroups()) {
          if (g.parentId === gid && !descendantGroupIds.has(g.id)) {
            descendantGroupIds.add(g.id);
            collectDescendants(g.id);
          }
        }
      };
      collectDescendants(target.id);
      const tabsInside = allTabs.filter((t) => t.groupId && descendantGroupIds.has(t.groupId));

      const result = await tabGroupStore.deleteGroup(target.id, action.value);

      if (action.value === 'cascade') {
        for (const t of tabsInside) {
          tabManager.closeTab(t.id);
        }
      } else {
        // Reparent: lift tabs from the deleted folder to its parent (or top level).
        const newParent = result.reparentedTo ?? null;
        for (const t of tabsInside) {
          if (t.groupId === target.id) {
            await tabManager.moveTabToGroup(t.id, newParent);
          }
        }
      }
      log(`[TabGroups] Deleted folder ${target.id} mode=${action.value} tabsTouched=${tabsInside.length}`);
    }),

    // Move a tab into a folder (right-click on a tab in the tree, or pick from quick-pick)
    vscode.commands.registerCommand('claudeMirror.tabs.moveToGroup', async (arg?: unknown) => {
      let tabId: string | undefined;
      if (isTabNode(arg)) {
        tabId = arg.tab.id;
      } else {
        const tabs = tabManager.listTabs();
        const picked = await vscode.window.showQuickPick(
          tabs.map((t) => ({
            label: `$(comment-discussion) ${t.displayName}`,
            description: t.provider,
            tabId: t.id,
          })),
          { placeHolder: 'Pick a tab to move' }
        );
        if (!picked) return;
        tabId = picked.tabId;
      }
      const group = await pickFolder(tabGroupStore, 'Move tab to which folder?');
      if (group === undefined) return;
      await tabManager.moveTabToGroup(tabId, group ? group.id : null);
    }),

    // Remove a tab from its folder (back to top-level)
    vscode.commands.registerCommand('claudeMirror.tabs.removeFromGroup', async (arg?: unknown) => {
      let tabId: string | undefined;
      if (isTabNode(arg)) {
        tabId = arg.tab.id;
      } else {
        const tabs = tabManager.listTabs().filter((t) => !!t.groupId);
        if (tabs.length === 0) {
          vscode.window.showInformationMessage('No tabs are currently in a folder.');
          return;
        }
        const picked = await vscode.window.showQuickPick(
          tabs.map((t) => ({
            label: `$(comment-discussion) ${t.displayName}`,
            description: t.groupId ? tabGroupStore.getGroup(t.groupId)?.label ?? '(unknown folder)' : '',
            tabId: t.id,
          })),
          { placeHolder: 'Pick a tab to remove from its folder' }
        );
        if (!picked) return;
        tabId = picked.tabId;
      }
      await tabManager.moveTabToGroup(tabId, null);
    }),

    // Editor-tab right-click entry: move the currently active ClaUi tab to a folder.
    // The `editor/title/context` menu fires on whichever tab the user right-clicks;
    // VS Code activates that tab before opening the menu, so getActiveTab() points
    // at the right thing by the time the handler runs.
    vscode.commands.registerCommand('claudeMirror.tabs.moveActiveToGroup', async () => {
      const active = tabManager.getActiveTab();
      if (!active) {
        vscode.window.showWarningMessage('No active ClaUi tab.');
        return;
      }
      const group = await pickFolder(tabGroupStore, `Move "${(active as { displayName?: string }).displayName ?? 'tab'}" to which folder?`);
      if (group === undefined) return;
      await tabManager.moveTabToGroup(active.id, group ? group.id : null);
      log(`[TabGroups] moveActiveToGroup tab=${active.id} -> group=${group ? group.id : '(top)'}`);
    }),

    // Editor-tab right-click entry: lift the active ClaUi tab back to top level.
    vscode.commands.registerCommand('claudeMirror.tabs.removeActiveFromGroup', async () => {
      const active = tabManager.getActiveTab();
      if (!active) {
        vscode.window.showWarningMessage('No active ClaUi tab.');
        return;
      }
      const currentGroupId = tabManager.getTabGroup(active.id);
      if (!currentGroupId) {
        vscode.window.showInformationMessage('This tab is already at the top level.');
        return;
      }
      await tabManager.moveTabToGroup(active.id, null);
      log(`[TabGroups] removeActiveFromGroup tab=${active.id}`);
    }),

    // Sessions view title-bar gear: opens a menu for tab-layout settings.
    // Currently exposes the horizontal/vertical toggle; designed to host
    // future view-level settings without re-cluttering the title bar.
    vscode.commands.registerCommand('claudeMirror.tabs.openLayoutMenu', async () => {
      const config = vscode.workspace.getConfiguration('claudeMirror.tabs');
      const current = config.get<'horizontal' | 'vertical'>('layout', 'horizontal');
      type LayoutItem = vscode.QuickPickItem & { value: 'horizontal' | 'vertical' };
      const items: LayoutItem[] = [
        {
          label: `${current === 'horizontal' ? '$(check)' : '$(blank)'} Horizontal layout`,
          description: 'All tabs in a single editor group (one row of native tabs)',
          value: 'horizontal',
        },
        {
          label: `${current === 'vertical' ? '$(check)' : '$(blank)'} Vertical layout`,
          description: 'Tabs distributed across stacked editor groups (up to 4 rows)',
          value: 'vertical',
        },
      ];
      const picked = await vscode.window.showQuickPick<LayoutItem>(items, {
        placeHolder: 'Choose how ClaUi tabs are arranged in the editor area',
        title: 'ClaUi: Tab Layout',
        ignoreFocusOut: true,
      });
      if (!picked || picked.value === current) {
        return;
      }
      await config.update('layout', picked.value, vscode.ConfigurationTarget.Global);
      await tabManager.applyTabLayout(picked.value);
      log(`[TabLayout] Switched to "${picked.value}" via title-bar gear`);
    })
  );
}
