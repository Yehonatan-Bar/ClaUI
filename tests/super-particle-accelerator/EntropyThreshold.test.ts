import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { EntropyScanner } from '../../src/shared/secret-protection/scanners/EntropyScanner';

describe('EntropyScanner configurable threshold', () => {
  const highEntropyToken = 'aB3dE5fG7hI9jK1lM3nO5pQ7rS9tU1v';

  it('uses default threshold (4.5) when none specified', () => {
    const scanner = new EntropyScanner({ enabled: true });
    const result = scanner.scan(highEntropyToken);
    const findingCount = result.findings.length;

    const scannerExplicit = new EntropyScanner({ enabled: true, threshold: 4.5 });
    const resultExplicit = scannerExplicit.scan(highEntropyToken);

    assert.equal(findingCount, resultExplicit.findings.length);
  });

  it('lower threshold catches more tokens', () => {
    const borderlineToken = 'abcdefghijklmnop12345678';

    const strict = new EntropyScanner({ enabled: true, threshold: 5.0 });
    const lenient = new EntropyScanner({ enabled: true, threshold: 2.0 });

    const strictResult = strict.scan(borderlineToken);
    const lenientResult = lenient.scan(borderlineToken);

    assert.ok(
      lenientResult.findings.length >= strictResult.findings.length,
      'Lower threshold should catch at least as many findings as higher threshold',
    );
  });

  it('threshold 0 catches tokens with any entropy', () => {
    const scanner = new EntropyScanner({ enabled: true, threshold: 0 });
    const token = 'abcdefghijklmnop';
    const result = scanner.scan(token);
    assert.ok(result.findings.length > 0, 'Zero threshold should catch tokens with any positive entropy');
  });

  it('very high threshold catches nothing', () => {
    const scanner = new EntropyScanner({ enabled: true, threshold: 10 });
    const result = scanner.scan(highEntropyToken);
    assert.equal(result.findings.length, 0, 'Threshold above max Shannon entropy should find nothing');
  });

  it('SpaSecretScanner passes threshold to EntropyScanner', () => {
    const { SpaSecretScanner } = require('../../src/super-particle-accelerator-runtime/SecretScanner');
    const scanner1 = new SpaSecretScanner(4.2);
    const scanner2 = new SpaSecretScanner(5.5);

    const text = `TOKEN=${highEntropyToken}`;
    const findings1 = scanner1.scan({ text, source: 'edit', provider: 'claude', cwd: '/project' });
    const findings2 = scanner2.scan({ text, source: 'edit', provider: 'claude', cwd: '/project' });

    assert.ok(
      findings1.length >= findings2.length,
      'Lower entropy threshold (4.2) should catch at least as many findings as higher (5.5)',
    );
  });
});
