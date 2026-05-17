import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../dist/config.js';

function makeEnv(overrides = {}) {
  return {
    DEEPSEEK_API_KEY: 'test-key',
    OWNER_BIND_SECRET: 'owner-secret-123',
    MEMORY_ENCRYPTION_KEY: 'memory-secret-123',
    ...overrides,
  };
}

test('defaults to web mode values and reuses owner secret as login password', () => {
  const config = loadConfig(makeEnv());

  assert.equal(config.web.host, '0.0.0.0');
  assert.equal(config.web.port, 3000);
  assert.equal(config.web.contactId, 'web-owner');
  assert.equal(config.web.loginPassword, 'owner-secret-123');
});

test('prefers explicit web login password and parses web settings', () => {
  const config = loadConfig(makeEnv({
    WEB_HOST: '127.0.0.1',
    WEB_PORT: '4321',
    WEB_CONTACT_ID: 'browser-user',
    WEB_HISTORY_LIMIT: '15',
    WEB_LOGIN_PASSWORD: 'web-password-456',
  }));

  assert.equal(config.web.host, '127.0.0.1');
  assert.equal(config.web.port, 4321);
  assert.equal(config.web.contactId, 'browser-user');
  assert.equal(config.web.historyLimit, 15);
  assert.equal(config.web.loginPassword, 'web-password-456');
});

test('requires either owner bind secret or web login password', () => {
  assert.throws(
    () => loadConfig({
      DEEPSEEK_API_KEY: 'test-key',
      MEMORY_ENCRYPTION_KEY: 'memory-secret-123',
    }),
    /OWNER_BIND_SECRET or WEB_LOGIN_PASSWORD/,
  );
});

test('validates minimum web password length', () => {
  assert.throws(
    () => loadConfig(makeEnv({ OWNER_BIND_SECRET: 'short', WEB_LOGIN_PASSWORD: 'short' })),
    /at least 12 characters/,
  );
});
