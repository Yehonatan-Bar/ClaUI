import { classifyCommand } from '../CommandEligibility';
import { CompositeSecretScanner } from '../../shared/secret-protection/scanners/CompositeSecretScanner';
import type { SecretProtectionSettings } from '../../shared/secret-protection/types';

interface HookInput {
  tool_name: string;
  tool_input: Record<string, unknown>;
}

interface HookOutput {
  hookSpecificOutput: {
    hookEventName: string;
    permissionDecision: string;
    permissionDecisionReason: string;
    updatedInput?: Record<string, unknown>;
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
      const hasCritical = result.findings.some(f => f.severity === 'critical' || f.severity === 'high');
      if (hasCritical && (mode === 'strict' || mode === 'balanced')) {
        return {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: `ClaUi Secret Protection blocked MCP tool "${toolName}": ${result.findings.length} secret(s) detected in arguments.`,
          },
        };
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

  // Don't re-wrap
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

  const rewritten = `claui-run --claui-encoded-shell-command ${encoded}`;

  // Build updatedInput preserving all original fields
  const updatedInput: Record<string, unknown> = { ...input.tool_input };
  updatedInput.command = rewritten;

  const output: HookOutput = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: 'Routing noisy Bash output through ClaUi local compression.',
      updatedInput,
    },
  };

  process.stdout.write(JSON.stringify(output));
}

main().catch(() => {
  // On any error, exit cleanly (allow command unchanged)
  process.exit(0);
});
