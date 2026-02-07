import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeUnicodeString, toSafeJsonColumnValue } from './jsonSanitizer.js';

test('sanitizeUnicodeString mantem pares surrogate validos', () => {
  const input = 'emoji \uD83D\uDE00 ok';
  assert.equal(sanitizeUnicodeString(input), input);
});

test('sanitizeUnicodeString substitui surrogates invalidos por U+FFFD', () => {
  const input = `invalido \ud800 meio \udc00 fim`;
  const output = sanitizeUnicodeString(input);
  assert.equal(output, 'invalido \uFFFD meio \uFFFD fim');
});

test('toSafeJsonColumnValue sanitiza objeto com surrogate invalido', () => {
  const raw = {
    text: `abc\ud800def`,
    nested: { note: `x\udc00y` },
  };

  const json = toSafeJsonColumnValue(raw);
  assert.equal(typeof json, 'string');

  const parsed = JSON.parse(json);
  assert.equal(parsed.text, 'abc\uFFFDdef');
  assert.equal(parsed.nested.note, 'x\uFFFDy');
});

test('toSafeJsonColumnValue sanitiza JSON string com escape de surrogate invalido', () => {
  const raw = '{"text":"\\ud800"}';
  const json = toSafeJsonColumnValue(raw);
  const parsed = JSON.parse(json);
  assert.equal(parsed.text, '\uFFFD');
});

test('toSafeJsonColumnValue transforma texto simples em JSON string valido', () => {
  const json = toSafeJsonColumnValue('texto simples');
  assert.equal(json, '"texto simples"');
});
