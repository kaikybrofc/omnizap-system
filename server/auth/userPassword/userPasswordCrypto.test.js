import test from 'node:test';
import assert from 'node:assert/strict';

import { hashUserPassword, resolveUserPasswordPolicy, validateUserPassword, verifyUserPasswordHash } from './userPasswordCrypto.js';

test('resolveUserPasswordPolicy normaliza limites de rounds e tamanho', () => {
  const policy = resolveUserPasswordPolicy({
    bcryptRounds: 99,
    minLength: 120,
    maxLength: 4,
  });

  assert.equal(policy.bcryptRounds, 15);
  assert.equal(policy.minLength, 8);
  assert.equal(policy.maxLength, 8);
});

test('validateUserPassword reprova senha curta', () => {
  const result = validateUserPassword('abc', {
    minLength: 8,
    maxLength: 72,
  });

  assert.equal(result.valid, false);
  assert.equal(
    result.errors.some((item) => item.code === 'PASSWORD_TOO_SHORT'),
    true,
  );
});

test('hashUserPassword + verifyUserPasswordHash validam senha correta', async () => {
  const password = 'SenhaInterna123';
  const hashed = await hashUserPassword(password, {
    bcryptRounds: 8,
    minLength: 8,
    maxLength: 72,
  });

  assert.equal(typeof hashed.hash, 'string');
  assert.equal(hashed.hash.startsWith('$2b$') || hashed.hash.startsWith('$2a$') || hashed.hash.startsWith('$2y$'), true);

  const valid = await verifyUserPasswordHash(password, hashed.hash);
  assert.equal(valid, true);
});

test('verifyUserPasswordHash retorna false para senha incorreta', async () => {
  const hashed = await hashUserPassword('SenhaCorreta123', {
    bcryptRounds: 8,
    minLength: 8,
    maxLength: 72,
  });

  const valid = await verifyUserPasswordHash('SenhaErrada', hashed.hash);
  assert.equal(valid, false);
});

test('verifyUserPasswordHash retorna false para hash invalido', async () => {
  const valid = await verifyUserPasswordHash('qualquer', 'nao-e-hash-bcrypt');
  assert.equal(valid, false);
});
