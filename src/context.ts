import { buildPersonaPrompt, type PersonaContext } from './persona.js';
import type { DeepSeekMessage, StoredMessage } from './types.js';

function hasDefaultPersonaFacts(persona: PersonaContext): boolean {
  return [
    persona.assistantIdentity,
    persona.assistantProfile,
    persona.userIdentity,
    persona.userProfile,
    persona.relationshipBackground,
  ].some((value) => value?.trim());
}

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

  if (hasDefaultPersonaFacts(params.persona)) {
    messages.push({
      role: 'system',
      content: [
        '关于你和用户的身份、专业、爱好、特长、性格、经历、关系这些稳定资料，优先以上面的默认资料为准。',
        '如果默认资料与长期记忆摘要、过往聊天记录或你之前说过的话冲突，一律以默认资料为准，不要沿用旧说法。',
        '尤其当用户直接问“我是谁”“我的爱好是什么”“你是什么样的人”这类问题时，先依据默认资料回答；默认资料没有写到的，再谨慎参考记忆。',
      ].join('\n'),
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
