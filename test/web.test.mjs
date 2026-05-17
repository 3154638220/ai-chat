import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { MemoryStore } from '../dist/storage.js';
import { buildWebState, syncWebOwnerContact } from '../dist/web.js';

const baseConfig = {
  deepseek: {
    apiKey: 'test',
    baseUrl: 'https://api.deepseek.com',
    fastModel: 'deepseek-v4-flash',
    proModel: 'deepseek-v4-pro',
    timeoutMs: 1000,
  },
  wechaty: {
    puppet: 'wechaty-puppet-oicq',
  },
  web: {
    host: '127.0.0.1',
    port: 3000,
    loginPassword: 'web-password-456',
    contactId: 'web-owner',
    historyLimit: 20,
  },
  ownerBindSecret: 'owner-secret-123',
  memoryEncryptionKey: 'memory-secret-123',
  databasePath: '',
  modelRouting: 'auto',
  recentMessageLimit: 18,
  summaryThreshold: 20,
  summaryMessageLimit: 120,
};

test('syncs the owner to the web contact and exposes recent state', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-chat-web-test-'));
  const dbPath = path.join(dir, 'memory.sqlite');
  const store = await MemoryStore.open(dbPath, baseConfig.memoryEncryptionKey);

  t.after(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  store.setOwnerId('old-qq-owner');
  store.addMessage('web-owner', 'user', '你好');
  store.addMessage('web-owner', 'assistant', '你好呀', 'deepseek-v4-flash');
  store.addSummary('web-owner', '用户喜欢深夜聊天。', 2);

  syncWebOwnerContact(store, 'web-owner');
  const state = buildWebState(store, { ...baseConfig, databasePath: dbPath });

  assert.equal(store.getOwnerId(), 'web-owner');
  assert.equal(state.messageCount, 2);
  assert.equal(state.summaryCount, 1);
  assert.equal(state.messages[0].content, '你好');
  assert.equal(state.messages[1].model, 'deepseek-v4-flash');
});
