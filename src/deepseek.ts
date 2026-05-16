import type { AppConfig } from './config.js';
import type { DeepSeekMessage } from './types.js';

export class DeepSeekError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = 'DeepSeekError';
  }
}

export interface ChatCompletionResult {
  content: string;
  model: string;
}

export class DeepSeekClient {
  constructor(private readonly config: AppConfig['deepseek']) {}

  async chat(messages: DeepSeekMessage[], model: string): Promise<ChatCompletionResult> {
    const url = new URL('/chat/completions', this.config.baseUrl.replace(/\/+$/, '/'));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.85,
          stream: false,
        }),
        signal: controller.signal,
      });

      const body = await response.text();
      if (!response.ok) {
        throw new DeepSeekError(`DeepSeek API returned HTTP ${response.status}`, response.status, body.slice(0, 1000));
      }

      let parsed: any;
      try {
        parsed = JSON.parse(body);
      } catch (error) {
        throw new DeepSeekError('DeepSeek API returned invalid JSON', response.status, body.slice(0, 1000));
      }

      const content = parsed?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) {
        throw new DeepSeekError('DeepSeek API returned an empty response', response.status, body.slice(0, 1000));
      }

      return {
        content: content.trim(),
        model: parsed.model || model,
      };
    } catch (error) {
      if (error instanceof DeepSeekError) {
        throw error;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new DeepSeekError('DeepSeek API request timed out');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
