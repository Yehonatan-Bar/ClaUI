import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { listInstances, normalizePathForCompare } from '../remote-control-shared/instanceRegistry';
import { ERROR_CODES, RemoteControlError } from '../remote-control-shared/protocol';
import type { InstanceClient } from './instanceClient';

/**
 * Tools executed by the stdio runtime itself (scope 'local' in the catalog):
 * they manage which VS Code window receives calls, and can open a new one.
 */

export const LOCAL_TOOL_NAMES = new Set(['list_instances', 'select_instance', 'open_vscode_window']);

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function runLocalTool(
  client: InstanceClient,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case 'list_instances': {
      const live = await client.listLive();
      let selectedId: string | null = null;
      try {
        selectedId = (await client.resolve()).instanceId;
      } catch {
        selectedId = null;
      }
      return {
        selectedInstanceId: selectedId,
        instances: live.map((i) => ({
          instanceId: i.instanceId,
          selected: i.instanceId === selectedId,
          reachable: i.reachable,
          workspaceName: i.workspaceName,
          workspaceFolders: i.workspaceFolders,
          port: i.port,
          pid: i.pid,
          extensionVersion: i.extensionVersion,
          accessLevel: i.status?.accessLevel ?? i.accessLevel,
          tabCount: i.status?.tabCount,
          lastFocusedAt: i.lastFocusedAt ?? i.startedAt,
        })),
      };
    }
    case 'select_instance': {
      const info = await client.select(String(args.instance ?? ''));
      return { selectedInstanceId: info.instanceId, workspaceName: info.workspaceName, workspaceFolders: info.workspaceFolders };
    }
    case 'open_vscode_window':
      return openVsCodeWindow(client, args);
    default:
      throw new RemoteControlError(ERROR_CODES.notFound, `Unknown local tool: ${name}`);
  }
}

async function openVsCodeWindow(client: InstanceClient, args: Record<string, unknown>): Promise<unknown> {
  const folder = path.resolve(String(args.folder ?? ''));
  if (!path.isAbsolute(String(args.folder ?? ''))) {
    throw new RemoteControlError(ERROR_CODES.invalidArgs, 'folder must be an absolute path');
  }
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
    throw new RemoteControlError(ERROR_CODES.notFound, `Folder does not exist: ${folder}`);
  }
  if (/["\r\n%]/.test(folder)) {
    throw new RemoteControlError(ERROR_CODES.invalidArgs, 'folder contains characters that cannot be passed safely to the `code` command');
  }
  const timeoutSec = typeof args.timeoutSec === 'number' ? Math.min(600, Math.max(5, args.timeoutSec)) : 90;
  const codeCli = process.env.CLAUI_CODE_CLI || 'code';

  // `code` is a .cmd shim on Windows, which needs a shell; the folder is quoted
  // and was validated above (no quotes / percent / newlines).
  await new Promise<void>((resolve, reject) => {
    const child =
      process.platform === 'win32'
        ? spawn(`"${codeCli}" --new-window "${folder}"`, { shell: true, detached: true, stdio: 'ignore', windowsHide: true })
        : spawn(codeCli, ['--new-window', folder], { detached: true, stdio: 'ignore' });
    child.once('error', (err) =>
      reject(new RemoteControlError(ERROR_CODES.unsupported, `Could not run "${codeCli}": ${err.message}. Is the VS Code \`code\` command on PATH? (or set CLAUI_CODE_CLI)`)),
    );
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });

  const target = normalizePathForCompare(folder);
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    const match = listInstances().find((i) => i.workspaceFolders.some((f) => normalizePathForCompare(f) === target));
    if (match && (await client.probe(match))) {
      await client.select(match.instanceId);
      return { opened: folder, selectedInstanceId: match.instanceId, workspaceName: match.workspaceName };
    }
    await sleep(1000);
  }
  return {
    opened: folder,
    selectedInstanceId: null,
    note: 'VS Code was launched, but no ClaUi Remote Control instance appeared for that folder in time. ' +
      'Check that ClaUi is installed and claudeMirror.remoteControl.enabled is on (user settings).',
  };
}
