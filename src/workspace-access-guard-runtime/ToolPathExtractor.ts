import { ToolPathExtractionInput, ToolPathExtractionResult } from '../shared/workspace-access-guard/types';

const PATH_FIELD_NAMES = new Set([
  'file_path', 'path', 'paths', 'dir', 'directory', 'root', 'cwd',
  'patternRoot', 'target', 'source', 'destination', 'filePath',
  'old_file_path', 'new_file_path',
]);

const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'ListDir']);
const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'apply_patch']);
const SEARCH_TOOLS = new Set(['Grep', 'Glob']);

const WIN_ABS_RE = /^[A-Za-z]:[\\\/]/;
const GIT_BASH_RE = /^\/[a-zA-Z]\//;
const WSL_RE = /^\/mnt\/[a-zA-Z]\//;
const RELATIVE_RE = /^\.\.?[\/\\]/;
const TILDE_RE = /^~[\/\\]/;
const WIN_ENV_RE = /^%[A-Za-z_]+%/;
const UNIX_ENV_RE = /^\$[A-Za-z_]/;
const UNC_RE = /^\\\\[^\\]+\\/;

export function extractToolPaths(input: ToolPathExtractionInput): ToolPathExtractionResult {
  const { provider, toolName, toolInput } = input;
  const paths: string[] = [];

  const baseTool = toolName.replace(/^mcp__[^_]+__/, '');
  const isMcp = toolName.startsWith('mcp__');

  let operation: ToolPathExtractionResult['operation'] = 'unknown';
  let confidence: ToolPathExtractionResult['confidence'] = 'high';

  if (READ_TOOLS.has(baseTool)) {
    operation = SEARCH_TOOLS.has(baseTool) ? 'search' : 'read';
  } else if (WRITE_TOOLS.has(baseTool)) {
    operation = 'write';
  } else if (baseTool === 'LS' || baseTool === 'ListDir') {
    operation = 'list';
  } else if (isMcp) {
    operation = 'mcp';
    confidence = 'medium';
  }

  if (toolInput && typeof toolInput === 'object') {
    const obj = toolInput as Record<string, unknown>;
    extractPathsFromObject(obj, paths, 0);
  }

  if (isMcp && toolInput && typeof toolInput === 'object') {
    extractPathLikeStrings(toolInput as Record<string, unknown>, paths, 0);
  }

  const deduplicated = [...new Set(paths)];

  return { paths: deduplicated, operation, confidence };
}

function extractPathsFromObject(
  obj: Record<string, unknown>,
  paths: string[],
  depth: number,
): void {
  if (depth > 10) return;

  for (const [key, value] of Object.entries(obj)) {
    if (PATH_FIELD_NAMES.has(key)) {
      if (typeof value === 'string' && value.trim()) {
        paths.push(value.trim());
      } else if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === 'string' && item.trim()) {
            paths.push(item.trim());
          }
        }
      }
    }

    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      extractPathsFromObject(value as Record<string, unknown>, paths, depth + 1);
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
          extractPathsFromObject(item as Record<string, unknown>, paths, depth + 1);
        }
      }
    }
  }
}

function extractPathLikeStrings(
  obj: Record<string, unknown>,
  paths: string[],
  depth: number,
): void {
  if (depth > 10) return;

  for (const value of Object.values(obj)) {
    if (typeof value === 'string' && looksLikeFilePath(value)) {
      if (!paths.includes(value.trim())) {
        paths.push(value.trim());
      }
    } else if (typeof value === 'object' && value !== null) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === 'string' && looksLikeFilePath(item)) {
            if (!paths.includes(item.trim())) {
              paths.push(item.trim());
            }
          } else if (typeof item === 'object' && item !== null) {
            extractPathLikeStrings(item as Record<string, unknown>, paths, depth + 1);
          }
        }
      } else {
        extractPathLikeStrings(value as Record<string, unknown>, paths, depth + 1);
      }
    }
  }
}

function looksLikeFilePath(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 1024) return false;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return false;

  return (
    WIN_ABS_RE.test(trimmed) ||
    GIT_BASH_RE.test(trimmed) ||
    WSL_RE.test(trimmed) ||
    RELATIVE_RE.test(trimmed) ||
    TILDE_RE.test(trimmed) ||
    WIN_ENV_RE.test(trimmed) ||
    UNIX_ENV_RE.test(trimmed) ||
    UNC_RE.test(trimmed)
  );
}
