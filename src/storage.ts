import fs from 'node:fs';
import path from 'node:path';
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

  addMessage(contactId: string, role: 'user' | 'assistant', content: string, model: string | null = null): number {
    const encrypted = encryptText(content, this.encryptionKey);
    this.run(
      `INSERT INTO messages(contact_id, role, model, ciphertext, iv, auth_tag, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [contactId, role, model, encrypted.ciphertext, encrypted.iv, encrypted.authTag, new Date().toISOString()],
    );
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
    this.run(
      `INSERT INTO memory_summaries(contact_id, summary_ciphertext, iv, auth_tag, source_message_until_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [contactId, encrypted.ciphertext, encrypted.iv, encrypted.authTag, sourceMessageUntilId, new Date().toISOString()],
    );
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
