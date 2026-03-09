import React from 'react';
import type { ToolCategory } from '../../../../state/store';
import ReadingCharacter from './ReadingCharacter';
import WritingCharacter from './WritingCharacter';
import EditingCharacter from './EditingCharacter';
import SearchingCharacter from './SearchingCharacter';
import ExecutingCharacter from './ExecutingCharacter';
import DelegatingCharacter from './DelegatingCharacter';
import PlanningCharacter from './PlanningCharacter';
import SkillCharacter from './SkillCharacter';
import DecidingCharacter from './DecidingCharacter';
import ResearchingCharacter from './ResearchingCharacter';

/** Category color palette */
export const CATEGORY_COLORS: Record<ToolCategory, string> = {
  reading: '#4caf50',
  writing: '#2196f3',
  editing: '#ff9800',
  searching: '#9c27b0',
  executing: '#00bcd4',
  delegating: '#e040fb',
  planning: '#689f38',
  skill: '#ffd700',
  deciding: '#5c6bc0',
  researching: '#26a69a',
};

/** Category display labels */
export const CATEGORY_LABELS: Record<ToolCategory, string> = {
  reading: 'Reading',
  writing: 'Writing',
  editing: 'Editing',
  searching: 'Searching',
  executing: 'Executing',
  delegating: 'Delegating',
  planning: 'Planning',
  skill: 'Skill',
  deciding: 'Deciding',
  researching: 'Researching',
};

/** Map category to its SVG character component */
export const CATEGORY_CHARACTERS: Record<ToolCategory, React.FC<{ color: string }>> = {
  reading: ReadingCharacter,
  writing: WritingCharacter,
  editing: EditingCharacter,
  searching: SearchingCharacter,
  executing: ExecutingCharacter,
  delegating: DelegatingCharacter,
  planning: PlanningCharacter,
  skill: SkillCharacter,
  deciding: DecidingCharacter,
  researching: ResearchingCharacter,
};

/** Map a tool name to its category */
export function toolToCategory(toolName: string): ToolCategory {
  const base = toolName.includes('__') ? toolName.split('__').pop()! : toolName;
  switch (base) {
    case 'Read':
      return 'reading';
    case 'Write':
      return 'writing';
    case 'Edit':
    case 'NotebookEdit':
    case 'MultiEdit':
      return 'editing';
    case 'Grep':
    case 'Glob':
      return 'searching';
    case 'Bash':
    case 'Terminal':
      return 'executing';
    case 'Agent':
    case 'Task':
    case 'dispatch_agent':
      return 'delegating';
    case 'TodoWrite':
      return 'planning';
    case 'Skill':
      return 'skill';
    case 'ExitPlanMode':
    case 'EnterPlanMode':
    case 'AskUserQuestion':
      return 'deciding';
    case 'WebFetch':
    case 'WebSearch':
      return 'researching';
    default:
      return 'executing';
  }
}

/** Parse a bash command string into a human-readable description */
function describeBashCommand(raw: string): string {
  // Strip leading "cd <path> &&" chains to get the real command
  const cmd = raw.trim().replace(/^(cd\s+\S+\s*&&\s*)+/i, '').trim();

  // npm run <script>
  const npmRun = cmd.match(/^npm\s+run\s+(\S+)/i);
  if (npmRun) return `Running: npm ${npmRun[1]}`;

  // npm install / npm ci
  if (/^npm\s+(install|ci|i)\b/i.test(cmd)) return 'Installing npm packages';

  // git operations
  if (/^git\s+commit/i.test(cmd)) return 'Committing changes to git';
  if (/^git\s+push/i.test(cmd)) return 'Pushing changes to remote';
  if (/^git\s+pull/i.test(cmd)) return 'Pulling latest changes';
  if (/^git\s+add/i.test(cmd)) return 'Staging files for commit';
  if (/^git\s+status/i.test(cmd)) return 'Checking git status';
  if (/^git\s+log/i.test(cmd)) return 'Viewing git history';
  if (/^git\s+diff/i.test(cmd)) return 'Viewing changes in git';
  if (/^git\s+checkout/i.test(cmd)) return 'Switching git branch';
  if (/^git\s+/i.test(cmd)) return 'Running git command';

  // Python
  const pyMatch = cmd.match(/^python\S*\s+(\S+)/i);
  if (pyMatch) return `Running: ${pyMatch[1].split(/[/\\]/).pop()}`;

  // Node
  const nodeMatch = cmd.match(/^node\s+(\S+)/i);
  if (nodeMatch) return `Running: ${nodeMatch[1].split(/[/\\]/).pop()}`;

  // PowerShell
  if (/^powershell/i.test(cmd)) return 'Running PowerShell script';

  // Webpack / build tools
  if (/\bwebpack\b/i.test(cmd)) return 'Running webpack build';
  if (/\btsc\b/.test(cmd)) return 'Compiling TypeScript';
  if (/\bvsce\b/i.test(cmd)) return 'Packaging VS Code extension';

  // File operations
  if (/^(rm|del|rmdir)\b/i.test(cmd)) return 'Removing files';
  if (/^(cp|copy)\b/i.test(cmd)) return 'Copying files';
  if (/^(mv|move)\b/i.test(cmd)) return 'Moving files';
  if (/^(mkdir|md)\b/i.test(cmd)) return 'Creating directory';
  if (/^(ls|dir)\b/i.test(cmd)) return 'Listing directory contents';
  if (/^(cat|type)\b/i.test(cmd)) return 'Reading file contents';

  // Fallback: show first meaningful part of the command, cleaned up
  const preview = cmd.slice(0, 45).replace(/\s+/g, ' ');
  return preview.length < cmd.length ? `Running: ${preview}...` : `Running: ${preview}`;
}

/** Generate a template-based fallback description */
export function templateDescription(toolName: string, filePath?: string, command?: string, pattern?: string): string {
  const base = toolName.includes('__') ? toolName.split('__').pop()! : toolName;
  const file = filePath ? ` ${filePath.split(/[/\\]/).pop()}` : '';
  const pat = pattern ? ` for "${pattern}"` : '';

  switch (base) {
    case 'Read':
      return `Reading${file || ' a file'}`;
    case 'Write':
      return `Writing${file || ' a file'}`;
    case 'Edit':
    case 'MultiEdit':
      return `Editing${file || ' a file'}`;
    case 'NotebookEdit':
      return `Editing notebook${file || ''}`;
    case 'Grep':
      return pattern ? `Searching for "${pattern}"` : 'Searching file contents';
    case 'Glob':
      return pattern ? `Finding files matching "${pattern}"` : 'Finding files';
    case 'Bash':
    case 'Terminal':
      return command ? describeBashCommand(command) : 'Running a terminal command';
    case 'Agent':
    case 'Task':
      return 'Launching a sub-agent';
    case 'dispatch_agent':
      return 'Dispatching an agent';
    case 'TodoWrite':
      return 'Updating the task list';
    case 'Skill':
      return 'Invoking a skill';
    case 'ExitPlanMode':
      return 'Plan ready — waiting for review';
    case 'EnterPlanMode':
      return 'Switching to plan mode';
    case 'AskUserQuestion':
      return 'Asking for your input';
    case 'WebFetch':
      return 'Fetching a web page';
    case 'WebSearch':
      return 'Searching the web';
    default:
      return `Using ${base}`;
  }
}
