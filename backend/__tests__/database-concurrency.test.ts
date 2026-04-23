import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import {
  initDatabase,
  saveMessage,
  getMessage,
  updateMessageStatus,
  savePendingReply,
  getPendingReplies,
} from '../src/db/database.js';
import type { WebhookMessagePayload, AnalysisResult, WebhookReplyPayload } from '../../../shared/types.js';

describe('database concurrency', () => {
  let db: Database.Database;
  let tmpDir: string;

  const msg = (id: string): WebhookMessagePayload => ({
    message_id: id,
    thread_id: `thread_${id}`,
    sender: { name: 'Jane', title: 'Recruiter', company: 'Corp' },
    content: 'Exciting opportunity',
    timestamp: new Date().toISOString(),
  });

  const analysis: AnalysisResult = {
    is_match: true,
    confidence: 0.9,
    reasons: ['match'],
    suggested_reply_type: 'lets_talk',
  };

  const reply = (messageId: string): WebhookReplyPayload => ({
    message_id: messageId,
    thread_id: `thread_${messageId}`,
    user_choice: 'lets_talk',
    drafted_reply: 'Sounds great!',
  });

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'db-concurrency-'));
    db = initDatabase(join(tmpDir, 'test.db'));
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('never delivers the same reply twice across rapid sequential calls', () => {
    for (let i = 0; i < 10; i++) {
      saveMessage(db, msg(`msg_seq_${i}`), analysis);
      savePendingReply(db, reply(`msg_seq_${i}`));
    }

    const results: WebhookReplyPayload[][] = [];
    for (let i = 0; i < 5; i++) {
      results.push(getPendingReplies(db));
    }

    expect(results[0]).toHaveLength(10);
    for (const r of results.slice(1)) {
      expect(r).toHaveLength(0);
    }
  });

  it('exclusive transaction guarantees no reply appears in more than one response', () => {
    const COUNT = 20;
    for (let i = 0; i < COUNT; i++) {
      saveMessage(db, msg(`msg_exc_${i}`), analysis);
      savePendingReply(db, reply(`msg_exc_${i}`));
    }

    const seen = new Set<string>();
    let total = 0;

    for (let i = 0; i < 10; i++) {
      for (const r of getPendingReplies(db)) {
        expect(seen.has(r.message_id)).toBe(false);
        seen.add(r.message_id);
        total++;
      }
    }

    expect(total).toBe(COUNT);
  });

  it('handles high-volume sequential writes without errors', () => {
    const COUNT = 100;
    expect(() => {
      for (let i = 0; i < COUNT; i++) {
        saveMessage(db, msg(`msg_vol_${i}`), analysis);
      }
    }).not.toThrow();

    for (let i = 0; i < COUNT; i++) {
      savePendingReply(db, reply(`msg_vol_${i}`));
    }

    expect(getPendingReplies(db)).toHaveLength(COUNT);
  });

  it('INSERT OR IGNORE prevents duplicates under rapid repeated writes with the same message_id', () => {
    const MSG_ID = 'duplicate_msg';
    for (let i = 0; i < 50; i++) {
      saveMessage(db, msg(MSG_ID), { ...analysis, confidence: Math.random() });
    }

    const row = db
      .prepare('SELECT COUNT(*) as count FROM messages WHERE id = ?')
      .get(MSG_ID) as { count: number };
    expect(row.count).toBe(1);
  });

  it('getMessage returns consistent data after concurrent write attempts', () => {
    saveMessage(db, msg('msg_consistent'), { ...analysis, confidence: 0.75 });
    // All subsequent saves are ignored; the stored data must remain unchanged
    for (let i = 0; i < 20; i++) {
      saveMessage(db, msg('msg_consistent'), { ...analysis, confidence: 0.1 + i });
    }

    const stored = getMessage(db, 'msg_consistent');
    expect(stored).not.toBeNull();
    expect(stored!.confidence).toBe(0.75);
  });

  it('status updates interleaved with reply reads do not cause double-delivery', () => {
    const COUNT = 10;
    for (let i = 0; i < COUNT; i++) {
      saveMessage(db, msg(`msg_il_${i}`), analysis);
      savePendingReply(db, reply(`msg_il_${i}`));
    }

    // Interleave status updates with reads
    updateMessageStatus(db, 'msg_il_0', 'replied');
    updateMessageStatus(db, 'msg_il_1', 'replied');
    const firstRead = getPendingReplies(db);
    updateMessageStatus(db, 'msg_il_2', 'replied');
    const secondRead = getPendingReplies(db);

    // First read gets all pending replies regardless of message status
    expect(firstRead).toHaveLength(COUNT);
    // Second read gets nothing — all already delivered
    expect(secondRead).toHaveLength(0);
  });
});
