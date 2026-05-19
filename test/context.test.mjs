import assert from 'node:assert/strict';
import test from 'node:test';
import { buildChatMessages, buildSummaryMessages } from '../dist/context.js';

test('builds chat messages with persona, summary, and recent history', () => {
  const messages = buildChatMessages({
    persona: {
      assistantIdentity: '她叫林绪，是比用户大两届的学姐。',
      assistantProfile: '说话克制，习惯先观察情绪再回应；擅长安抚人，也很会抓细节。',
      userIdentity: '用户叫周沉，是她一直偏心照顾的人。',
      userProfile: '爱好是摄影、散步、看科幻片；特长是写代码、做规划；遇到压力时容易先自己扛着。',
      relationshipBackground: '两人认识很多年，平时默认互相熟悉。',
    },
    longTermSummary: '用户喜欢晚上散步。',
    recentMessages: [
      { id: 1, contactId: 'u1', role: 'user', content: '今天好累', model: null, createdAt: 'now' },
      { id: 2, contactId: 'u1', role: 'assistant', content: '抱抱你。', model: 'm', createdAt: 'now' },
    ],
  });

  assert.equal(messages[0].role, 'system');
  assert.match(messages[0].content, /学姐/);
  assert.match(messages[0].content, /不要直接用全名称呼他/);
  assert.match(messages[0].content, /林绪/);
  assert.match(messages[0].content, /说话克制/);
  assert.match(messages[0].content, /周沉/);
  assert.match(messages[0].content, /摄影/);
  assert.match(messages[0].content, /写代码/);
  assert.match(messages[0].content, /默认彼此已知/);
  assert.match(messages[1].content, /用户喜欢晚上散步/);
  assert.match(messages[2].content, /优先以上面的默认资料为准/);
  assert.match(messages[2].content, /我的爱好是什么/);
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
