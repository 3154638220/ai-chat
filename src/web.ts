import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AppConfig } from './config.js';
import { ConversationService } from './conversation.js';
import { DeepSeekClient } from './deepseek.js';
import type { Logger } from './logger.js';
import { SerialTaskQueue } from './queue.js';
import { MemoryStore } from './storage.js';
import type { StoredMessage } from './types.js';

const PUBLIC_DIR = path.resolve('public');
const SESSION_COOKIE = 'ai_chat_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface SessionState {
  expiresAt: number;
}

interface WebMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  model: string | null;
}

interface WebState {
  messages: WebMessage[];
  mode: string;
  messageCount: number;
  summaryCount: number;
  summaryUntil: number;
}

export function syncWebOwnerContact(store: MemoryStore, contactId: string, logger?: Logger): void {
  const previousOwner = store.getOwnerId();
  if (previousOwner === contactId) {
    return;
  }

  store.setOwnerId(contactId);
  logger?.info('web owner contact set', {
    previousOwnerId: previousOwner,
    contactId,
  });
}

export function buildWebState(store: MemoryStore, config: AppConfig): WebState {
  const contactId = config.web.contactId;
  const latestSummary = store.getLatestSummary(contactId);
  return {
    messages: store.getAllMessages(contactId, config.web.historyLimit).map(toWebMessage),
    mode: store.getModelMode(config.modelRouting),
    messageCount: store.getMessageCount(contactId),
    summaryCount: store.getSummaryCount(contactId),
    summaryUntil: latestSummary?.sourceMessageUntilId ?? 0,
  };
}

export async function startWebServer(config: AppConfig, logger: Logger): Promise<void> {
  const store = await MemoryStore.open(config.databasePath, config.memoryEncryptionKey);
  const ai = new DeepSeekClient(config.deepseek);
  const conversation = new ConversationService(config, store, ai, logger);
  const queue = new SerialTaskQueue();
  const sessions = new Map<string, SessionState>();

  syncWebOwnerContact(store, config.web.contactId, logger);

  const server = createServer((req, res) => {
    void handleRequest(req, res).catch((error) => {
      logger.error('web request failed', error instanceof Error ? error.message : String(error));
      sendJson(res, 500, { error: 'internal-error' });
    });
  });

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method ?? 'GET';
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;

    if (method === 'GET' && pathname === '/') {
      return serveStatic(res, 'index.html', 'text/html; charset=utf-8');
    }
    if (method === 'GET' && pathname === '/app.js') {
      return serveStatic(res, 'app.js', 'application/javascript; charset=utf-8');
    }
    if (method === 'GET' && pathname === '/styles.css') {
      return serveStatic(res, 'styles.css', 'text/css; charset=utf-8');
    }
    if (method === 'GET' && pathname === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (method === 'GET' && pathname === '/api/session') {
      return sendJson(res, 200, { authenticated: getSession(req) !== null });
    }

    if (method === 'POST' && pathname === '/api/login') {
      const body = await readJsonBody(req);
      const password = typeof body.password === 'string' ? body.password : '';
      if (!safeEquals(password, config.web.loginPassword)) {
        return sendJson(res, 401, { error: 'invalid-password' });
      }

      const sessionId = randomBytes(24).toString('base64url');
      sessions.set(sessionId, { expiresAt: Date.now() + SESSION_TTL_MS });
      res.setHeader('Set-Cookie', buildSessionCookie(sessionId, SESSION_TTL_MS));
      return sendJson(res, 200, { ok: true });
    }

    if (method === 'POST' && pathname === '/api/logout') {
      const sessionId = getSession(req);
      if (sessionId) {
        sessions.delete(sessionId);
      }
      res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
      return sendJson(res, 200, { ok: true });
    }

    if (!getSession(req)) {
      return sendJson(res, 401, { error: 'unauthorized' });
    }

    if (method === 'GET' && pathname === '/api/bootstrap') {
      syncWebOwnerContact(store, config.web.contactId, logger);
      return sendJson(res, 200, { state: buildWebState(store, config) });
    }

    if (method === 'POST' && pathname === '/api/chat') {
      const body = await readJsonBody(req);
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      if (!text) {
        return sendJson(res, 400, { error: 'empty-message' });
      }

      syncWebOwnerContact(store, config.web.contactId, logger);
      const beforeCount = store.getMessageCount(config.web.contactId);
      const result = await queue.enqueue(config.web.contactId, async () => conversation.handleIncomingMessage({
        contactId: config.web.contactId,
        contactName: 'Web Owner',
        text,
        isSelf: false,
        isRoom: false,
      }));

      if (result.kind === 'ignore') {
        return sendJson(res, 400, { error: result.reason, state: buildWebState(store, config) });
      }

      const state = buildWebState(store, config);
      const persisted = state.messageCount > beforeCount
        && state.messages.at(-1)?.role === 'assistant'
        && state.messages.at(-1)?.content === result.text;

      return sendJson(res, 200, {
        persisted,
        reply: result.text,
        state,
      });
    }

    sendJson(res, 404, { error: 'not-found' });
  }

  const stop = async (signal: string) => {
    logger.info('stopping web server', { signal });
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    store.close();
    process.exit(0);
  };

  process.once('SIGINT', () => void stop('SIGINT'));
  process.once('SIGTERM', () => void stop('SIGTERM'));

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.web.port, config.web.host, () => resolve());
  });

  const urls = listAccessUrls(config.web.host, config.web.port);
  logger.info('web server started', { urls });
  console.log(`Web UI: ${urls.join(' | ')}`);

  function getSession(req: IncomingMessage): string | null {
    const cookieHeader = req.headers.cookie;
    const sessionId = parseCookies(cookieHeader)[SESSION_COOKIE];
    if (!sessionId) {
      return null;
    }

    const session = sessions.get(sessionId);
    if (!session) {
      return null;
    }
    if (session.expiresAt < Date.now()) {
      sessions.delete(sessionId);
      return null;
    }

    session.expiresAt = Date.now() + SESSION_TTL_MS;
    return sessionId;
  }
}

function toWebMessage(message: StoredMessage): WebMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
    model: message.model,
  };
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) {
    return {};
  }

  return header
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((accumulator, pair) => {
      const index = pair.indexOf('=');
      if (index === -1) {
        return accumulator;
      }
      const key = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      accumulator[key] = decodeURIComponent(value);
      return accumulator;
    }, {});
}

function buildSessionCookie(sessionId: string, ttlMs: number): string {
  const maxAge = Math.floor(ttlMs / 1000);
  return `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

function safeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    chunks.push(buffer);
    const total = chunks.reduce((sum, item) => sum + item.length, 0);
    if (total > 64 * 1024) {
      throw new Error('request body too large');
    }
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  return JSON.parse(raw) as Record<string, unknown>;
}

async function serveStatic(res: ServerResponse, filename: string, contentType: string): Promise<void> {
  const filePath = path.join(PUBLIC_DIR, filename);
  const content = await readFile(filePath);
  res.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Type': contentType,
  });
  res.end(content);
}

function sendJson(res: ServerResponse, status: number, payload: Record<string, unknown>): void {
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  });
  res.end(JSON.stringify(payload));
}

function listAccessUrls(host: string, port: number): string[] {
  if (host !== '0.0.0.0') {
    return [`http://${host}:${port}`];
  }

  const addresses = new Set<string>([`http://127.0.0.1:${port}`]);
  const interfaces = os.networkInterfaces();
  for (const items of Object.values(interfaces)) {
    for (const item of items ?? []) {
      if (item.family === 'IPv4' && !item.internal) {
        addresses.add(`http://${item.address}:${port}`);
      }
    }
  }
  return [...addresses];
}
