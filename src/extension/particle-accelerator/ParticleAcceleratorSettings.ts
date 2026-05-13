import * as vscode from 'vscode';
import { ParticleAcceleratorSettings } from './ParticleAcceleratorTypes';

export type { ParticleAcceleratorSettings };

const SECTION = 'claudeMirror.particleAccelerator';

export function getParticleAcceleratorSettings(): ParticleAcceleratorSettings {
  const config = vscode.workspace.getConfiguration(SECTION);
  return {
    enabled: config.get<boolean>('enabled', false),
    filterProfile: config.get<'balanced' | 'strict' | 'verbose'>('filterProfile', 'balanced'),
    storeRawRedactedLogs: config.get<boolean>('storeRawRedactedLogs', true),
    rawLogRetentionDays: clamp(config.get<number>('rawLogRetentionDays', 7), 1, 90),
    maxRawLogMb: clamp(config.get<number>('maxRawLogMb', 100), 10, 5000),
    traceRetentionDays: clamp(config.get<number>('traceRetentionDays', 30), 1, 365),
    maxTraceCount: clamp(config.get<number>('maxTraceCount', 10000), 100, 100000),
    dailyReportRetentionDays: clamp(config.get<number>('dailyReportRetentionDays', 90), 7, 365),
    workspaceLocalStorage: config.get<boolean>('workspaceLocalStorage', false),
    installClaudeHook: config.get<boolean>('installClaudeHook', false),
    installCodexHook: config.get<boolean>('installCodexHook', false),
    codexMode: config.get<'off' | 'instruction-only' | 'hook-guard'>('codexMode', 'instruction-only'),
  };
}

export function onSettingsChanged(callback: (settings: ParticleAcceleratorSettings) => void): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration(SECTION)) {
      callback(getParticleAcceleratorSettings());
    }
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
