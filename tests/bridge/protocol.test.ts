import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { parseUserMessage, imagesOmittedNote } from '../../src/bridge-runtime/protocol';

test('parseUserMessage: plain string content', () => {
  assert.deepEqual(parseUserMessage({ content: 'hello' }), { text: 'hello', images: [] });
});

test('parseUserMessage: text blocks joined, images extracted', () => {
  const result = parseUserMessage({
    content: [
      { type: 'text', text: 'line one' },
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' },
      },
      { type: 'text', text: 'line two' },
    ],
  });
  assert.equal(result.text, 'line one\nline two');
  assert.deepEqual(result.images, [{ mediaType: 'image/jpeg', data: 'AAAA' }]);
});

test('parseUserMessage: image without media_type defaults to png', () => {
  const result = parseUserMessage({
    content: [{ type: 'image', source: { type: 'base64', data: 'ZZ' } }],
  });
  assert.deepEqual(result.images, [{ mediaType: 'image/png', data: 'ZZ' }]);
});

test('parseUserMessage: empty / non-array content is safe', () => {
  assert.deepEqual(parseUserMessage(undefined), { text: '', images: [] });
  assert.deepEqual(parseUserMessage({ content: 42 }), { text: '', images: [] });
});

test('imagesOmittedNote: singular/plural/none', () => {
  assert.equal(imagesOmittedNote(0, 'Grok'), '');
  assert.ok(imagesOmittedNote(1, 'Grok').includes('1 image'));
  assert.ok(imagesOmittedNote(2, 'Antigravity').includes('2 images'));
  assert.ok(imagesOmittedNote(1, 'Grok').includes('Grok'));
});
