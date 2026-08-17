import test from 'node:test';
import assert from 'node:assert/strict';

import { containsExactPhrase, isRecentTimestamp } from '../src/filter.js';

test('matches the exact phrase ignoring case and repeated spaces', () => {
  assert.equal(containsExactPhrase('Ищу   маркетолога для проекта', 'ищу маркетолога'), true);
  assert.equal(containsExactPhrase('Нужен маркетинг', 'ищу маркетолога'), false);
});

test('accepts a post inside the four-hour window', () => {
  const now = new Date('2026-08-17T12:00:00.000Z');
  assert.equal(isRecentTimestamp('2026-08-17T09:30:00.000Z', 240, now), true);
  assert.equal(isRecentTimestamp('2026-08-17T07:59:00.000Z', 240, now), false);
});
