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
    puppetServiceToken?: string;
    oicqQq?: string;
  };
  web: {
    host: string;
    port: number;
    loginPassword: string;
    contactId: string;
    historyLimit: number;
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

function resolveSecrets(env: NodeJS.ProcessEnv): { ownerBindSecret: string; webLoginPassword: string } {
  const ownerBindSecret = env.OWNER_BIND_SECRET?.trim() || '';
  const webLoginPassword = env.WEB_LOGIN_PASSWORD?.trim() || ownerBindSecret;
  const effectiveSecret = ownerBindSecret || webLoginPassword;

  if (!effectiveSecret) {
    throw new Error('Missing required environment variable: OWNER_BIND_SECRET or WEB_LOGIN_PASSWORD');
  }
  if (effectiveSecret.length < 12) {
    throw new Error('OWNER_BIND_SECRET or WEB_LOGIN_PASSWORD should be at least 12 characters');
  }
  if (webLoginPassword.length < 12) {
    throw new Error('WEB_LOGIN_PASSWORD should be at least 12 characters');
  }

  return {
    ownerBindSecret: effectiveSecret,
    webLoginPassword,
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  loadDotenv();

  const secrets = resolveSecrets(env);

  return {
    deepseek: {
      apiKey: required(env, 'DEEPSEEK_API_KEY'),
      baseUrl: env.DEEPSEEK_BASE_URL?.trim() || 'https://api.deepseek.com',
      fastModel: env.DEEPSEEK_FAST_MODEL?.trim() || 'deepseek-v4-flash',
      proModel: env.DEEPSEEK_PRO_MODEL?.trim() || 'deepseek-v4-pro',
      timeoutMs: optionalInt(env, 'DEEPSEEK_TIMEOUT_MS', 45_000),
    },
    wechaty: {
      puppet: env.WECHATY_PUPPET?.trim() || 'wechaty-puppet-oicq',
      puppetServiceToken: env.WECHATY_PUPPET_SERVICE_TOKEN?.trim() || undefined,
      oicqQq: env.WECHATY_PUPPET_OICQ_QQ?.trim() || undefined,
    },
    web: {
      host: env.WEB_HOST?.trim() || '0.0.0.0',
      port: optionalInt(env, 'WEB_PORT', 3000),
      loginPassword: secrets.webLoginPassword,
      contactId: env.WEB_CONTACT_ID?.trim() || 'web-owner',
      historyLimit: optionalInt(env, 'WEB_HISTORY_LIMIT', 60),
    },
    ownerBindSecret: secrets.ownerBindSecret,
    memoryEncryptionKey: required(env, 'MEMORY_ENCRYPTION_KEY'),
    databasePath: path.resolve(env.DATABASE_PATH?.trim() || 'data/memory.sqlite'),
    modelRouting: parseMode(env.MODEL_ROUTING),
    recentMessageLimit: optionalInt(env, 'RECENT_MESSAGE_LIMIT', 18),
    summaryThreshold: optionalInt(env, 'SUMMARY_THRESHOLD', 20),
    summaryMessageLimit: optionalInt(env, 'SUMMARY_MESSAGE_LIMIT', 120),
  };
}
