import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PathClassifier } from '../../src/super-particle-accelerator-runtime/PathClassifier';

function createClassifier(): PathClassifier {
  return new PathClassifier(
    ['src/**/*.tsx', 'src/**/*.jsx', 'public/**', 'client/**'],
    ['.env.local', '.env.*.local', '*.local.env'],
  );
}

describe('PathClassifier', () => {
  describe('generated-public-artifact', () => {
    it('classifies files in public/ as generated public artifacts', () => {
      const c = createClassifier();
      assert.equal(c.classify('/project/public/script.js', '/project'), 'generated-public-artifact');
    });

    it('classifies files in dist/ as generated public artifacts', () => {
      const c = createClassifier();
      assert.equal(c.classify('/project/dist/bundle.js', '/project'), 'generated-public-artifact');
    });

    it('classifies files in build/ as generated public artifacts', () => {
      const c = createClassifier();
      assert.equal(c.classify('/project/build/index.html', '/project'), 'generated-public-artifact');
    });

    it('classifies .bundle.js files as generated public artifacts', () => {
      const c = createClassifier();
      assert.equal(c.classify('/project/output/app.bundle.js', '/project'), 'generated-public-artifact');
    });

    it('classifies .min.js files as generated public artifacts', () => {
      const c = createClassifier();
      assert.equal(c.classify('/project/lib/vendor.min.js', '/project'), 'generated-public-artifact');
    });
  });

  describe('local-secret-file', () => {
    it('classifies .env.local as local secret file', () => {
      const c = createClassifier();
      assert.equal(c.classify('/project/.env.local', '/project'), 'local-secret-file');
    });

    it('classifies .env.development.local as local secret file', () => {
      const c = createClassifier();
      assert.equal(c.classify('/project/.env.development.local', '/project'), 'local-secret-file');
    });

    it('classifies .env.local inside public root as public-client-code (not allowed)', () => {
      const c = createClassifier();
      const risk = c.classify('/project/public/.env.local', '/project');
      assert.ok(
        risk === 'public-client-code' || risk === 'generated-public-artifact',
        `Expected public-risk classification, got: ${risk}`,
      );
    });
  });

  describe('public-client-code', () => {
    it('classifies frontend tsx at src root as public-client-code', () => {
      const c = createClassifier();
      assert.equal(c.classify('/project/src/App.tsx', '/project'), 'public-client-code');
    });

    it('classifies frontend tsx in subdirs as public-client-code', () => {
      const c = createClassifier();
      assert.equal(c.classify('/project/src/components/App.tsx', '/project'), 'public-client-code');
    });

    it('classifies client/ root as generated-public-artifact (public root prefix)', () => {
      const c = createClassifier();
      assert.equal(c.classify('/project/client/config.js', '/project'), 'generated-public-artifact');
    });
  });

  describe('server-code', () => {
    it('classifies Next.js API routes as server-code when matching frontend globs', () => {
      const c = new PathClassifier(
        ['app/**/*.tsx', 'pages/**/*.tsx', 'src/**/*.tsx'],
        ['.env.local'],
      );
      assert.equal(c.classify('/project/app/api/users/route.tsx', '/project'), 'server-code');
    });

    it('classifies pages/api routes as server-code when matching frontend globs', () => {
      const c = new PathClassifier(
        ['pages/**/*.tsx', 'src/**/*.tsx'],
        ['.env.local'],
      );
      assert.equal(c.classify('/project/pages/api/auth.tsx', '/project'), 'server-code');
    });
  });

  describe('unknown-repository-file', () => {
    it('classifies backend files as unknown-repository-file', () => {
      const c = createClassifier();
      assert.equal(c.classify('/project/server/config.ts', '/project'), 'unknown-repository-file');
    });

    it('classifies root config files as unknown-repository-file', () => {
      const c = createClassifier();
      assert.equal(c.classify('/project/tsconfig.json', '/project'), 'unknown-repository-file');
    });
  });
});
