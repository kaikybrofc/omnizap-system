import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateLevelFromXp, getLevelMultiplier, resolveXpGainForLevel, xpNeededForLevel } from './xpConfig.js';

test('getLevelMultiplier should respect configured ranges', () => {
  assert.equal(getLevelMultiplier(1), 1.0);
  assert.equal(getLevelMultiplier(4), 1.0);
  assert.equal(getLevelMultiplier(5), 1.1);
  assert.equal(getLevelMultiplier(9), 1.1);
  assert.equal(getLevelMultiplier(10), 1.2);
  assert.equal(getLevelMultiplier(15), 1.3);
  assert.equal(getLevelMultiplier(20), 1.5);
  assert.equal(getLevelMultiplier(99), 1.5);
});

test('xpNeededForLevel should follow floor(100 * level^1.5)', () => {
  assert.equal(xpNeededForLevel(1), 100);
  assert.equal(xpNeededForLevel(2), 282);
  assert.equal(xpNeededForLevel(3), 519);
});

test('calculateLevelFromXp should support multiple level transitions', () => {
  assert.equal(calculateLevelFromXp(0).level, 1);
  assert.equal(calculateLevelFromXp(100).level, 2);
  assert.equal(calculateLevelFromXp(381).level, 2);
  assert.equal(calculateLevelFromXp(382).level, 3);
});

test('resolveXpGainForLevel should apply multiplier and rounding', () => {
  assert.equal(resolveXpGainForLevel(1), 5);
  assert.equal(resolveXpGainForLevel(5), 6);
  assert.equal(resolveXpGainForLevel(10), 6);
  assert.equal(resolveXpGainForLevel(20), 8);
});
