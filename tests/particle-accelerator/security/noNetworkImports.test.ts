import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Static security scan: ensure no networking modules are imported in the
// particle-accelerator-runtime directory. This runtime executes shell commands on
// the user's machine and must NEVER make network calls.
// ---------------------------------------------------------------------------

const RUNTIME_DIR = path.resolve(__dirname, '../../../src/particle-accelerator-runtime');

// Banned module names -- both bare specifiers and node: prefixed forms
const BANNED_MODULES = [
  'http',
  'https',
  'net',
  'dgram',
  'http2',
  'ws',
  'undici',
  'node-fetch',
];

// Build a regex that matches import/require of any banned module.
// Handles:
//   import ... from 'http'            (ESM static)
//   import('http')                    (ESM dynamic)
//   require('http')                   (CJS)
//   import ... from 'node:http'       (node: prefix)
//   require('node:http')              (node: prefix)
//
// Captures the module name in group 1.
function buildBannedPattern(): RegExp {
  const moduleAlternation = BANNED_MODULES.map(m => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  // Match import ... from 'mod', import('mod'), require('mod') with optional node: prefix
  return new RegExp(
    `(?:` +
      `(?:import\\s+[^;]*?from\\s+['"])(?:node:)?(${moduleAlternation})['"]` + // import X from 'mod'
      `|` +
      `(?:import\\s*\\(\\s*['"])(?:node:)?(${moduleAlternation})['"]` +          // import('mod')
      `|` +
      `(?:require\\s*\\(\\s*['"])(?:node:)?(${moduleAlternation})['"]` +         // require('mod')
    `)`,
    'gm',
  );
}

// Collect all .ts files under a directory recursively
function collectTsFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) {
    return results;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      results.push(fullPath);
    }
  }
  return results;
}

describe('No-network static analysis for particle-accelerator-runtime', () => {
  it('should find .ts files in the runtime directory', () => {
    const files = collectTsFiles(RUNTIME_DIR);
    assert.ok(files.length > 0, `Expected .ts files in ${RUNTIME_DIR}, found none`);
  });

  it('should not import any banned networking modules', () => {
    const files = collectTsFiles(RUNTIME_DIR);
    const pattern = buildBannedPattern();
    const violations: Array<{ file: string; line: number; text: string; module: string }> = [];

    for (const filePath of files) {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Reset regex state for each line
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;

        while ((match = pattern.exec(line)) !== null) {
          // The matched module is in whichever capture group is non-undefined
          const moduleName = match[1] || match[2] || match[3];
          violations.push({
            file: path.relative(RUNTIME_DIR, filePath),
            line: i + 1,
            text: line.trim(),
            module: moduleName,
          });
        }
      }
    }

    if (violations.length > 0) {
      const report = violations
        .map(v => `  ${v.file}:${v.line} imports "${v.module}"\n    ${v.text}`)
        .join('\n');

      assert.fail(
        `Found ${violations.length} banned network import(s) in particle-accelerator-runtime:\n${report}\n\n` +
        `The particle-accelerator-runtime must be fully offline. Remove these imports.`,
      );
    }
  });
});
