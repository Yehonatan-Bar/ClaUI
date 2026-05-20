import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { GitPublicationScanner } from '../../../src/shared/scanners/GitPublicationScanner';

describe('GitPublicationScanner', () => {
  const scanner = new GitPublicationScanner();

  it('has the correct name', () => {
    assert.equal(scanner.name, 'git-publication');
  });

  // --- Sensitive file detection ---

  it('detects .env files being committed', () => {
    const diff = `diff --git a/.env b/.env
new file mode 100644
--- /dev/null
+++ b/.env
@@ -0,0 +1,2 @@
+SECRET=abc
+TOKEN=xyz`;
    const result = scanner.scan(diff, {
      boundary: 'git.publish',
      destination: { kind: 'git_remote', trustTier: 'approved_remote' },
    });
    assert.ok(result.findings.some(f => f.ruleId === 'git-staged-dotenv'));
  });

  it('detects .pem files being committed', () => {
    const diff = `diff --git a/certs/server.pem b/certs/server.pem
new file mode 100644
--- /dev/null
+++ b/certs/server.pem
@@ -0,0 +1,3 @@
+-----BEGIN CERTIFICATE-----
+MIIB...
+-----END CERTIFICATE-----`;
    const result = scanner.scan(diff, {
      boundary: 'git.publish',
      destination: { kind: 'git_remote', trustTier: 'approved_remote' },
    });
    assert.ok(result.findings.some(f => f.ruleId === 'git-staged-pem'));
    const pemFinding = result.findings.find(f => f.ruleId === 'git-staged-pem')!;
    assert.equal(pemFinding.severity, 'critical');
  });

  it('detects terraform.tfstate being committed', () => {
    const diff = `diff --git a/terraform.tfstate b/terraform.tfstate
new file mode 100644
--- /dev/null
+++ b/terraform.tfstate
@@ -0,0 +1 @@
+{"version": 4}`;
    const result = scanner.scan(diff, {
      boundary: 'git.publish',
      destination: { kind: 'git_remote', trustTier: 'approved_remote' },
    });
    assert.ok(result.findings.some(f => f.ruleId === 'git-staged-tfstate'));
  });

  it('detects SSH keys being committed', () => {
    const diff = `diff --git a/.ssh/id_rsa b/.ssh/id_rsa
new file mode 100644
--- /dev/null
+++ b/.ssh/id_rsa
@@ -0,0 +1 @@
+fake content`;
    const result = scanner.scan(diff, {
      boundary: 'git.publish',
      destination: { kind: 'git_remote', trustTier: 'approved_remote' },
    });
    assert.ok(result.findings.some(f => f.ruleId === 'git-staged-ssh-key'));
  });

  // --- Binary file detection ---

  it('detects binary .p12 files in diff', () => {
    const diff = `diff --git a/certs/client.p12 b/certs/client.p12
new file mode 100644
Binary files /dev/null and b/certs/client.p12 differ`;
    const result = scanner.scan(diff, {
      boundary: 'git.publish',
      destination: { kind: 'git_remote', trustTier: 'approved_remote' },
    });
    assert.ok(result.findings.some(f => f.ruleId === 'git-staged-p12'));
  });

  it('detects binary .pfx files in diff', () => {
    const diff = `diff --git a/certs/cert.pfx b/certs/cert.pfx
new file mode 100644
Binary files /dev/null and b/certs/cert.pfx differ`;
    const result = scanner.scan(diff, {
      boundary: 'git.publish',
      destination: { kind: 'git_remote', trustTier: 'approved_remote' },
    });
    assert.ok(result.findings.some(f => f.ruleId === 'git-staged-pfx'));
  });

  it('detects binary .keystore files in diff', () => {
    const diff = `diff --git a/app/release.keystore b/app/release.keystore
new file mode 100644
Binary files /dev/null and b/app/release.keystore differ`;
    const result = scanner.scan(diff, {
      boundary: 'git.publish',
      destination: { kind: 'git_remote', trustTier: 'approved_remote' },
    });
    assert.ok(result.findings.some(f => f.ruleId === 'git-staged-keystore'));
  });

  // --- Added-line secret detection ---

  it('detects AWS keys in added lines', () => {
    const diff = `diff --git a/config.ts b/config.ts
--- a/config.ts
+++ b/config.ts
@@ -1,2 +1,3 @@
 const region = 'us-east-1';
+const accessKey = 'AKIAIOSFODNN7EXAMPLE';
 export default { region };`;
    const result = scanner.scan(diff, {
      boundary: 'git.publish',
      destination: { kind: 'git_remote', trustTier: 'approved_remote' },
    });
    assert.ok(result.findings.some(f => f.ruleId === 'git-diff-aws-key'));
  });

  it('detects database URLs in added lines', () => {
    const diff = `diff --git a/db.ts b/db.ts
--- a/db.ts
+++ b/db.ts
@@ -1 +1,2 @@
 import pg from 'pg';
+const url = 'postgres://admin:s3cretPass@prod-db:5432/mydb';`;
    const result = scanner.scan(diff, {
      boundary: 'git.publish',
      destination: { kind: 'git_remote', trustTier: 'approved_remote' },
    });
    assert.ok(result.findings.some(f => f.ruleId === 'git-diff-db-url'));
  });

  it('does NOT flag secrets in removed lines', () => {
    const diff = `diff --git a/config.ts b/config.ts
--- a/config.ts
+++ b/config.ts
@@ -1,2 +1,1 @@
-const accessKey = 'AKIAIOSFODNN7EXAMPLE';
 export default {};`;
    const result = scanner.scan(diff, {
      boundary: 'git.publish',
      destination: { kind: 'git_remote', trustTier: 'approved_remote' },
    });
    assert.equal(result.findings.filter(f => f.ruleId === 'git-diff-aws-key').length, 0);
  });

  it('detects private keys in added lines', () => {
    const diff = `diff --git a/keys.ts b/keys.ts
--- /dev/null
+++ b/keys.ts
@@ -0,0 +1,2 @@
+const key = \`-----BEGIN PRIVATE KEY-----
+MIIEvQIBADA...\``;
    const result = scanner.scan(diff, {
      boundary: 'git.publish',
      destination: { kind: 'git_remote', trustTier: 'approved_remote' },
    });
    assert.ok(result.findings.some(f => f.ruleId === 'git-diff-private-key'));
  });

  // --- Boundary filtering ---

  it('skips irrelevant boundaries', () => {
    const diff = `diff --git a/.env b/.env
+++ b/.env
@@ -0,0 +1 @@
+SECRET=abc`;
    const result = scanner.scan(diff, {
      boundary: 'prompt.submit',
      destination: { kind: 'remote_model_provider', trustTier: 'trusted_org' },
    });
    assert.equal(result.findings.length, 0);
  });

  it('works with git.diff boundary', () => {
    const diff = `diff --git a/.env.local b/.env.local
new file mode 100644
--- /dev/null
+++ b/.env.local
@@ -0,0 +1 @@
+API_KEY=test`;
    const result = scanner.scan(diff, {
      boundary: 'git.diff',
      destination: { kind: 'local_disk', trustTier: 'trusted_local' },
    });
    assert.ok(result.findings.some(f => f.ruleId === 'git-staged-dotenv'));
  });

  it('returns proper metadata for clean diff', () => {
    const diff = `diff --git a/readme.md b/readme.md
--- a/readme.md
+++ b/readme.md
@@ -1 +1,2 @@
 # Hello
+## World`;
    const result = scanner.scan(diff, {
      boundary: 'git.publish',
      destination: { kind: 'git_remote', trustTier: 'approved_remote' },
    });
    assert.equal(result.findings.length, 0);
    assert.ok(result.scannedBytes > 0);
    assert.ok(result.latencyMs >= 0);
  });
});
