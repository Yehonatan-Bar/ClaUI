import * as fs from 'fs';
import { classifyCommand } from '../CommandEligibility';
import { CompositeSecretScanner } from '../../shared/secret-protection/scanners/CompositeSecretScanner';
import type { DlpException, SecretProtectionSettings } from '../../shared/secret-protection/types';
import { PolicyEngine } from '../../shared/secret-protection/PolicyEngine';
import { DEFAULT_POLICY } from '../../shared/secret-protection/policySchema';
import { ApprovalEngine } from '../../server/enforcement/ApprovalEngine';

interface HookInput {
  tool_name: string;
  tool_input: Record<string, unknown>;
}

interface HookOutput {
  hookSpecificOutput: {
    hookEventName: string;
    permissionDecision: string;
    permissionDecisionReason: string;
  };
}

function scanMcpArgs(input: HookInput): HookOutput | null {
  if (process.env.CLAUI_SECRET_PROTECTION !== '1') return null;
  if (process.env.CLAUI_SECRET_PROTECTION_SCAN_MCP === 'false') return null;
  const mode = process.env.CLAUI_SECRET_PROTECTION_MODE ?? 'balanced';
  if (mode === 'off') return null;

  const toolName = input.tool_name;
  const argsStr = JSON.stringify(input.tool_input ?? {});

  try {
    const spSettings: SecretProtectionSettings = {
      enabled: true,
      mode: mode as SecretProtectionSettings['mode'],
      blockProtectedPaths: true,
      scanPrompts: false,
      scanTerminalOutput: false,
      scanGitPublication: false,
      scanMcp: process.env.CLAUI_SECRET_PROTECTION_SCAN_MCP !== 'false',
      requireBrowserCaptureApproval: false,
      exceptionMaxMinutes: 30,
      auditRetentionDays: 90,
      enableEntropyScanner: process.env.CLAUI_SECRET_PROTECTION_ENTROPY === 'true',
    };
    const scanner = new CompositeSecretScanner(spSettings);
    const result = scanner.scan(`${toolName}: ${argsStr}`, {
      boundary: 'mcp.request',
      destination: { kind: 'mcp_server', trustTier: 'unknown_remote' },
    });

    if (result.findings.length > 0) {
      const boundary = 'mcp.request' as const;
      const destination = { kind: 'mcp_server' as const, trustTier: 'unknown_remote' as const };

      let exceptions: DlpException[] = [];
      const exceptionPath = process.env.CLAUI_SECRET_PROTECTION_EXCEPTIONS_PATH;
      if (exceptionPath) {
        try {
          const raw = fs.readFileSync(exceptionPath, 'utf-8');
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            const now = new Date();
            exceptions = parsed.filter((e: DlpException) =>
              e && typeof e.expiresAt === 'string' &&
              new Date(e.expiresAt) > now &&
              typeof e.usedCount === 'number' &&
              typeof e.maxUses === 'number' &&
              e.usedCount < e.maxUses
            );
          }
        } catch { /* no exceptions available */ }
      }

      const policy = new PolicyEngine({ ...DEFAULT_POLICY, mode: spSettings.mode });
      const baseDecision = policy.evaluate(
        boundary,
        destination,
        result.findings,
        exceptions,
        'hook-runtime',
      );
      const approval = new ApprovalEngine({ mode: spSettings.mode }).evaluate(
        boundary,
        destination,
        result.findings,
        baseDecision,
        exceptions,
      );

      if (!approval.allowed) {
        return {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: `ClaUi Secret Protection ${approval.action} for MCP tool "${toolName}": ${approval.reason}`,
          },
        };
      }

      const toConsume = approval.consumedExceptions ?? (approval.exception ? [approval.exception] : []);
      if (toConsume.length > 0 && exceptionPath) {
        try {
          const raw = fs.readFileSync(exceptionPath, 'utf-8');
          const all: DlpException[] = JSON.parse(raw);
          let changed = false;
          for (const consumed of toConsume) {
            const idx = all.findIndex((e: DlpException) => e.id === consumed.id);
            if (idx >= 0) {
              all[idx] = { ...all[idx], usedCount: all[idx].usedCount + 1 };
              changed = true;
            }
          }
          if (changed) {
            fs.writeFileSync(exceptionPath, JSON.stringify(all, null, 2), 'utf-8');
          }
        } catch { /* best-effort consumption */ }
      }
    }
  } catch {
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `ClaUi Secret Protection could not scan MCP tool "${toolName}" and blocked it fail-closed.`,
      },
    };
  }
  return null;
}

async function main(): Promise<void> {
  const chunks: Buffer[] = [];

  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }

  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) {
    process.exit(0);
    return;
  }

  let input: HookInput;
  try {
    input = JSON.parse(raw);
  } catch {
    process.exit(0);
    return;
  }

  // MCP tool scanning runs independently of PA (only needs Secret Protection)
  if (input.tool_name.startsWith('mcp__')) {
    const blocked = scanMcpArgs(input);
    if (blocked) {
      process.stdout.write(JSON.stringify(blocked));
      return;
    }
    process.exit(0);
    return;
  }

  // PA kill-switch: Bash interception requires PA to be enabled
  if (process.env.CLAUI_PARTICLE_ACCELERATOR !== '1') {
    process.exit(0);
    return;
  }

  // Only intercept Bash tool
  if (input.tool_name !== 'Bash') {
    process.exit(0);
    return;
  }

  const command = String(input.tool_input?.command ?? '');
  if (!command) {
    process.exit(0);
    return;
  }

  // Don't re-deny already-wrapped commands
  if (command.startsWith('claui-run') || command.includes('CLAUI_PARTICLE_ACCELERATOR_BYPASS=1')) {
    process.exit(0);
    return;
  }

  const result = classifyCommand(command);
  if (!result.eligible) {
    process.exit(0);
    return;
  }

  // Base64url encode the original command
  const encoded = Buffer.from(command, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  // Codex: deny with retry instruction
  const output: HookOutput = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `This command should be routed through ClaUi local compression. Retry exactly as: claui-run --claui-encoded-shell-command ${encoded}`,
    },
  };

  process.stdout.write(JSON.stringify(output));
}

main().catch(() => {
  process.exit(0);
});
