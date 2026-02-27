import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyDictionaryMapping,
  calculateCohesion,
  detectConflict,
  detectDominantTheme,
  normalizeTokens,
  reclassify,
} from './semanticReclassificationEngine.js';

test('normalizeTokens deve limpar termos genéricos, stopwords e duplicatas', () => {
  const tokens = normalizeTokens({
    llm_subtags: [
      'Cute Anime Girl Sticker',
      'cute anime girl',
      'image',
      'co',
      'random art',
    ],
    llm_style_traits: ['Kawaii style'],
    llm_emotions: ['happy face'],
    llm_pack_suggestions: ['social media picture'],
  });

  const tokenMap = new Map(tokens.map((entry) => [entry.token, entry.weight]));
  assert.equal(tokenMap.get('cute_anime_girl'), 2);
  assert.equal(tokenMap.has('image'), false);
  assert.equal(tokenMap.has('random_art'), false);
  assert.equal(tokenMap.has('co'), false);
});

test('applyDictionaryMapping deve mapear por correspondência parcial', () => {
  const mapped = applyDictionaryMapping([
    { token: 'cute_anime_girl', weight: 1 },
    { token: 'chat_expression_face', weight: 1 },
    { token: 'meme_image_macro', weight: 1 },
  ]);

  const mappedTokens = mapped.map((entry) => entry.token);
  assert.ok(mappedTokens.includes('kawaii_anime_girl'));
  assert.ok(mappedTokens.includes('chat_reaction'));
  assert.ok(mappedTokens.includes('meme_reaction'));
});

test('detectDominantTheme e calculateCohesion devem priorizar tema com maior peso', () => {
  const dominant = detectDominantTheme([
    { token: 'anime_hero', weight: 2 },
    { token: 'anime_smile', weight: 1 },
    { token: 'meme_reaction', weight: 1 },
  ]);

  assert.equal(dominant.dominant_theme, 'anime');
  const cohesion = calculateCohesion({
    dominantWeight: dominant.dominant_weight,
    totalWeight: dominant.total_weight,
  });
  assert.equal(cohesion, 75);
});

test('detectConflict deve marcar ambiguidade quando temas principais são próximos', () => {
  const conflict = detectConflict({
    themeWeights: new Map([
      ['kawaii', 3],
      ['horror', 2.7],
      ['anime', 0.5],
    ]),
    totalWeight: 6.2,
  });

  assert.equal(conflict.ambiguous, 1);
  assert.equal(conflict.penalty_points, 20);
});

test('reclassify deve manter apenas tokens do tema dominante e recalcular affinity', () => {
  const output = reclassify({
    llm_subtags: ['anime hero', 'anime smile', 'meme joke'],
    llm_style_traits: ['anime expression'],
    llm_emotions: ['chat expression'],
  });

  assert.equal(output.dominant_theme, 'anime');
  assert.equal(output.ambiguous, 0);
  assert.ok(output.cohesion_score >= 60);
  assert.ok(output.updated_affinity_weight >= 0.6);
  assert.deepEqual(output.normalized_subtags, ['anime_expression', 'anime_hero', 'anime_smile']);
});
