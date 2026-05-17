import assert from 'node:assert/strict';
import test from 'node:test';
import { buildChatMessages, buildSummaryMessages } from '../dist/context.js';

test('builds chat messages with persona, summary, and recent history', () => {
  const messages = buildChatMessages({
    longTermSummary: '用户喜欢晚上散步。',
    recentMessages: [
      { id: 1, contactId: 'u1', role: 'user', content: '今天好累', model: null, createdAt: 'now' },
      { id: 2, contactId: 'u1', role: 'assistant', content: '抱抱你。', model: 'm', createdAt: 'now' },
    ],
  });

  assert.equal(messages[0].role, 'system');
  assert.match(messages[0].content, /学姐/);
  assert.match(messages[1].content, /用户喜欢晚上散步/);
  assert.equal(messages.at(-1).content, '抱抱你。');
});

test('builds summary prompt without losing existing summary', () => {
  const messages = buildSummaryMessages({
    existingSummary: '用户最近在准备考试。',
    messages: [
      { id: 1, contactId: 'u1', role: 'user', content: '我明天考试', model: null, createdAt: 'now' },
    ],
  });

  assert.match(messages[1].content, /准备考试/);
  assert.match(messages[1].content, /我明天考试/);
});
