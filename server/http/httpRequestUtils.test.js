import assert from 'node:assert/strict';
import test from 'node:test';

import { isRequestSecure } from './httpRequestUtils.js';

const withEnv = (overrides, fn) => {
  const previous = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : null);
    if (value === undefined || value === null) {
      delete process.env[key];
    } else {
      process.env[key] = String(value);
    }
  }

  try {
    return fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
};

const buildReq = ({ forwardedProto = '', remoteAddress = '203.0.113.10', encrypted = false } = {}) => ({
  headers: forwardedProto ? { 'x-forwarded-proto': forwardedProto } : {},
  socket: {
    remoteAddress,
    encrypted,
  },
});

test('isRequestSecure ignores x-forwarded-proto for untrusted remote proxy', () => {
  withEnv({ APP_TRUST_PROXY: 'false', RATE_LIMIT_TRUST_PROXY: 'false' }, () => {
    const req = buildReq({
      forwardedProto: 'https',
      remoteAddress: '203.0.113.42',
      encrypted: false,
    });
    assert.equal(isRequestSecure(req), false);
  });
});

test('isRequestSecure accepts x-forwarded-proto over trusted loopback proxy', () => {
  withEnv({ APP_TRUST_PROXY: 'false', RATE_LIMIT_TRUST_PROXY: 'false' }, () => {
    const req = buildReq({
      forwardedProto: 'https',
      remoteAddress: '127.0.0.1',
      encrypted: false,
    });
    assert.equal(isRequestSecure(req), true);
  });
});

test('isRequestSecure accepts x-forwarded-proto when trust proxy is enabled', () => {
  withEnv({ APP_TRUST_PROXY: 'true', RATE_LIMIT_TRUST_PROXY: 'false' }, () => {
    const req = buildReq({
      forwardedProto: 'https',
      remoteAddress: '198.51.100.5',
      encrypted: false,
    });
    assert.equal(isRequestSecure(req), true);
  });
});

test('isRequestSecure falls back to socket encryption without trusted forwarded proto', () => {
  withEnv({ APP_TRUST_PROXY: 'false', RATE_LIMIT_TRUST_PROXY: 'false' }, () => {
    const req = buildReq({
      forwardedProto: 'http',
      remoteAddress: '198.51.100.5',
      encrypted: true,
    });
    assert.equal(isRequestSecure(req), true);
  });
});
