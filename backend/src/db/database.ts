import Database from 'better-sqlite3';
import type { WebhookMessagePayload, WebhookReplyPayload, AnalysisResult, MessageStatus } from '../../../shared/types.js';

export interface StoredMessage {
  id: string;
  thread_id: string;
  sender_name: string;
  sender_title: string;
  sender_company: string;
  content: string;
  timestamp: string;
  is_match: number | null;
  confidence: number | null;
  suggested_reply_type: string | null;
  status: MessageStatus;
  created_at: string;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    sender_name TEXT NOT NULL,
    sender_title TEXT NOT NULL,
    sender_company TEXT NOT NULL,
    content TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    is_match INTEGER,
    confidence REAL,
    suggested_reply_type TEXT,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'not_interested', 'tell_me_more', 'lets_talk', 'replied')),
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_messages_thread_id ON messages(thread_id);
  CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status);

  CREATE TABLE IF NOT EXISTS pending_replies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    user_choice TEXT NOT NULL,
    drafted_reply TEXT NOT NULL,
    suggested_times TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    delivered INTEGER DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_pending_replies_delivered ON pending_replies(delivered);
`;

export function initDatabase(path: string = ':memory:'): Database.Database {
  const db = new Database(path);
  db.exec(SCHEMA);
  return db;
}

export function saveMessage(
  db: Database.Database,
  message: WebhookMessagePayload,
  analysis: AnalysisResult
): void {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO messages (
      id, thread_id, sender_name, sender_title, sender_company,
      content, timestamp, is_match, confidence, suggested_reply_type, status
    ) VALUES (
      @id, @thread_id, @sender_name, @sender_title, @sender_company,
      @content, @timestamp, @is_match, @confidence, @suggested_reply_type, @status
    )
  `);

  stmt.run({
    id: message.message_id,
    thread_id: message.thread_id,
    sender_name: message.sender.name,
    sender_title: message.sender.title,
    sender_company: message.sender.company,
    content: message.content,
    timestamp: message.timestamp,
    is_match: analysis.is_match ? 1 : 0,
    confidence: analysis.confidence,
    suggested_reply_type: analysis.suggested_reply_type,
    status: 'pending',
  });
}

export function getMessage(
  db: Database.Database,
  messageId: string
): StoredMessage | null {
  const stmt = db.prepare('SELECT * FROM messages WHERE id = ?');
  const row = stmt.get(messageId) as StoredMessage | undefined;
  return row ?? null;
}

export function updateMessageStatus(
  db: Database.Database,
  messageId: string,
  status: MessageStatus
): void {
  const stmt = db.prepare('UPDATE messages SET status = ? WHERE id = ?');
  stmt.run(status, messageId);
}

export function savePendingReply(
  db: Database.Database,
  reply: WebhookReplyPayload
): void {
  const stmt = db.prepare(`
    INSERT INTO pending_replies (message_id, thread_id, user_choice, drafted_reply, suggested_times)
    VALUES (@message_id, @thread_id, @user_choice, @drafted_reply, @suggested_times)
  `);

  stmt.run({
    message_id: reply.message_id,
    thread_id: reply.thread_id,
    user_choice: reply.user_choice,
    drafted_reply: reply.drafted_reply,
    suggested_times: reply.suggested_times ? JSON.stringify(reply.suggested_times) : null,
  });
}

export function getPendingReplies(
  db: Database.Database
): WebhookReplyPayload[] {
  const select = db.prepare('SELECT * FROM pending_replies WHERE delivered = 0 ORDER BY id');
  const update = db.prepare('UPDATE pending_replies SET delivered = 1 WHERE delivered = 0');

  const transaction = db.transaction(() => {
    const rows = select.all() as Array<{
      message_id: string;
      thread_id: string;
      user_choice: 'not_interested' | 'tell_me_more' | 'lets_talk';
      drafted_reply: string;
      suggested_times: string | null;
    }>;
    update.run();
    return rows;
  });

  const rows = transaction.exclusive();

  return rows.map(row => ({
    message_id: row.message_id,
    thread_id: row.thread_id,
    user_choice: row.user_choice,
    drafted_reply: row.drafted_reply,
    suggested_times: row.suggested_times ? JSON.parse(row.suggested_times) : undefined,
  }));
}
