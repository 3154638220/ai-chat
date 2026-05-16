import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import type { ModelMode } from './types.js';

export interface AppConfig {
  deepseek: {
    apiKey: string;
    baseUrl: string;
    fastModel: string;
    proModel: string;
    timeoutMs: number;
  };
  wechaty: {
    puppet: string;
    puppetServiceToken: string;
  };
  ownerBindSecret: string;
  memoryEncryptionKey: string;
  databasePath: string;
  modelRouting: ModelMode;
  recentMessageLimit: number;
  summaryThreshold: number;
  summaryMessageLimit: number;
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optionalInt(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }
  return parsed;
}

function parseMode(raw: string | undefined): ModelMode {
  const value = (raw ?? 'auto').trim();
  if (value === 'fast' || value === 'pro' || value === 'auto') {
    return value;
  }
  throw new Error('MODEL_ROUTING must be one of: fast, pro, auto');
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  loadDotenv();

  const ownerBindSecret = required(env, 'OWNER_BIND_SECRET');
  if (ownerBindSecret.length < 12) {
    throw new Error('OWNER_BIND_SECRET should be at least 12 characters');
  }

  return {
    deepseek: {
      apiKey: required(env, 'DEEPSEEK_API_KEY'),
      baseUrl: env.DEEPSEEK_BASE_URL?.trim() || 'https://api.deepseek.com',
      fastModel: env.DEEPSEEK_FAST_MODEL?.trim() || 'deepseek-v4-flash',
      proModel: env.DEEPSEEK_PRO_MODEL?.trim() || 'deepseek-v4-pro',
      timeoutMs: optionalInt(env, 'DEEPSEEK_TIMEOUT_MS', 45_000),
    },
    wechaty: {
      puppet: env.WECHATY_PUPPET?.trim() || 'wechaty-puppet-service',
      puppetServiceToken: required(env, 'WECHATY_PUPPET_SERVICE_TOKEN'),
    },
    ownerBindSecret,
    memoryEncryptionKey: required(env, 'MEMORY_ENCRYPTION_KEY'),
    databasePath: path.resolve(env.DATABASE_PATH?.trim() || 'data/memory.sqlite'),
    modelRouting: parseMode(env.MODEL_ROUTING),
    recentMessageLimit: optionalInt(env, 'RECENT_MESSAGE_LIMIT', 18),
    summaryThreshold: optionalInt(env, 'SUMMARY_THRESHOLD', 20),
    summaryMessageLimit: optionalInt(env, 'SUMMARY_MESSAGE_LIMIT', 120),
  };
}
