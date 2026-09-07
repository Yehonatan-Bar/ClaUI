import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { parseCodexModelOptions } from '../../src/extension/process/codexModelCache';

/** Minimal, realistic slice of ~/.codex/models_cache.json covering the fields we read. */
const CACHE_JSON = JSON.stringify({
  fetched_at: '2026-09-06T13:33:49Z',
  models: [
    {
      slug: 'gpt-6-astra',
      display_name: 'GPT-6-Astra',
      description: 'Our most capable model for complex, demanding work.',
      default_reasoning_level: 'medium',
      supported_reasoning_levels: [
        { effort: 'low', description: 'x' },
        { effort: 'medium', description: 'x' },
        { effort: 'high', description: 'x' },
        { effort: 'xhigh', description: 'x' },
        { effort: 'max', description: 'x' },
        { effort: 'ultra', description: 'x' },
      ],
      visibility: 'list',
      priority: 1,
      context_window: 272000,
      max_context_window: 872000,
      additional_speed_tiers: ['fast'],
      service_tiers: [{ id: 'priority', name: 'Fast', description: '2x speed' }],
    },
    {
      slug: 'gpt-reserve',
      display_name: 'GPT-Reserve',
      visibility: 'hide',
      priority: 3,
      context_window: 272000,
      max_context_window: 872000,
      additional_speed_tiers: ['fast'],
      default_reasoning_level: 'medium',
    },
    {
      slug: 'gpt-5.3-codex-spark',
      display_name: 'GPT-5.3-Codex-Spark',
      default_reasoning_level: 'high',
      supported_reasoning_levels: [{ effort: 'high', description: 'x' }],
      visibility: 'list',
      priority: 26,
      context_window: 128000,
      max_context_window: 128000,
      additional_speed_tiers: [],
    },
  ],
});

test('parseCodexModelOptions: Astra is parsed with full validated metadata', () => {
  const options = parseCodexModelOptions(CACHE_JSON);
  const astra = options.find((o) => o.value === 'gpt-6-astra');
  assert.ok(astra, 'Astra should be present');
  assert.equal(astra!.label, 'GPT-6-Astra');
  assert.deepEqual(astra!.supportedReasoningEfforts, ['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
  assert.equal(astra!.contextWindow, 272000);
  assert.equal(astra!.maxContextWindow, 872000);
  assert.equal(astra!.supportsFast, true);
  assert.equal(astra!.defaultReasoningEffort, 'medium');
});

test('parseCodexModelOptions: Astra reasoning list excludes none/minimal', () => {
  const astra = parseCodexModelOptions(CACHE_JSON).find((o) => o.value === 'gpt-6-astra')!;
  assert.ok(!astra.supportedReasoningEfforts!.includes('none' as never));
  assert.ok(!astra.supportedReasoningEfforts!.includes('minimal' as never));
});

test('parseCodexModelOptions: hidden models (visibility=hide) are excluded', () => {
  const options = parseCodexModelOptions(CACHE_JSON);
  assert.equal(options.some((o) => o.value === 'gpt-reserve'), false);
});

test('parseCodexModelOptions: model without a Fast tier reports supportsFast=false', () => {
  const spark = parseCodexModelOptions(CACHE_JSON).find((o) => o.value === 'gpt-5.3-codex-spark')!;
  assert.equal(spark.supportsFast, false);
  assert.equal(spark.contextWindow, 128000);
});

test('parseCodexModelOptions: options are ordered by cache priority', () => {
  const values = parseCodexModelOptions(CACHE_JSON).map((o) => o.value);
  assert.deepEqual(values, ['gpt-6-astra', 'gpt-5.3-codex-spark']);
});

test('parseCodexModelOptions: invalid/missing metadata coerces to undefined, not garbage', () => {
  const json = JSON.stringify({
    models: [
      {
        slug: 'gpt-weird',
        display_name: 'GPT-Weird',
        visibility: 'list',
        priority: 5,
        context_window: -1, // invalid -> undefined
        max_context_window: 'lots', // invalid -> undefined
        default_reasoning_level: 'bogus', // invalid -> undefined
        additional_speed_tiers: 'fast', // wrong type -> not fast
      },
    ],
  });
  const weird = parseCodexModelOptions(json).find((o) => o.value === 'gpt-weird')!;
  assert.equal(weird.contextWindow, undefined);
  assert.equal(weird.maxContextWindow, undefined);
  assert.equal(weird.defaultReasoningEffort, undefined);
  assert.equal(weird.supportsFast, false);
  assert.equal(weird.supportedReasoningEfforts, undefined);
});

test('parseCodexModelOptions: empty/absent models array yields no options', () => {
  assert.deepEqual(parseCodexModelOptions('{}'), []);
  assert.deepEqual(parseCodexModelOptions(JSON.stringify({ models: [] })), []);
});
