import { buildPersonaPrompt, type PersonaContext } from './persona.js';
import type { DeepSeekMessage, StoredMessage } from './types.js';

export function buildChatMessages(params: {
  persona: PersonaContext;
  longTermSummary: string | null;
  recentMessages: StoredMessage[];
}): DeepSeekMessage[] {
  const messages: DeepSeekMessage[] = [
    { role: 'system', content: buildPersonaPrompt(params.persona) },
  ];

  if (params.longTermSummary?.trim()) {
    messages.push({
      role: 'system',
      content: `以下是你需要持续记住的长期记忆摘要：\n${params.longTermSummary.trim()}`,
    });
  }

  for (const item of params.recentMessages) {
    messages.push({
      role: item.role,
      content: item.content,
    });
  }

  return messages;
}

export function buildSummaryMessages(params: {
  existingSummary: string | null;
  messages: StoredMessage[];
}): DeepSeekMessage[] {
  const transcript = params.messages
    .map((message) => `${message.role === 'user' ? '用户' : '你'}：${message.content}`)
    .join('\n');

  return [
    {
      role: 'system',
      content: [
        '你负责维护一份长期关系记忆摘要。',
        '请保留稳定事实、偏好、重要人物、长期压力源、承诺、边界和情绪模式。',
        '不要逐字复制聊天记录，不要编造没有出现过的信息。',
        '输出中文，控制在 800 字以内。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        params.existingSummary?.trim()
          ? `已有摘要：\n${params.existingSummary.trim()}`
          : '已有摘要：无',
        `新增聊天记录：\n${transcript}`,
        '请输出更新后的摘要。',
      ].join('\n\n'),
    },
  ];
}
