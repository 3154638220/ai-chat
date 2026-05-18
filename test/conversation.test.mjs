import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ConversationService } from '../dist/conversation.js';
import { MemoryStore } from '../dist/storage.js';

const config = {
  deepseek: {
    apiKey: 'test',
    baseUrl: 'https://api.deepseek.com',
    fastModel: 'deepseek-v4-flash',
    proModel: 'deepseek-v4-pro',
    timeoutMs: 1000,
  },
  wechaty: {
    puppet: 'wechaty-puppet-service',
    puppetServiceToken: 'token',
  },
  persona: {
    assistantIdentity: '她叫林绪，是用户熟悉的学姐。',
    assistantProfile: '说话偏克制，观察力强，很会照顾情绪。',
    userIdentity: '用户叫周沉。',
    userProfile: '爱好是摄影和散步，特长是写代码和做规划。',
    relationshipBackground: '两人认识很多年，默认彼此知道对方身份。',
  },
  ownerBindSecret: 'owner-secret-123',
  memoryEncryptionKey: 'memory-secret-123',
  databasePath: '',
  modelRouting: 'auto',
  recentMessageLimit: 18,
  summaryThreshold: 20,
  summaryMessageLimit: 120,
};

const logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

async function makeService(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-chat-test-'));
  const dbPath = path.join(dir, 'memory.sqlite');
  const store = await MemoryStore.open(dbPath, config.memoryEncryptionKey);
  const calls = [];
  const ai = {
    async chat(messages, model) {
      calls.push({ messages, model });
      return { content: `reply from ${model}`, model };
    },
  };
  t.after(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return {
    service: new ConversationService({ ...config, databasePath: dbPath }, store, ai, logger),
    store,
    calls,
    dbPath,
  };
}

test('binds owner and ignores non-owner messages', async (t) => {
  const { service, store } = await makeService(t);

  const bind = await service.handleIncomingMessage({
    contactId: 'owner',
    text: '/bind owner-secret-123',
    isSelf: false,
    isRoom: false,
  });
  assert.equal(bind.kind, 'reply');
  assert.equal(store.getOwnerId(), 'owner');

  const ignored = await service.handleIncomingMessage({
    contactId: 'someone-else',
    text: 'hello',
    isSelf: false,
    isRoom: false,
  });
  assert.deepEqual(ignored, { kind: 'ignore', reason: 'non-owner-message' });
});

test('ignores self and room messages', async (t) => {
  const { service } = await makeService(t);

  assert.equal((await service.handleIncomingMessage({
    contactId: 'owner',
    text: 'hello',
    isSelf: true,
    isRoom: false,
  })).kind, 'ignore');

  assert.equal((await service.handleIncomingMessage({
    contactId: 'owner',
    text: 'hello',
    isSelf: false,
    isRoom: true,
  })).kind, 'ignore');
});

test('routes chat through ai and stores encrypted memory', async (t) => {
  const { service, store, calls, dbPath } = await makeService(t);

  await service.handleIncomingMessage({
    contactId: 'owner',
    text: '/bind owner-secret-123',
    isSelf: false,
    isRoom: false,
  });
  const reply = await service.handleIncomingMessage({
    contactId: 'owner',
    text: '今天想你了',
    isSelf: false,
    isRoom: false,
  });

  assert.equal(reply.kind, 'reply');
  assert.equal(calls[0].model, 'deepseek-v4-flash');
  assert.match(calls[0].messages[0].content, /林绪/);
  assert.match(calls[0].messages[0].content, /照顾情绪/);
  assert.match(calls[0].messages[0].content, /周沉/);
  assert.match(calls[0].messages[0].content, /摄影/);
  assert.equal(store.getMessageCount('owner'), 2);

  const dbBytes = fs.readFileSync(dbPath);
  assert.equal(dbBytes.includes(Buffer.from('今天想你了')), false);
});

test('supports mode and pro commands', async (t) => {
  const { service, calls } = await makeService(t);
  await service.handleIncomingMessage({ contactId: 'owner', text: '/bind owner-secret-123', isSelf: false, isRoom: false });

  const mode = await service.handleIncomingMessage({ contactId: 'owner', text: '/mode pro', isSelf: false, isRoom: false });
  assert.equal(mode.kind, 'reply');

  await service.handleIncomingMessage({ contactId: 'owner', text: '普通消息', isSelf: false, isRoom: false });
  assert.equal(calls.at(-1).model, 'deepseek-v4-pro');

  await service.handleIncomingMessage({ contactId: 'owner', text: '/mode fast', isSelf: false, isRoom: false });
  await service.handleIncomingMessage({ contactId: 'owner', text: '/pro 帮我认真分析一下', isSelf: false, isRoom: false });
  assert.equal(calls.at(-1).model, 'deepseek-v4-pro');
});

test('strips parenthetical action text from assistant replies', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-chat-test-'));
  const dbPath = path.join(dir, 'memory.sqlite');
  const store = await MemoryStore.open(dbPath, config.memoryEncryptionKey);
  const ai = {
    async chat() {
      return {
        content: '晚上好呀（轻笑） 今天还顺利吗？【摸摸头】[靠近一点]',
        model: 'deepseek-v4-flash',
      };
    },
  };

  t.after(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const service = new ConversationService({ ...config, databasePath: dbPath }, store, ai, logger);

  await service.handleIncomingMessage({ contactId: 'owner', text: '/bind owner-secret-123', isSelf: false, isRoom: false });
  const reply = await service.handleIncomingMessage({ contactId: 'owner', text: '晚上好', isSelf: false, isRoom: false });

  assert.equal(reply.kind, 'reply');
  assert.equal(reply.text.includes('（'), false);
  assert.equal(reply.text.includes('【'), false);
  assert.equal(reply.text.includes('['), false);
  assert.match(reply.text, /晚上好呀/);
});
