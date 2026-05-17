import assert from 'node:assert/strict';
import test from 'node:test';
import { applyWechatyEnvironment, buildWechatyOptions } from '../dist/bot.js';

const baseConfig = {
  deepseek: {
    apiKey: 'test',
    baseUrl: 'https://api.deepseek.com',
    fastModel: 'deepseek-v4-flash',
    proModel: 'deepseek-v4-pro',
    timeoutMs: 1000,
  },
  ownerBindSecret: 'owner-secret-123',
  memoryEncryptionKey: 'memory-secret-123',
  databasePath: '/tmp/memory.sqlite',
  modelRouting: 'auto',
  recentMessageLimit: 18,
  summaryThreshold: 20,
  summaryMessageLimit: 120,
};

test('omits puppet token when using QQ oicq mode', () => {
  const config = {
    ...baseConfig,
    wechaty: {
      puppet: 'wechaty-puppet-oicq',
      oicqQq: '12345678',
    },
  };

  assert.deepEqual(buildWechatyOptions(config), {
    name: 'ai-chat-companion',
    puppet: 'wechaty-puppet-oicq',
  });

  const env = {
    WECHATY_PUPPET_SERVICE_TOKEN: 'stale-token',
  };
  applyWechatyEnvironment(config, env);

  assert.equal(env.WECHATY_PUPPET, 'wechaty-puppet-oicq');
  assert.equal(env.WECHATY_PUPPET_OICQ_QQ, '12345678');
  assert.equal('WECHATY_PUPPET_SERVICE_TOKEN' in env, false);
});

test('includes puppet token when using service mode', () => {
  const config = {
    ...baseConfig,
    wechaty: {
      puppet: 'wechaty-puppet-service',
      puppetServiceToken: 'puppet-token',
    },
  };

  assert.deepEqual(buildWechatyOptions(config), {
    name: 'ai-chat-companion',
    puppet: 'wechaty-puppet-service',
    puppetOptions: {
      token: 'puppet-token',
    },
  });

  const env = {
    WECHATY_PUPPET_OICQ_QQ: '12345678',
  };
  applyWechatyEnvironment(config, env);

  assert.equal(env.WECHATY_PUPPET, 'wechaty-puppet-service');
  assert.equal(env.WECHATY_PUPPET_SERVICE_TOKEN, 'puppet-token');
  assert.equal('WECHATY_PUPPET_OICQ_QQ' in env, false);
});
