import { describe, it, expect, beforeEach } from 'vitest';
import { initDatabase, saveMessage, getMessage, updateMessageStatus } from '../src/db/database.js';
import { savePendingReply, getPendingReplies } from '../src/db/database.js';
import type { WebhookMessagePayload, AnalysisResult, WebhookReplyPayload } from '../../../shared/types.js';
import type Database from 'better-sqlite3';

describe('database integration tests (real SQLite)', () => {
  let db: Database.Database;

  const mockPayload: WebhookMessagePayload = {
    message_id: 'msg_001',
    thread_id: 'thread_001',
    sender: {
      name: 'Jane Smith',
      title: 'Senior Recruiter',
      company: 'TechCorp',
    },
    content: 'We have a Go position',
    timestamp: '2026-03-26T17:00:00Z',
  };

  const mockAnalysis: AnalysisResult = {
    is_match: true,
    confidence: 0.85,
    reasons: ['Go experience mentioned'],
    suggested_reply_type: 'lets_talk',
  };

  beforeEach(() => {
    db = initDatabase(':memory:');
  });

  describe('messages table', () => {
    it('should save and retrieve a message', () => {
      saveMessage(db, mockPayload, mockAnalysis);
      const result = getMessage(db, 'msg_001');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('msg_001');
      expect(result!.thread_id).toBe('thread_001');
      expect(result!.sender_name).toBe('Jane Smith');
      expect(result!.sender_company).toBe('TechCorp');
      expect(result!.content).toBe('We have a Go position');
      expect(result!.is_match).toBe(1);
      expect(result!.confidence).toBe(0.85);
      expect(result!.status).toBe('pending');
    });

    it('should return null for non-existent message', () => {
      expect(getMessage(db, 'non_existent')).toBeNull();
    });

    it('should ignore duplicate message_id (INSERT OR IGNORE)', () => {
      saveMessage(db, mockPayload, mockAnalysis);

      // Save again with different analysis — should be ignored
      const differentAnalysis: AnalysisResult = {
        is_match: false,
        confidence: 0.1,
        reasons: ['Not a match'],
        suggested_reply_type: 'not_interested',
      };
      saveMessage(db, mockPayload, differentAnalysis);

      const result = getMessage(db, 'msg_001');
      // Original data should be preserved
      expect(result!.confidence).toBe(0.85);
      expect(result!.is_match).toBe(1);
    });

    it('should update message status', () => {
      saveMessage(db, mockPayload, mockAnalysis);
      updateMessageStatus(db, 'msg_001', 'replied');

      const result = getMessage(db, 'msg_001');
      expect(result!.status).toBe('replied');
    });

    it('should reject invalid status values via CHECK constraint', () => {
      saveMessage(db, mockPayload, mockAnalysis);

      expect(() => {
        updateMessageStatus(db, 'msg_001', 'invalid_status');
      }).toThrow();
    });
  });

  describe('pending_replies table', () => {
    const mockReply: WebhookReplyPayload = {
      message_id: 'msg_001',
      thread_id: 'thread_001',
      user_choice: 'lets_talk',
      drafted_reply: 'Hi Jane, thanks for reaching out!',
      suggested_times: ['2026-03-30T14:00:00.000Z', '2026-03-30T18:00:00.000Z'],
    };

    it('should save and retrieve a pending reply', () => {
      savePendingReply(db, mockReply);

      const replies = getPendingReplies(db);
      expect(replies).toHaveLength(1);
      expect(replies[0].message_id).toBe('msg_001');
      expect(replies[0].thread_id).toBe('thread_001');
      expect(replies[0].user_choice).toBe('lets_talk');
      expect(replies[0].drafted_reply).toBe('Hi Jane, thanks for reaching out!');
      expect(replies[0].suggested_times).toEqual(['2026-03-30T14:00:00.000Z', '2026-03-30T18:00:00.000Z']);
    });

    it('should mark replies as delivered after retrieval', () => {
      savePendingReply(db, mockReply);

      const first = getPendingReplies(db);
      expect(first).toHaveLength(1);

      const second = getPendingReplies(db);
      expect(second).toHaveLength(0);
    });

    it('should handle replies without suggested_times', () => {
      const replyNoTimes: WebhookReplyPayload = {
        message_id: 'msg_002',
        thread_id: 'thread_002',
        user_choice: 'not_interested',
        drafted_reply: 'Thanks but no thanks',
      };

      savePendingReply(db, replyNoTimes);

      const replies = getPendingReplies(db);
      expect(replies).toHaveLength(1);
      expect(replies[0].suggested_times).toBeUndefined();
    });

    it('should return multiple pending replies in order', () => {
      savePendingReply(db, mockReply);
      savePendingReply(db, {
        ...mockReply,
        message_id: 'msg_002',
        thread_id: 'thread_002',
      });

      const replies = getPendingReplies(db);
      expect(replies).toHaveLength(2);
      expect(replies[0].message_id).toBe('msg_001');
      expect(replies[1].message_id).toBe('msg_002');
    });
  });
});
