import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';

/**
 * Installs bundled SR-PTD skill files to ~/.claude/skills/sr-ptd-skill/
 * Copies only if target SKILL.md is missing or has a different file size
 * (avoids overwriting user customizations unless bundled version changed).
 */
export async function installSkillFiles(
  extensionPath: string,
  log: (msg: string) => void
): Promise<void> {
  try {
    const sourceDir = path.join(extensionPath, 'sr-ptd-skill');
    const targetDir = path.join(os.homedir(), '.claude', 'skills', 'sr-ptd-skill');

    // Check if source exists (bundled with extension)
    if (!fs.existsSync(sourceDir)) {
      log('[SrPtdBootstrap] Bundled sr-ptd-skill directory not found, skipping install');
      return;
    }

    // Check if target already exists and is up-to-date
    const sourceSkillMd = path.join(sourceDir, 'SKILL.md');
    const targetSkillMd = path.join(targetDir, 'SKILL.md');
    if (fs.existsSync(targetSkillMd)) {
      const sourceSize = fs.statSync(sourceSkillMd).size;
      const targetSize = fs.statSync(targetSkillMd).size;
      if (sourceSize === targetSize) {
        log('[SrPtdBootstrap] SR-PTD skill already installed and up-to-date');
        return;
      }
      log('[SrPtdBootstrap] SR-PTD skill version changed, updating...');
    }

    // Create target directories
    const subdirs = ['assets', 'references'];
    fs.mkdirSync(targetDir, { recursive: true });
    for (const sub of subdirs) {
      fs.mkdirSync(path.join(targetDir, sub), { recursive: true });
    }

    // Copy all files
    const filesToCopy = [
      'SKILL.md',
      'CLAUDE_MD_INSTRUCTIONS.md',
      path.join('assets', 'full-template.md'),
      path.join('assets', 'quick-template.md'),
      path.join('references', 'example-completed.md'),
    ];

    for (const relPath of filesToCopy) {
      const src = path.join(sourceDir, relPath);
      const dst = path.join(targetDir, relPath);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dst);
      }
    }

    log('[SrPtdBootstrap] SR-PTD skill installed to ' + targetDir);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`[SrPtdBootstrap] Failed to install skill files: ${msg}`);
  }
}

/**
 * Injects SR-PTD documentation instructions into the project-level CLAUDE.md.
 * Creates the file if it doesn't exist. Skips if the marker text is already present.
 */
export async function injectClaudeMdInstructions(
  docsDirectory: string,
  log: (msg: string) => void
): Promise<void> {
  try {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      log('[SrPtdBootstrap] No workspace folder open, skipping CLAUDE.md injection');
      return;
    }

    const workspaceRoot = workspaceFolders[0].uri.fsPath;
    const claudeMdPath = path.join(workspaceRoot, 'CLAUDE.md');
    const MARKER = 'MANDATORY: Post-Task Documentation (SR-PTD)';

    // Check for existing injection
    if (fs.existsSync(claudeMdPath)) {
      const existing = fs.readFileSync(claudeMdPath, 'utf-8');
      if (existing.includes(MARKER)) {
        log('[SrPtdBootstrap] SR-PTD instructions already present in CLAUDE.md');
        return;
      }
    }

    const template = buildInjectionTemplate(docsDirectory);

    if (fs.existsSync(claudeMdPath)) {
      fs.appendFileSync(claudeMdPath, '\n\n' + template + '\n', 'utf-8');
      log('[SrPtdBootstrap] SR-PTD instructions appended to existing CLAUDE.md');
    } else {
      fs.writeFileSync(claudeMdPath, template + '\n', 'utf-8');
      log('[SrPtdBootstrap] Created CLAUDE.md with SR-PTD instructions');
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`[SrPtdBootstrap] Failed to inject CLAUDE.md instructions: ${msg}`);
  }
}

function buildInjectionTemplate(docsDirectory: string): string {
  return `---

# MANDATORY: Post-Task Documentation (SR-PTD)

**CRITICAL: After completing ANY task that modifies files, you MUST invoke this skill:**

\`\`\`
Skill tool -> skill: "sr-ptd-skill"
\`\`\`

**This is NOT optional. Skipping this skill means the task is INCOMPLETE.**

When planning ANY development task, add as the FINAL item in your task list:
\`\`\`
[ ] Create SR-PTD documentation
\`\`\`

### Before Starting Any Task:
1. Create your task plan as usual
2. Add SR-PTD documentation as the last task item
3. This step is MANDATORY for: features, bug fixes, refactors, maintenance, research

### When Completing the SR-PTD Task:
1. Read \`~/.claude/skills/sr-ptd-skill/SKILL.md\` for full instructions
2. Choose template: Full (complex tasks) or Quick (simple tasks)
3. Create file: \`SR-PTD_YYYY-MM-DD_[task-id]_[description].md\`
4. Save to: \`${docsDirectory}\`
5. Fill all applicable sections thoroughly

### Task Completion Criteria:
A task is NOT complete until SR-PTD documentation exists.

### If Conversation Continues After Task:
Update the existing SR-PTD document instead of creating a new one.

---`.trim();
}
