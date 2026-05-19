import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import initSqlJs from 'sql.js';
import { decryptText, deriveAesKey, encryptText } from './crypto.js';
import type { ModelMode, StoredMessage } from './types.js';

type SqlParams = Array<string | number | null>;

interface MessageRow {
  id: number;
  contact_id: string;
  role: 'user' | 'assistant';
  model: string | null;
  ciphertext: string;
  iv: string;
  auth_tag: string;
  created_at: string;
}

interface SummaryRow {
  id: number;
  contact_id: string;
  summary_ciphertext: string;
  iv: string;
  auth_tag: string;
  source_message_until_id: number;
  created_at: string;
}

interface ConversationRow {
  id: string;
  base_contact_id: string;
  storage_contact_id: string;
  created_at: string;
  updated_at: string;
}

export interface StoredConversation {
  id: string;
  baseContactId: string;
  storageContactId: string;
  createdAt: string;
  updatedAt: string;
}

export class MemoryStore {
  private constructor(
    private readonly db: any,
    private readonly dbPath: string,
    private readonly encryptionKey: Buffer,
  ) {}

  static async open(dbPath: string, encryptionSecret: string): Promise<MemoryStore> {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const SQL = await initSqlJs({
      locateFile: (file: string) => path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', file),
    });
    const db = fs.existsSync(dbPath)
      ? new SQL.Database(fs.readFileSync(dbPath))
      : new SQL.Database();
    const store = new MemoryStore(db, dbPath, deriveAesKey(encryptionSecret));
    store.migrate();
    store.save();
    return store;
  }

  close(): void {
    this.save();
    this.db.close();
  }

  private migrate(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        contact_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        model TEXT,
        ciphertext TEXT NOT NULL,
        iv TEXT NOT NULL,
        auth_tag TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_messages_contact_id_id
        ON messages(contact_id, id);

      CREATE TABLE IF NOT EXISTS memory_summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        contact_id TEXT NOT NULL,
        summary_ciphertext TEXT NOT NULL,
        iv TEXT NOT NULL,
        auth_tag TEXT NOT NULL,
        source_message_until_id INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_memory_summaries_contact_id_id
        ON memory_summaries(contact_id, id);

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        base_contact_id TEXT NOT NULL,
        storage_contact_id TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_conversations_base_contact_updated_at
        ON conversations(base_contact_id, updated_at DESC, created_at DESC);
    `);
  }

  private save(): void {
    const data = this.db.export();
    fs.writeFileSync(this.dbPath, Buffer.from(data));
  }

  private run(sql: string, params: SqlParams = []): void {
    this.db.run(sql, params);
    this.save();
  }

  private all<T extends object>(sql: string, params: SqlParams = []): T[] {
    const statement = this.db.prepare(sql);
    try {
      statement.bind(params);
      const rows: T[] = [];
      while (statement.step()) {
        rows.push(statement.getAsObject() as T);
      }
      return rows;
    } finally {
      statement.free();
    }
  }

  private get<T extends object>(sql: string, params: SqlParams = []): T | null {
    return this.all<T>(sql, params)[0] ?? null;
  }

  getSetting(key: string): string | null {
    const row = this.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
    return row?.value ?? null;
  }

  setSetting(key: string, value: string): void {
    this.run(
      `INSERT INTO settings(key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [key, value, new Date().toISOString()],
    );
  }

  deleteSetting(key: string): void {
    this.run('DELETE FROM settings WHERE key = ?', [key]);
  }

  getOwnerId(): string | null {
    return this.getSetting('owner_contact_id');
  }

  setOwnerId(contactId: string): void {
    this.setSetting('owner_contact_id', contactId);
  }

  getModelMode(defaultMode: ModelMode): ModelMode {
    const mode = this.getSetting('model_mode');
    if (mode === 'fast' || mode === 'pro' || mode === 'auto') {
      return mode;
    }
    this.setModelMode(defaultMode);
    return defaultMode;
  }

  setModelMode(mode: ModelMode): void {
    this.setSetting('model_mode', mode);
  }

  getCurrentWebConversationId(baseContactId: string): string | null {
    return this.getSetting(`web_current_conversation:${baseContactId}`);
  }

  setCurrentWebConversationId(baseContactId: string, conversationId: string): void {
    this.setSetting(`web_current_conversation:${baseContactId}`, conversationId);
  }

  ensureDefaultConversation(baseContactId: string): StoredConversation {
    return this.ensureConversation(baseContactId, 'default', baseContactId);
  }

  createConversation(baseContactId: string): StoredConversation {
    this.ensureDefaultConversation(baseContactId);
    const id = `c_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
    const storageContactId = `${baseContactId}::${id}`;
    const now = new Date().toISOString();
    this.run(
      `INSERT INTO conversations(id, base_contact_id, storage_contact_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [id, baseContactId, storageContactId, now, now],
    );
    return {
      id,
      baseContactId,
      storageContactId,
      createdAt: now,
      updatedAt: now,
    };
  }

  listConversations(baseContactId: string): StoredConversation[] {
    this.ensureDefaultConversation(baseContactId);
    const rows = this.all<ConversationRow>(
      `SELECT id, base_contact_id, storage_contact_id, created_at, updated_at
       FROM conversations
       WHERE base_contact_id = ?
       ORDER BY updated_at DESC, created_at DESC`,
      [baseContactId],
    );
    return rows.map((row) => this.toConversation(row));
  }

  getConversation(baseContactId: string, conversationId: string): StoredConversation | null {
    if (conversationId === 'default') {
      return this.ensureDefaultConversation(baseContactId);
    }

    const row = this.get<ConversationRow>(
      `SELECT id, base_contact_id, storage_contact_id, created_at, updated_at
       FROM conversations
       WHERE base_contact_id = ? AND id = ?`,
      [baseContactId, conversationId],
    );
    return row ? this.toConversation(row) : null;
  }

  deleteConversation(baseContactId: string, conversationId: string): boolean {
    const conversation = this.getConversation(baseContactId, conversationId);
    if (!conversation) {
      return false;
    }

    this.run('DELETE FROM messages WHERE contact_id = ?', [conversation.storageContactId]);
    this.run('DELETE FROM memory_summaries WHERE contact_id = ?', [conversation.storageContactId]);
    this.run('DELETE FROM conversations WHERE base_contact_id = ? AND id = ?', [baseContactId, conversation.id]);

    if (this.getCurrentWebConversationId(baseContactId) === conversation.id) {
      this.deleteSetting(`web_current_conversation:${baseContactId}`);
    }
    if (this.getOwnerId() === conversation.storageContactId) {
      this.deleteSetting('owner_contact_id');
    }

    return true;
  }

  addMessage(contactId: string, role: 'user' | 'assistant', content: string, model: string | null = null): number {
    const encrypted = encryptText(content, this.encryptionKey);
    const createdAt = new Date().toISOString();
    this.run(
      `INSERT INTO messages(contact_id, role, model, ciphertext, iv, auth_tag, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [contactId, role, model, encrypted.ciphertext, encrypted.iv, encrypted.authTag, createdAt],
    );
    this.touchConversationByStorageContactId(contactId, createdAt);
    const row = this.get<{ id: number }>('SELECT last_insert_rowid() AS id');
    return Number(row?.id ?? 0);
  }

  getRecentMessages(contactId: string, limit: number): StoredMessage[] {
    const rows = this.all<MessageRow>(
      `SELECT id, contact_id, role, model, ciphertext, iv, auth_tag, created_at
       FROM messages
       WHERE contact_id = ?
       ORDER BY id DESC
       LIMIT ?`,
      [contactId, limit],
    );
    return rows.reverse().map((row) => this.decryptMessageRow(row));
  }

  getMessagesAfter(contactId: string, afterId: number, limit: number): StoredMessage[] {
    const rows = this.all<MessageRow>(
      `SELECT id, contact_id, role, model, ciphertext, iv, auth_tag, created_at
       FROM messages
       WHERE contact_id = ? AND id > ?
       ORDER BY id ASC
       LIMIT ?`,
      [contactId, afterId, limit],
    );
    return rows.map((row) => this.decryptMessageRow(row));
  }

  getAllMessages(contactId: string, limit: number): StoredMessage[] {
    const rows = this.all<MessageRow>(
      `SELECT id, contact_id, role, model, ciphertext, iv, auth_tag, created_at
       FROM messages
       WHERE contact_id = ?
       ORDER BY id DESC
       LIMIT ?`,
      [contactId, limit],
    );
    return rows.reverse().map((row) => this.decryptMessageRow(row));
  }

  getMessageCount(contactId: string): number {
    const row = this.get<{ count: number }>('SELECT COUNT(*) AS count FROM messages WHERE contact_id = ?', [contactId]);
    return Number(row?.count ?? 0);
  }

  getMaxMessageId(contactId: string): number {
    const row = this.get<{ max_id: number | null }>('SELECT MAX(id) AS max_id FROM messages WHERE contact_id = ?', [contactId]);
    return Number(row?.max_id ?? 0);
  }

  addSummary(contactId: string, summary: string, sourceMessageUntilId: number): void {
    const encrypted = encryptText(summary, this.encryptionKey);
    const createdAt = new Date().toISOString();
    this.run(
      `INSERT INTO memory_summaries(contact_id, summary_ciphertext, iv, auth_tag, source_message_until_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [contactId, encrypted.ciphertext, encrypted.iv, encrypted.authTag, sourceMessageUntilId, createdAt],
    );
    this.touchConversationByStorageContactId(contactId, createdAt);
  }

  getLatestSummary(contactId: string): { text: string; sourceMessageUntilId: number } | null {
    const row = this.get<SummaryRow>(
      `SELECT id, contact_id, summary_ciphertext, iv, auth_tag, source_message_until_id, created_at
       FROM memory_summaries
       WHERE contact_id = ?
       ORDER BY id DESC
       LIMIT 1`,
      [contactId],
    );
    if (!row) return null;
    return {
      text: decryptText({
        ciphertext: row.summary_ciphertext,
        iv: row.iv,
        authTag: row.auth_tag,
      }, this.encryptionKey),
      sourceMessageUntilId: Number(row.source_message_until_id),
    };
  }

  clearSummaries(contactId: string): void {
    this.run('DELETE FROM memory_summaries WHERE contact_id = ?', [contactId]);
  }

  getSummaryCount(contactId: string): number {
    const row = this.get<{ count: number }>('SELECT COUNT(*) AS count FROM memory_summaries WHERE contact_id = ?', [contactId]);
    return Number(row?.count ?? 0);
  }

  private ensureConversation(baseContactId: string, conversationId: string, storageContactId: string): StoredConversation {
    const existing = this.get<ConversationRow>(
      `SELECT id, base_contact_id, storage_contact_id, created_at, updated_at
       FROM conversations
       WHERE base_contact_id = ? AND id = ?`,
      [baseContactId, conversationId],
    );
    if (existing) {
      return this.toConversation(existing);
    }

    const seed = this.getConversationSeedTimestamps(storageContactId);
    const createdAt = seed?.createdAt ?? new Date().toISOString();
    const updatedAt = seed?.updatedAt ?? createdAt;
    this.run(
      `INSERT INTO conversations(id, base_contact_id, storage_contact_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [conversationId, baseContactId, storageContactId, createdAt, updatedAt],
    );
    return {
      id: conversationId,
      baseContactId,
      storageContactId,
      createdAt,
      updatedAt,
    };
  }

  private getConversationSeedTimestamps(storageContactId: string): { createdAt: string; updatedAt: string } | null {
    const messageTimes = this.get<{ min_created_at: string | null; max_created_at: string | null }>(
      `SELECT MIN(created_at) AS min_created_at, MAX(created_at) AS max_created_at
       FROM messages
       WHERE contact_id = ?`,
      [storageContactId],
    );
    const summaryTimes = this.get<{ max_created_at: string | null }>(
      `SELECT MAX(created_at) AS max_created_at
       FROM memory_summaries
       WHERE contact_id = ?`,
      [storageContactId],
    );

    const createdAt = messageTimes?.min_created_at ?? summaryTimes?.max_created_at ?? null;
    const updatedCandidates = [messageTimes?.max_created_at, summaryTimes?.max_created_at].filter(Boolean) as string[];
    const updatedAt = updatedCandidates.sort().at(-1) ?? createdAt;

    if (!createdAt || !updatedAt) {
      return null;
    }

    return { createdAt, updatedAt };
  }

  private touchConversationByStorageContactId(storageContactId: string, updatedAt: string): void {
    const existing = this.get<{ updated_at: string }>(
      'SELECT updated_at FROM conversations WHERE storage_contact_id = ?',
      [storageContactId],
    );
    if (!existing) {
      return;
    }

    const nextUpdatedAt = existing.updated_at > updatedAt ? existing.updated_at : updatedAt;
    this.run(
      'UPDATE conversations SET updated_at = ? WHERE storage_contact_id = ?',
      [nextUpdatedAt, storageContactId],
    );
  }

  private toConversation(row: ConversationRow): StoredConversation {
    return {
      id: row.id,
      baseContactId: row.base_contact_id,
      storageContactId: row.storage_contact_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private decryptMessageRow(row: MessageRow): StoredMessage {
    return {
      id: Number(row.id),
      contactId: row.contact_id,
      role: row.role,
      content: decryptText({
        ciphertext: row.ciphertext,
        iv: row.iv,
        authTag: row.auth_tag,
      }, this.encryptionKey),
      model: row.model,
      createdAt: row.created_at,
    };
  }
}
