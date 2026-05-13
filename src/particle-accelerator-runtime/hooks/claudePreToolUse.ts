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
    updatedInput?: Record<string, unknown>;
  };
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
