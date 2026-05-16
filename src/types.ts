export type ChatRole = 'system' | 'user' | 'assistant';

export interface DeepSeekMessage {
  role: ChatRole;
  content: string;
}

export type ModelMode = 'fast' | 'pro' | 'auto';

export interface ModelRoute {
  mode: ModelMode;
  model: string;
  reason: string;
}

export interface StoredMessage {
  id: number;
  contactId: string;
  role: 'user' | 'assistant';
  content: string;
  model: string | null;
  createdAt: string;
}

export interface IncomingTextMessage {
  contactId: string;
  contactName?: string;
  text: string;
  isSelf: boolean;
  isRoom: boolean;
}

export type MessageAction =
  | { kind: 'ignore'; reason: string }
  | { kind: 'reply'; text: string };
