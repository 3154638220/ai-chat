import fs from 'node:fs/promises';
import path from 'node:path';
import type { AppConfig } from './config.js';
import { ConversationService } from './conversation.js';
import { DeepSeekClient } from './deepseek.js';
import type { Logger } from './logger.js';
import { SerialTaskQueue } from './queue.js';
import { MemoryStore } from './storage.js';
import type { IncomingTextMessage } from './types.js';

const LOGIN_QR_HTML_PATH = path.resolve('data/latest-login-qr.html');
const LOGIN_QR_TXT_PATH = path.resolve('data/latest-login-qr.txt');

async function dynamicImport<T>(moduleName: string): Promise<T> {
  const importer = new Function('moduleName', 'return import(moduleName)');
  return importer(moduleName) as Promise<T>;
}

interface BotBuildOptions {
  name: string;
  puppet: string;
  puppetOptions?: {
    token: string;
  };
}

export function applyWechatyEnvironment(config: AppConfig, env: NodeJS.ProcessEnv = process.env): void {
  env.WECHATY_PUPPET = config.wechaty.puppet;

  if (config.wechaty.puppetServiceToken) {
    env.WECHATY_PUPPET_SERVICE_TOKEN = config.wechaty.puppetServiceToken;
  } else {
    delete env.WECHATY_PUPPET_SERVICE_TOKEN;
  }

  if (config.wechaty.oicqQq) {
    env.WECHATY_PUPPET_OICQ_QQ = config.wechaty.oicqQq;
  } else {
    delete env.WECHATY_PUPPET_OICQ_QQ;
  }
}

export function buildWechatyOptions(config: AppConfig): BotBuildOptions {
  const options: BotBuildOptions = {
    name: 'ai-chat-companion',
    puppet: config.wechaty.puppet,
  };

  if (config.wechaty.puppetServiceToken) {
    options.puppetOptions = {
      token: config.wechaty.puppetServiceToken,
    };
  }

  return options;
}

async function persistScanArtifacts(scanUrl: string): Promise<void> {
  await fs.mkdir(path.dirname(LOGIN_QR_HTML_PATH), { recursive: true });
  const escapedUrl = escapeHtml(scanUrl);
  const escapedTime = escapeHtml(new Date().toISOString());
  const html = [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '  <meta charset="utf-8">',
    '  <meta http-equiv="refresh" content="5">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    '  <title>Latest Login QR</title>',
    '  <style>',
    '    body { font-family: sans-serif; margin: 24px; background: #f5f5f5; color: #111; }',
    '    .card { max-width: 520px; background: #fff; border-radius: 16px; padding: 20px; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.08); }',
    '    iframe { width: 100%; height: 520px; border: 0; background: #fff; }',
    '    code { word-break: break-all; display: block; margin-top: 12px; }',
    '  </style>',
    '</head>',
    '<body>',
    '  <div class="card">',
    '    <h1>QQ Login QR</h1>',
    '    <p>这个页面每 5 秒自动刷新一次。保持它打开，用手机 QQ 扫描下面的二维码。</p>',
    `    <p>Last updated: ${escapedTime}</p>`,
    `    <iframe src="${escapedUrl}" title="QQ Login QR"></iframe>`,
    `    <code>${escapedUrl}</code>`,
    '  </div>',
    '</body>',
    '</html>',
  ].join('\n');

  await fs.writeFile(LOGIN_QR_HTML_PATH, html, 'utf8');
  await fs.writeFile(LOGIN_QR_TXT_PATH, `${scanUrl}\n`, 'utf8');
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export async function startBot(config: AppConfig, logger: Logger): Promise<void> {
  applyWechatyEnvironment(config);

  const store = await MemoryStore.open(config.databasePath, config.memoryEncryptionKey);
  const ai = new DeepSeekClient(config.deepseek);
  const conversation = new ConversationService(config, store, ai, logger);
  const queue = new SerialTaskQueue();

  const { WechatyBuilder } = await dynamicImport<any>('wechaty');
  const bot = WechatyBuilder.build(buildWechatyOptions(config));

  let loggedInUser = 'unknown';

  bot.on('scan', (qrcode: string, status: unknown) => {
    const scanUrl = `https://wechaty.js.org/qrcode/${encodeURIComponent(qrcode)}`;
    const extraHint = config.wechaty.puppet === 'wechaty-puppet-oicq'
      ? 'If the QQ login flow asks you to press Enter after scanning, follow the terminal prompt.'
      : undefined;

    void persistScanArtifacts(scanUrl).catch((error) => {
      logger.warn('failed to persist login qr', { error: error instanceof Error ? error.message : String(error) });
    });

    logger.info('scan qrcode to login', { status, scanUrl, extraHint });
    console.log(`Scan QR Code: ${scanUrl}`);
    if (extraHint) {
      console.log(extraHint);
    }
  });

  bot.on('login', (user: any) => {
    loggedInUser = safeContactName(user);
    logger.info('bot login', { user: loggedInUser });
  });

  bot.on('logout', (user: any) => {
    logger.warn('bot logout', { user: safeContactName(user) });
  });

  bot.on('friendship', () => {
    logger.info('friendship event ignored');
  });

  bot.on('message', (message: any) => {
    void queue.enqueue(messageIdForQueue(message), async () => {
      const incoming = await toIncomingTextMessage(message);
      if (!incoming) return;
      const action = await conversation.handleIncomingMessage(incoming);
      if (action.kind === 'reply') {
        await message.say(action.text);
      } else {
        logger.debug('message ignored', action.reason);
      }
    }).catch((error) => {
      logger.error('message handling failed', error instanceof Error ? error.message : String(error));
    });
  });

  const stop = async (signal: string) => {
    logger.info('stopping bot', { signal, loggedInUser });
    try {
      await bot.stop();
    } finally {
      store.close();
      process.exit(0);
    }
  };

  process.once('SIGINT', () => void stop('SIGINT'));
  process.once('SIGTERM', () => void stop('SIGTERM'));

  await bot.start();
  logger.info('bot started');
}

async function toIncomingTextMessage(message: any): Promise<IncomingTextMessage | null> {
  const text = typeof message.text === 'function' ? message.text() : '';
  if (typeof text !== 'string') {
    return null;
  }

  const talker = typeof message.talker === 'function' ? message.talker() : null;
  const room = typeof message.room === 'function' ? message.room() : null;
  const contactId = String(talker?.id ?? 'unknown');

  return {
    contactId,
    contactName: safeContactName(talker),
    text,
    isSelf: typeof message.self === 'function' ? Boolean(message.self()) : false,
    isRoom: Boolean(room),
  };
}

function safeContactName(contact: any): string {
  try {
    if (!contact) return 'unknown';
    if (typeof contact.name === 'function') return String(contact.name());
    if (typeof contact.toString === 'function') return String(contact.toString());
    return String(contact.id ?? 'unknown');
  } catch {
    return 'unknown';
  }
}

function messageIdForQueue(message: any): string {
  try {
    const talker = typeof message.talker === 'function' ? message.talker() : null;
    return String(talker?.id ?? 'unknown');
  } catch {
    return 'unknown';
  }
}
