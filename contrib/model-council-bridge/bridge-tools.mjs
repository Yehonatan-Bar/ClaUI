#!/usr/bin/env node
// Tool plane for the bridge agent mode (used by zen-chat.mjs).
//
// The gateways expose OpenAI-compatible function calling and the models emit
// well-formed tool_calls — this module owns the schemas plus sandboxed
// implementations.
//
// Safety model: file tools run immediately but are confined to the tab's
// workspace root; `run_command` NEVER executes on its own. It parks behind a
// one-time code the user has to approve. Third-party free-tier models get
// shell access only through that human gate.

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

const MAX_READ_BYTES = 100 * 1024;
const MAX_RESULT_CHARS = 8000;
const MAX_WRITE_BYTES = 2 * 1024 * 1024;
const COMMAND_TIMEOUT_MS = Number(process.env.BRIDGE_COMMAND_TIMEOUT_MS || 120000);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '_tmp', 'venv', '__pycache__']);

/** Tool names whose results are safe to run without asking the user. */
export const AUTO_TOOLS = new Set(['read_file', 'write_file', 'edit_file', 'list_dir', 'search_files']);

export const BRIDGE_TOOL_SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a UTF-8 text file from the workspace. Use this before editing a file you did not just write.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path relative to the workspace root.' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description:
        'Create or overwrite a file with the given content. This is how you deliver code to the user — never paste a file into the chat and ask them to save it by hand.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path relative to the workspace root. Parent folders are created.' },
          content: { type: 'string', description: 'Full file content.' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: 'Replace an exact snippet inside an existing file. old_text must appear exactly once.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          old_text: { type: 'string', description: 'Exact text to find, including indentation.' },
          new_text: { type: 'string', description: 'Replacement text.' },
        },
        required: ['path', 'old_text', 'new_text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: 'List the entries of a directory in the workspace.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Defaults to the workspace root.' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_files',
      description: 'Search file contents by regular expression and return matching lines with their file and line number.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'JavaScript regular expression.' },
          path: { type: 'string', description: 'Directory to search under. Defaults to the workspace root.' },
          extensions: {
            type: 'string',
            description: 'Optional comma-separated extension filter, e.g. "ts,tsx,js".',
          },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description:
        'Request to run a shell command in the workspace. It does NOT run immediately: the user must approve it first. Only ask when a command is genuinely required — creating and editing files does not need one.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The exact command line to run.' },
          why: { type: 'string', description: 'One short sentence explaining why it is needed.' },
        },
        required: ['command'],
      },
    },
  },
];

/** Resolve a model-supplied path inside the workspace, or throw. */
export function resolveInsideRoot(root, candidate) {
  const base = path.resolve(root);
  const target = path.resolve(base, String(candidate ?? '.'));
  const rel = path.relative(base, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`path escapes the workspace root: ${candidate}`);
  }
  return target;
}

function clip(text) {
  const s = String(text ?? '');
  return s.length > MAX_RESULT_CHARS ? `${s.slice(0, MAX_RESULT_CHARS)}\n...[truncated]` : s;
}

function walkFiles(dir, out, depth = 0) {
  if (depth > 8 || out.length > 4000) return out;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walkFiles(full, out, depth + 1);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

/** Execute an approved shell command. Only ever called after explicit user approval. */
export function runApprovedCommand(root, command) {
  return new Promise((resolve) => {
    const shell = process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : '/bin/sh';
    const args = process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-c', command];
    execFile(
      shell,
      args,
      { cwd: root, timeout: COMMAND_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        const parts = [];
        if (stdout) parts.push(String(stdout).trim());
        if (stderr) parts.push(`[stderr] ${String(stderr).trim()}`);
        if (error) parts.push(`[exit ${error.code ?? 'error'}] ${error.message}`);
        resolve({
          isError: !!error,
          text: clip(parts.join('\n').trim() || '(no output)'),
        });
      }
    );
  });
}

/**
 * Run one non-shell tool call.
 * @returns {Promise<{ text: string, isError?: boolean, summary?: string }>}
 */
export async function executeBridgeTool(name, args, { root }) {
  const input = args && typeof args === 'object' ? args : {};
  switch (name) {
    case 'read_file': {
      const file = resolveInsideRoot(root, input.path);
      const stat = fs.statSync(file);
      if (stat.size > MAX_READ_BYTES) {
        const fd = fs.openSync(file, 'r');
        const buf = Buffer.alloc(MAX_READ_BYTES);
        fs.readSync(fd, buf, 0, MAX_READ_BYTES, 0);
        fs.closeSync(fd);
        return { text: clip(`${buf.toString('utf8')}\n...[file truncated at ${MAX_READ_BYTES} bytes]`) };
      }
      return { text: clip(fs.readFileSync(file, 'utf8')), summary: `read ${input.path}` };
    }
    case 'write_file': {
      const file = resolveInsideRoot(root, input.path);
      const content = String(input.content ?? '');
      if (Buffer.byteLength(content, 'utf8') > MAX_WRITE_BYTES) {
        return { isError: true, text: 'refused: content exceeds 2MB' };
      }
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content, 'utf8');
      const bytes = Buffer.byteLength(content, 'utf8');
      return { text: `Wrote ${bytes} bytes to ${input.path}`, summary: `wrote ${input.path}` };
    }
    case 'edit_file': {
      const file = resolveInsideRoot(root, input.path);
      const before = fs.readFileSync(file, 'utf8');
      const oldText = String(input.old_text ?? '');
      if (!oldText) return { isError: true, text: 'old_text must not be empty' };
      const first = before.indexOf(oldText);
      if (first < 0) return { isError: true, text: 'old_text was not found in the file — read it again and copy the text exactly.' };
      if (before.indexOf(oldText, first + 1) >= 0) {
        return { isError: true, text: 'old_text appears more than once — include more surrounding context to make it unique.' };
      }
      fs.writeFileSync(file, before.replace(oldText, String(input.new_text ?? '')), 'utf8');
      return { text: `Edited ${input.path}`, summary: `edited ${input.path}` };
    }
    case 'list_dir': {
      const dir = resolveInsideRoot(root, input.path || '.');
      const entries = fs.readdirSync(dir, { withFileTypes: true }).map((entry) => {
        if (entry.isDirectory()) return `${entry.name}/`;
        try {
          return `${entry.name} (${fs.statSync(path.join(dir, entry.name)).size}b)`;
        } catch {
          return entry.name;
        }
      });
      return { text: clip(entries.join('\n') || '(empty)'), summary: `listed ${input.path || '.'}` };
    }
    case 'search_files': {
      const dir = resolveInsideRoot(root, input.path || '.');
      let regex;
      try {
        regex = new RegExp(String(input.pattern), 'i');
      } catch (error) {
        return { isError: true, text: `invalid regular expression: ${error.message}` };
      }
      const exts = String(input.extensions || '')
        .split(',')
        .map((e) => e.trim().replace(/^\./, ''))
        .filter(Boolean);
      const hits = [];
      for (const file of walkFiles(dir, [])) {
        if (exts.length && !exts.includes(path.extname(file).replace(/^\./, ''))) continue;
        let content;
        try {
          if (fs.statSync(file).size > MAX_READ_BYTES) continue;
          content = fs.readFileSync(file, 'utf8');
        } catch {
          continue;
        }
        const lines = content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i += 1) {
          if (regex.test(lines[i])) {
            hits.push(`${path.relative(root, file).split(path.sep).join('/')}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
            if (hits.length >= 80) break;
          }
        }
        if (hits.length >= 80) break;
      }
      return { text: clip(hits.join('\n') || 'no matches'), summary: `searched ${input.pattern}` };
    }
    default:
      return { isError: true, text: `unknown tool: ${name}` };
  }
}
