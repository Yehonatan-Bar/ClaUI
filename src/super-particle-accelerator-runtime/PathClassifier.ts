import * as path from 'path';
import { PathRisk } from '../shared/super-particle-accelerator/types';

function simpleGlobMatch(filePath: string, glob: string): boolean {
  const pattern = glob
    .replace(/\./g, '\\.')
    .replace(/\?/g, '<<QMARK>>')
    .replace(/\*\*/g, '<<GLOBSTAR>>')
    .replace(/\*/g, '[^/]*')
    .replace(/<<GLOBSTAR>>\//g, '(.*/)?')
    .replace(/<<GLOBSTAR>>/g, '.*')
    .replace(/<<QMARK>>/g, '.');
  return new RegExp(`^${pattern}$`).test(filePath);
}

const PUBLIC_ROOT_PREFIXES = [
  'public/', 'static/', 'dist/', 'build/',
  'client/', 'frontend/', 'web/',
];

export class PathClassifier {
  private frontendGlobs: string[];
  private allowedSecretGlobs: string[];

  constructor(frontendGlobs: string[], allowedSecretGlobs: string[]) {
    this.frontendGlobs = frontendGlobs;
    this.allowedSecretGlobs = allowedSecretGlobs;
  }

  classify(filePath: string, cwd: string): PathRisk {
    const rel = path.relative(cwd, filePath).replace(/\\/g, '/');

    if (this.isPublicRoot(rel) || this.matchesAny(rel, ['**/*.bundle.js', '**/*.min.js'])) {
      return 'generated-public-artifact';
    }

    if (this.matchesAny(rel, this.allowedSecretGlobs)) {
      if (this.isInsidePublicRoot(rel)) {
        return 'public-client-code';
      }
      return 'local-secret-file';
    }

    if (this.matchesAny(rel, this.frontendGlobs)) {
      if (this.isServerSidePath(rel)) return 'server-code';
      return 'public-client-code';
    }

    return 'unknown-repository-file';
  }

  isInsidePublicRoot(relPath: string): boolean {
    return PUBLIC_ROOT_PREFIXES.some(prefix => relPath.startsWith(prefix));
  }

  private isPublicRoot(rel: string): boolean {
    return PUBLIC_ROOT_PREFIXES.some(prefix =>
      rel.startsWith(prefix) || simpleGlobMatch(rel, prefix + '**'));
  }

  private isServerSidePath(rel: string): boolean {
    if (/^(app|pages)\/api\//.test(rel)) return true;
    return false;
  }

  private matchesAny(rel: string, globs: string[]): boolean {
    return globs.some(g => simpleGlobMatch(rel, g));
  }
}
