import { classifyCommand } from '../CommandEligibility';

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

async function main(): Promise<void> {
  // Feature kill-switch: when the extension disables PA, it stops injecting this env var
  if (process.env.CLAUI_PARTICLE_ACCELERATOR !== '1') {
    process.exit(0);
    return;
  }

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
