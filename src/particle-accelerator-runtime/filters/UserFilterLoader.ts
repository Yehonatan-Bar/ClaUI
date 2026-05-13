import * as fs from 'fs';
import * as path from 'path';
import { DeclarativeFilterDefinition, FilterConfig } from '../../extension/particle-accelerator/ParticleAcceleratorTypes';

export function loadUserFilters(storeDir: string, cwd: string): DeclarativeFilterDefinition[] {
  const definitions: DeclarativeFilterDefinition[] = [];

  const paths = [
    path.join(cwd, '.claui', 'filters.json'),
    storeDir ? path.join(storeDir, 'config', 'filters.json') : '',
  ].filter(Boolean);

  for (const filePath of paths) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed: FilterConfig = JSON.parse(raw);
      if (parsed.customFilters && Array.isArray(parsed.customFilters)) {
        for (const def of parsed.customFilters) {
          if (validateDefinition(def)) {
            definitions.push(def);
          }
        }
      }
    } catch {
      // File not found or invalid JSON — continue
    }
  }

  return definitions;
}

function validateDefinition(def: unknown): def is DeclarativeFilterDefinition {
  if (!def || typeof def !== 'object') return false;
  const d = def as Record<string, unknown>;
  if (typeof d.id !== 'string' || !d.id) return false;
  if (!Array.isArray(d.commandPatterns) || d.commandPatterns.length === 0) return false;

  for (const p of d.commandPatterns) {
    if (typeof p !== 'string') return false;
    try { new RegExp(p); } catch { return false; }
  }

  for (const field of ['suppressPatterns', 'importantPatterns'] as const) {
    if (d[field] !== undefined) {
      if (!Array.isArray(d[field])) return false;
      for (const p of d[field] as string[]) {
        if (typeof p !== 'string') return false;
        try { new RegExp(p); } catch { return false; }
      }
    }
  }

  if (d.diagnosticPattern !== undefined) {
    if (typeof d.diagnosticPattern !== 'string') return false;
    try { new RegExp(d.diagnosticPattern as string); } catch { return false; }
  }

  return true;
}
