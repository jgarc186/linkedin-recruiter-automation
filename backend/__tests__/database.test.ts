import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initDatabase, saveMessage, getMessage, updateMessageStatus } from '../src/db/database.js';
import type { WebhookMessagePayload, AnalysisResult } from '../../../shared/types.js';

// Mock better-sqlite3
vi.mock('better-sqlite3', () => {
  const mockPrepare = vi.fn();
  const mockRun = vi.fn();
  const mockGet = vi.fn();
  const mockAll = vi.fn();
  const mockClose = vi.fn();
  const mockExec = vi.fn();

  return {
    default: vi.fn().mockImplementation(() => ({
      prepare: mockPrepare.mockReturnValue({
        run: mockRun,
        get: mockGet,
        all: mockAll,
      }),
      exec: mockExec,
      close: mockClose,
    })),
  };
});

describe('database.ts', () => {
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
    vi.clearAllMocks();
  });

  describe('initDatabase', () => {
    it('should create database with schema', () => {
      const db = initDatabase(':memory:');
      expect(db).toBeDefined();
      expect(db.exec).toHaveBeenCalled();
    });

    it('should accept custom path', () => {
      const db = initDatabase('/custom/path.db');
      expect(db).toBeDefined();
    });
  });

  describe('saveMessage', () => {
    it('should save message data', () => {
      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          run: vi.fn(),
        }),
      } as any;

      saveMessage(mockDb, mockPayload, mockAnalysis);

      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT OR IGNORE'));
    });
  });

  describe('getMessage', () => {
    it('should return message data', () => {
      const mockRow = {
        id: 'msg_001',
        thread_id: 'thread_001',
        sender_name: 'Jane Smith',
        is_match: 1,
      };

      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          get: vi.fn().mockReturnValue(mockRow),
        }),
      } as any;

      const result = getMessage(mockDb, 'msg_001');

      expect(result).toEqual(mockRow);
    });

    it('should return null for non-existent message', () => {
      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          get: vi.fn().mockReturnValue(undefined),
        }),
      } as any;

      const result = getMessage(mockDb, 'non_existent');

      expect(result).toBeNull();
    });
  });

  describe('updateMessageStatus', () => {
    it('should update message status', () => {
      const mockRun = vi.fn();
      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          run: mockRun,
        }),
      } as any;

      updateMessageStatus(mockDb, 'msg_001', 'approved');

      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('UPDATE messages'));
      expect(mockRun).toHaveBeenCalledWith('approved', 'msg_001');
    });
  });
});
