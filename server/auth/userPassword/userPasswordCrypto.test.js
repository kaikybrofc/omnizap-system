import test from 'node:test';
import assert from 'node:assert/strict';

import { hashUserPassword, resolveUserPasswordPolicy, validateUserPassword, verifyUserPasswordHash } from './userPasswordCrypto.js';

const TEST_PEPPER_SECRET = 'pepper-secreto-de-teste-argon2';
process.env.WEB_USER_PASSWORD_PEPPER_SECRET = TEST_PEPPER_SECRET;

test('resolveUserPasswordPolicy normaliza limites de Argon2 e tamanho', () => {
  const policy = resolveUserPasswordPolicy({
    argon2TimeCost: 99,
    argon2MemoryKb: 999_999,
    argon2Parallelism: 99,
    argon2HashLength: 999,
    minLength: 120,
    maxLength: 4,
  });

  assert.equal(policy.argon2TimeCost, 10);
  assert.equal(policy.argon2MemoryKb, 262_144);
  assert.equal(policy.argon2Parallelism, 8);
  assert.equal(policy.argon2HashLength, 64);
  assert.equal(policy.minLength, 10);
  assert.equal(policy.maxLength, 10);
});

test('validateUserPassword reprova senha curta', () => {
  const result = validateUserPassword('abc', {
    minLength: 10,
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
    argon2TimeCost: 2,
    argon2MemoryKb: 4_096,
    argon2Parallelism: 1,
    argon2HashLength: 24,
    minLength: 10,
    maxLength: 72,
  });

  assert.equal(typeof hashed.hash, 'string');
  assert.equal(hashed.hash.startsWith('$argon2id$'), true);
  assert.equal(hashed.algorithm, 'argon2id');

  const valid = await verifyUserPasswordHash(password, hashed.hash);
  assert.equal(valid, true);
});

test('verifyUserPasswordHash retorna false para senha incorreta', async () => {
  const hashed = await hashUserPassword('SenhaCorreta123', {
    argon2TimeCost: 2,
    argon2MemoryKb: 4_096,
    argon2Parallelism: 1,
    argon2HashLength: 24,
    minLength: 10,
    maxLength: 72,
  });

  const valid = await verifyUserPasswordHash('SenhaErrada', hashed.hash);
  assert.equal(valid, false);
});

test('verifyUserPasswordHash retorna false para hash invalido', async () => {
  const valid = await verifyUserPasswordHash('qualquer', 'nao-e-hash-argon2');
  assert.equal(valid, false);
});
