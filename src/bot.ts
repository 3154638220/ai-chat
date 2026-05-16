import type { AppConfig } from './config.js';
import { ConversationService } from './conversation.js';
import { DeepSeekClient } from './deepseek.js';
import type { Logger } from './logger.js';
import { SerialTaskQueue } from './queue.js';
import { MemoryStore } from './storage.js';
import type { IncomingTextMessage } from './types.js';

async function dynamicImport<T>(moduleName: string): Promise<T> {
  const importer = new Function('moduleName', 'return import(moduleName)');
  return importer(moduleName) as Promise<T>;
}

export async function startBot(config: AppConfig, logger: Logger): Promise<void> {
  process.env.WECHATY_PUPPET = config.wechaty.puppet;
  process.env.WECHATY_PUPPET_SERVICE_TOKEN = config.wechaty.puppetServiceToken;

  const store = await MemoryStore.open(config.databasePath, config.memoryEncryptionKey);
  const ai = new DeepSeekClient(config.deepseek);
  const conversation = new ConversationService(config, store, ai, logger);
  const queue = new SerialTaskQueue();

  const { WechatyBuilder } = await dynamicImport<any>('wechaty');
  const bot = WechatyBuilder.build({
    name: 'ai-wechat-girlfriend',
    puppet: config.wechaty.puppet,
    puppetOptions: {
      token: config.wechaty.puppetServiceToken,
    },
  });

  let loggedInUser = 'unknown';

  bot.on('scan', (qrcode: string, status: unknown) => {
    const scanUrl = `https://wechaty.js.org/qrcode/${encodeURIComponent(qrcode)}`;
    logger.info('scan qrcode to login', { status, scanUrl });
    console.log(`Scan QR Code: ${scanUrl}`);
  });

  bot.on('login', (user: any) => {
    loggedInUser = safeContactName(user);
    logger.info('wechat login', { user: loggedInUser });
  });

  bot.on('logout', (user: any) => {
    logger.warn('wechat logout', { user: safeContactName(user) });
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
