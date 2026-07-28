import test from 'node:test';
import assert from 'node:assert/strict';
import { selectLatestBotAnswer } from '../botReplyUtils.js';

test('returns the newest non-empty answer when the count increases', () => {
  assert.equal(selectLatestBotAnswer(['previous reply', 'new reply'], 1, 'previous reply'), 'new reply');
});

test('returns null when there is no new answer yet', () => {
  assert.equal(selectLatestBotAnswer(['previous reply'], 1, 'previous reply'), null);
});

test('skips empty placeholder content before picking the real answer', () => {
  assert.equal(selectLatestBotAnswer(['previous reply', '   ', 'new reply'], 1, 'previous reply'), 'new reply');
});
