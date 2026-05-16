import type { AppConfig } from './config.js';
import { buildChatMessages, buildSummaryMessages } from './context.js';
import type { DeepSeekClient } from './deepseek.js';
import { chooseModelRoute } from './modelRouting.js';
import type { MemoryStore } from './storage.js';
import type { MessageAction, IncomingTextMessage, ModelMode, StoredMessage } from './types.js';
import type { Logger } from './logger.js';

export interface ChatAiClient {
  chat(messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>, model: string): Promise<{ content: string; model: string }>;
}

export class ConversationService {
  constructor(
    private readonly config: AppConfig,
    private readonly store: MemoryStore,
    private readonly ai: ChatAiClient | DeepSeekClient,
    private readonly logger: Logger,
  ) {}

  async handleIncomingMessage(message: IncomingTextMessage): Promise<MessageAction> {
    if (message.isSelf) {
      return { kind: 'ignore', reason: 'self-message' };
    }
    if (message.isRoom) {
      return { kind: 'ignore', reason: 'room-message' };
    }

    const text = message.text.trim();
    if (!text) {
      return { kind: 'ignore', reason: 'empty-message' };
    }

    const ownerId = this.store.getOwnerId();

    if (text.startsWith('/bind ')) {
      return this.handleBind(message.contactId, text, ownerId);
    }

    if (!ownerId) {
      return { kind: 'reply', text: '还没有绑定主人，请先发送 /bind 加上你的绑定口令。' };
    }

    if (message.contactId !== ownerId) {
      return { kind: 'ignore', reason: 'non-owner-message' };
    }

    if (text === '/status') {
      return { kind: 'reply', text: this.buildStatus(message.contactId) };
    }

    if (text.startsWith('/mode ')) {
      return this.handleModeCommand(text);
    }

    if (text === '/reset-summary') {
      return this.handleResetSummary(message.contactId);
    }

    if (text.startsWith('/pro')) {
      const forcedText = text.replace(/^\/pro\s*/, '').trim();
      if (!forcedText) {
        return { kind: 'reply', text: '想让我认真想哪件事？把内容接在 /pro 后面发给我。' };
      }
      return this.replyWithAi(message.contactId, forcedText, true);
    }

    return this.replyWithAi(message.contactId, text, false);
  }

  private handleBind(contactId: string, text: string, ownerId: string | null): MessageAction {
    const secret = text.replace(/^\/bind\s+/, '').trim();
    if (secret !== this.config.ownerBindSecret) {
      return { kind: 'reply', text: '绑定口令不对。' };
    }

    if (ownerId && ownerId !== contactId) {
      return { kind: 'ignore', reason: 'owner-already-bound' };
    }

    this.store.setOwnerId(contactId);
    this.store.getModelMode(this.config.modelRouting);
    return { kind: 'reply', text: '绑定好了。以后我只回复你。' };
  }

  private handleModeCommand(text: string): MessageAction {
    const raw = text.replace(/^\/mode\s+/, '').trim();
    if (raw !== 'fast' && raw !== 'pro' && raw !== 'auto') {
      return { kind: 'reply', text: '模式只能是 fast、pro 或 auto。' };
    }

    this.store.setModelMode(raw);
    const label: Record<ModelMode, string> = {
      fast: '已切到 fast，日常聊天会更快。',
      pro: '已切到 pro，我会更认真想，但回复可能慢一点。',
      auto: '已切到 auto，我会按内容自动选择模型。',
    };
    return { kind: 'reply', text: label[raw] };
  }

  private async replyWithAi(contactId: string, text: string, forcePro: boolean): Promise<MessageAction> {
    this.store.addMessage(contactId, 'user', text);
    const mode = this.store.getModelMode(this.config.modelRouting);
    const route = chooseModelRoute(text, mode, this.config, forcePro);
    const summary = this.store.getLatestSummary(contactId);
    const recentMessages = this.store.getRecentMessages(contactId, this.config.recentMessageLimit);
    const chatMessages = buildChatMessages({
      longTermSummary: summary?.text ?? null,
      recentMessages,
    });

    try {
      const response = await this.ai.chat(chatMessages, route.model);
      this.store.addMessage(contactId, 'assistant', response.content, response.model);
      void this.refreshSummaryIfNeeded(contactId).catch((error) => {
        this.logger.warn('summary refresh failed', error instanceof Error ? error.message : String(error));
      });
      return { kind: 'reply', text: response.content };
    } catch (error) {
      this.logger.error('ai reply failed', error instanceof Error ? error.message : String(error));
      return { kind: 'reply', text: '我这会儿有点连不上脑袋，等一下再跟我说一次好不好。' };
    }
  }

  private buildStatus(contactId: string): string {
    const mode = this.store.getModelMode(this.config.modelRouting);
    const messageCount = this.store.getMessageCount(contactId);
    const summaryCount = this.store.getSummaryCount(contactId);
    const latestSummary = this.store.getLatestSummary(contactId);
    const summaryUntil = latestSummary?.sourceMessageUntilId ?? 0;
    return [
      '状态正常。',
      `模型模式：${mode}`,
      `记忆消息：${messageCount} 条`,
      `长期摘要：${summaryCount} 版`,
      `摘要进度：到第 ${summaryUntil} 条消息`,
    ].join('\n');
  }

  private async handleResetSummary(contactId: string): Promise<MessageAction> {
    this.store.clearSummaries(contactId);
    let sourceMessageUntilId = 0;
    let summary: string | null = null;

    try {
      while (true) {
        const batch = this.store.getMessagesAfter(contactId, sourceMessageUntilId, this.config.summaryMessageLimit);
        if (batch.length === 0) {
          break;
        }
        summary = await this.createSummary(summary, batch);
        sourceMessageUntilId = batch[batch.length - 1]?.id ?? sourceMessageUntilId;
      }

      if (!summary) {
        return { kind: 'reply', text: '现在还没有可整理的聊天记忆。' };
      }

      this.store.addSummary(contactId, summary, sourceMessageUntilId);
      return { kind: 'reply', text: '长期记忆摘要已经重新整理好了，原始聊天记录没有删除。' };
    } catch (error) {
      this.logger.error('summary reset failed', error instanceof Error ? error.message : String(error));
      return { kind: 'reply', text: '我刚刚整理记忆失败了，原始聊天记录还在，晚点再试一次。' };
    }
  }

  private async refreshSummaryIfNeeded(contactId: string): Promise<void> {
    const latest = this.store.getLatestSummary(contactId);
    const afterId = latest?.sourceMessageUntilId ?? 0;
    const newMessages = this.store.getMessagesAfter(contactId, afterId, this.config.summaryMessageLimit);
    if (newMessages.length < this.config.summaryThreshold) {
      return;
    }

    const summary = await this.createSummary(latest?.text ?? null, newMessages);
    const maxId = newMessages[newMessages.length - 1]?.id ?? this.store.getMaxMessageId(contactId);
    this.store.addSummary(contactId, summary, maxId);
  }

  private async createSummary(existingSummary: string | null, messages: StoredMessage[]): Promise<string> {
    const summaryMessages = buildSummaryMessages({ existingSummary, messages });
    const result = await this.ai.chat(summaryMessages, this.config.deepseek.fastModel);
    return result.content;
  }
}
