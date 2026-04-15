import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { webhookRoutes } from '../src/routes/webhook.js';

// Mock config
vi.mock('../src/config.js', () => ({
  config: {
    port: 8000,
    host: '127.0.0.1',
    telegramBotToken: 'test-token',
    telegramUserId: '123456789',
    apiKey: 'test-api-key',
    telegramWebhookSecret: 'test-webhook-secret',
    extensionId: 'test-extension-id',
    databasePath: ':memory:',
    googleClientId: 'test-client-id',
    googleClientSecret: 'test-client-secret',
    googleRefreshToken: 'test-refresh-token',
  },
  validateConfig: vi.fn(),
}));

// Mock TelegramBot
vi.mock('node-telegram-bot-api', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
      answerCallbackQuery: vi.fn().mockResolvedValue(true),
      editMessageText: vi.fn().mockResolvedValue({ message_id: 1 }),
    })),
  };
});

// Mock telegram service to control behavior
vi.mock('../src/services/telegram.js', () => ({
  sendApprovalRequest: vi.fn().mockResolvedValue(undefined),
  handleCallbackQuery: vi.fn().mockResolvedValue({
    message_id: 'msg_123',
    action: 'lets_talk',
  }),
}));

// Mock calendar service
vi.mock('../src/services/calendar.js', () => ({
  generateTimeSlots: vi.fn().mockReturnValue([
    '2026-03-30T14:00:00.000Z',
    '2026-03-30T18:00:00.000Z',
    '2026-03-30T20:00:00.000Z',
  ]),
  scheduleMeeting: vi.fn().mockResolvedValue({
    id: 'event_123',
    summary: 'Interview with Recruiter from Company',
    start: { dateTime: '2026-03-30T14:00:00.000Z', timeZone: 'America/New_York' },
    end: { dateTime: '2026-03-30T15:00:00.000Z', timeZone: 'America/New_York' },
  }),
}));

// Mock database
vi.mock('../src/db/database.js', () => ({
  initDatabase: vi.fn().mockReturnValue({
    prepare: vi.fn().mockReturnValue({ run: vi.fn(), get: vi.fn() }),
    exec: vi.fn(),
  }),
  saveMessage: vi.fn(),
  getMessage: vi.fn().mockReturnValue(null),
  updateMessageStatus: vi.fn(),
  savePendingReply: vi.fn(),
  getPendingReplies: vi.fn().mockReturnValue([]),
}));

import { sendApprovalRequest, handleCallbackQuery } from '../src/services/telegram.js';
import { generateTimeSlots, scheduleMeeting } from '../src/services/calendar.js';
import { getMessage, getPendingReplies } from '../src/db/database.js';

describe('webhook routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    await app.register(webhookRoutes);
  });

  afterEach(async () => {
    await app.close();
  });

  describe('API key validation hook', () => {
    it('should skip auth for /health', async () => {
      app.get('/health', async () => ({ status: 'ok' }));
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });
      expect(response.statusCode).toBe(200);
    });

    it('should skip API key auth for /webhook/telegram/callback', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/webhook/telegram/callback',
        payload: {
          callback_query: {
            id: 'cb_123',
            data: '{"message_id":"msg_123","action":"lets_talk"}',
            message: { chat: { id: 123 }, message_id: 999 },
          },
        },
        headers: { 'X-Telegram-Bot-Api-Secret-Token': 'test-webhook-secret' },
      });
      expect(response.statusCode).toBe(200);
    });

    it('should reject telegram callback without secret token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/webhook/telegram/callback',
        payload: {
          callback_query: {
            id: 'cb_123',
            data: '{"message_id":"msg_123","action":"lets_talk"}',
            message: { chat: { id: 123 }, message_id: 999 },
          },
        },
      });
      expect(response.statusCode).toBe(401);
    });

    it('should reject telegram callback with wrong secret token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/webhook/telegram/callback',
        payload: {
          callback_query: {
            id: 'cb_123',
            data: '{"message_id":"msg_123","action":"lets_talk"}',
            message: { chat: { id: 123 }, message_id: 999 },
          },
        },
        headers: { 'X-Telegram-Bot-Api-Secret-Token': 'wrong-secret' },
      });
      expect(response.statusCode).toBe(401);
    });

    it('should reject requests with wrong API key', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/webhook/message',
        payload: { message_id: 'msg_123', thread_id: 'thread_456', sender: { name: 'Test', title: 'Test', company: 'Test' } },
        headers: { 'X-API-Key': 'wrong-key' },
      });
      expect(response.statusCode).toBe(401);
    });

    it('should reject requests with no API key', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/webhook/message',
        payload: { message_id: 'msg_123', thread_id: 'thread_456', sender: { name: 'Test', title: 'Test', company: 'Test' } },
      });
      expect(response.statusCode).toBe(401);
    });
  });

  describe('POST /webhook/message', () => {
    const validMessage = {
      message_id: 'msg_123',
      thread_id: 'thread_456',
      sender: {
        name: 'Jane Smith',
        title: 'Senior Technical Recruiter',
        company: 'TechCorp',
      },
      content: 'I have an opportunity for you',
      timestamp: '2026-03-26T17:00:00Z',
    };

    it('should accept valid webhook payload', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/webhook/message',
        payload: validMessage,
        headers: { 'X-API-Key': 'test-api-key' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expect(body.message_id).toBe('msg_123');
      expect(body.status).toBe('approval_requested');
    });

    it('should reject missing required fields - no sender', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/webhook/message',
        payload: { message_id: 'msg_123', thread_id: 'thread_456' },
        headers: { 'X-API-Key': 'test-api-key' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('should reject missing required fields - no thread_id', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/webhook/message',
        payload: { message_id: 'msg_123' },
        headers: { 'X-API-Key': 'test-api-key' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('should reject missing required fields - no message_id', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/webhook/message',
        payload: {},
        headers: { 'X-API-Key': 'test-api-key' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('should reject when sender is not an object', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/webhook/message',
        payload: { message_id: 'msg_123', thread_id: 'thread_456', sender: 'not-an-object', content: 'test', timestamp: '2026-01-01' },
        headers: { 'X-API-Key': 'test-api-key' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('should reject when sender.name is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/webhook/message',
        payload: { message_id: 'msg_123', thread_id: 'thread_456', sender: { title: 'B', company: 'C' }, content: 'test', timestamp: '2026-01-01' },
        headers: { 'X-API-Key': 'test-api-key' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('should return 500 when sendApprovalRequest throws', async () => {
      vi.mocked(sendApprovalRequest).mockRejectedValueOnce(new Error('Telegram API error'));

      const response = await app.inject({
        method: 'POST',
        url: '/webhook/message',
        payload: validMessage,
        headers: { 'X-API-Key': 'test-api-key' },
      });

      expect(response.statusCode).toBe(500);
      expect(JSON.parse(response.payload)).toEqual({ error: 'Internal server error' });
    });
  });

  describe('POST /webhook/reply', () => {
    const validReply = {
      message_id: 'msg_123',
      thread_id: 'thread_456',
      user_choice: 'lets_talk',
      drafted_reply: 'Hi, I would love to chat!',
    };

    it('should accept valid reply payload', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/webhook/reply',
        payload: validReply,
        headers: { 'X-API-Key': 'test-api-key' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expect(body.message_id).toBe('msg_123');
      expect(body.status).toBe('reply_delivered');
    });

    it('should reject missing message_id', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/webhook/reply',
        payload: { drafted_reply: 'Hello' },
        headers: { 'X-API-Key': 'test-api-key' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject missing drafted_reply', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/webhook/reply',
        payload: { message_id: 'msg_123' },
        headers: { 'X-API-Key': 'test-api-key' },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('POST /webhook/telegram/callback', () => {
    it('should handle valid callback query', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/webhook/telegram/callback',
        payload: {
          callback_query: {
            id: 'cb_123',
            data: '{"message_id":"msg_123","action":"lets_talk"}',
            message: { chat: { id: 123 }, message_id: 999 },
          },
        },
        headers: { 'X-Telegram-Bot-Api-Secret-Token': 'test-webhook-secret' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expect(body.message_id).toBe('msg_123');
      expect(body.user_choice).toBe('lets_talk');
    });

    it('should include thread_id in response', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/webhook/telegram/callback',
        payload: {
          callback_query: {
            id: 'cb_123',
            data: '{"message_id":"msg_123","action":"lets_talk"}',
            message: { chat: { id: 123 }, message_id: 999 },
          },
        },
        headers: { 'X-Telegram-Bot-Api-Secret-Token': 'test-webhook-secret' },
      });

      const body = JSON.parse(response.payload);
      expect(body.thread_id).toBeDefined();
    });

    it('should reject missing callback_query', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/webhook/telegram/callback',
        payload: {},
        headers: { 'X-Telegram-Bot-Api-Secret-Token': 'test-webhook-secret' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 500 when handleCallbackQuery throws', async () => {
      vi.mocked(handleCallbackQuery).mockRejectedValueOnce(new Error('Invalid data'));

      const response = await app.inject({
        method: 'POST',
        url: '/webhook/telegram/callback',
        payload: {
          callback_query: {
            id: 'cb_123',
            data: 'bad data',
          },
        },
        headers: { 'X-Telegram-Bot-Api-Secret-Token': 'test-webhook-secret' },
      });

      expect(response.statusCode).toBe(500);
      expect(JSON.parse(response.payload)).toEqual({ error: 'Internal server error' });
    });

    it('should generate time slots and schedule meeting for lets_talk action', async () => {
      vi.mocked(handleCallbackQuery).mockResolvedValueOnce({
        message_id: 'msg_456',
        action: 'lets_talk',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/webhook/telegram/callback',
        payload: {
          callback_query: {
            id: 'cb_456',
            data: '{"message_id":"msg_456","action":"lets_talk"}',
            message: { chat: { id: 123, first_name: 'Jane' }, message_id: 999 },
          },
        },
        headers: { 'X-Telegram-Bot-Api-Secret-Token': 'test-webhook-secret' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.suggested_times).toBeDefined();
      expect(body.suggested_times).toHaveLength(3);
      expect(vi.mocked(generateTimeSlots)).toHaveBeenCalled();
      expect(vi.mocked(scheduleMeeting)).toHaveBeenCalled();
    });

    it('should not generate time slots for non-lets_talk actions', async () => {
      vi.mocked(handleCallbackQuery).mockResolvedValueOnce({
        message_id: 'msg_789',
        action: 'not_interested',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/webhook/telegram/callback',
        payload: {
          callback_query: {
            id: 'cb_789',
            data: '{"message_id":"msg_789","action":"not_interested"}',
            message: { chat: { id: 123 }, message_id: 999 },
          },
        },
        headers: { 'X-Telegram-Bot-Api-Secret-Token': 'test-webhook-secret' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.suggested_times).toBeUndefined();
      expect(vi.mocked(generateTimeSlots)).not.toHaveBeenCalled();
      expect(vi.mocked(scheduleMeeting)).not.toHaveBeenCalled();
    });

    it('should still succeed if calendar scheduling fails', async () => {
      vi.mocked(handleCallbackQuery).mockResolvedValueOnce({
        message_id: 'msg_fail',
        action: 'lets_talk',
      });
      vi.mocked(scheduleMeeting).mockRejectedValueOnce(new Error('Calendar API error'));

      const response = await app.inject({
        method: 'POST',
        url: '/webhook/telegram/callback',
        payload: {
          callback_query: {
            id: 'cb_fail',
            data: '{"message_id":"msg_fail","action":"lets_talk"}',
            message: { chat: { id: 123 }, message_id: 999 },
          },
        },
        headers: { 'X-Telegram-Bot-Api-Secret-Token': 'test-webhook-secret' },
      });

      // Should still succeed - calendar failure is non-fatal
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expect(body.suggested_times).toBeDefined();
    });

    it('should include drafted_reply in response for lets_talk', async () => {
      vi.mocked(handleCallbackQuery).mockResolvedValueOnce({
        message_id: 'msg_draft',
        action: 'lets_talk',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/webhook/telegram/callback',
        payload: {
          callback_query: {
            id: 'cb_draft',
            data: '{"message_id":"msg_draft","action":"lets_talk"}',
            message: { chat: { id: 123, first_name: 'Recruiter' }, message_id: 999 },
          },
        },
        headers: { 'X-Telegram-Bot-Api-Secret-Token': 'test-webhook-secret' },
      });

      const body = JSON.parse(response.payload);
      expect(body.drafted_reply).toBeDefined();
      expect(typeof body.drafted_reply).toBe('string');
      expect(body.drafted_reply.length).toBeGreaterThan(0);
    });

    it('should use stored message data from database when available', async () => {
      vi.mocked(getMessage).mockReturnValueOnce({
        id: 'msg_stored',
        thread_id: 'thread_stored',
        sender_name: 'Real Recruiter',
        sender_title: 'Director of Engineering',
        sender_company: 'RealCorp',
        content: 'Real message content',
        timestamp: '2026-03-26T17:00:00Z',
        is_match: 1,
        confidence: 0.9,
        suggested_reply_type: 'lets_talk',
        status: 'pending',
        created_at: '2026-03-26T17:00:00Z',
      });

      vi.mocked(handleCallbackQuery).mockResolvedValueOnce({
        message_id: 'msg_stored',
        action: 'lets_talk',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/webhook/telegram/callback',
        payload: {
          callback_query: {
            id: 'cb_stored',
            data: '{"message_id":"msg_stored","action":"lets_talk"}',
            message: { chat: { id: 123 }, message_id: 999 },
          },
        },
        headers: { 'X-Telegram-Bot-Api-Secret-Token': 'test-webhook-secret' },
      });

      const body = JSON.parse(response.payload);
      expect(body.thread_id).toBe('thread_stored');
      expect(body.drafted_reply).toContain('RealCorp');
    });
  });

  describe('payload content validation', () => {
    const baseMessage = {
      message_id: 'msg_123',
      thread_id: 'thread_456',
      sender: { name: 'Jane Smith', title: 'Senior Technical Recruiter', company: 'TechCorp' },
      content: 'I have an opportunity for you',
      timestamp: '2026-03-26T17:00:00Z',
    };

    const baseReply = {
      message_id: 'msg_123',
      drafted_reply: 'Hi, I would love to chat!',
    };

    it('should reject content exceeding 10,000 chars', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/webhook/message',
        payload: { ...baseMessage, content: 'x'.repeat(10001) },
        headers: { 'X-API-Key': 'test-api-key' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('should reject sender.name exceeding 100 chars', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/webhook/message',
        payload: { ...baseMessage, sender: { ...baseMessage.sender, name: 'a'.repeat(101) } },
        headers: { 'X-API-Key': 'test-api-key' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('should reject message_id exceeding 128 chars', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/webhook/message',
        payload: { ...baseMessage, message_id: 'x'.repeat(129) },
        headers: { 'X-API-Key': 'test-api-key' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('should reject drafted_reply exceeding 10,000 chars', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/webhook/reply',
        payload: { ...baseReply, drafted_reply: 'x'.repeat(10001) },
        headers: { 'X-API-Key': 'test-api-key' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('should reject invalid user_choice value', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/webhook/reply',
        payload: { ...baseReply, user_choice: 'invalid' },
        headers: { 'X-API-Key': 'test-api-key' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('should accept content at exactly 10,000 chars', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/webhook/message',
        payload: { ...baseMessage, content: 'x'.repeat(10000) },
        headers: { 'X-API-Key': 'test-api-key' },
      });
      expect(response.statusCode).toBe(200);
    });
  });

  describe('GET /webhook/pending-replies', () => {
    it('should return pending replies with valid API key', async () => {
      vi.mocked(getPendingReplies).mockReturnValueOnce([
        {
          message_id: 'msg_123',
          thread_id: 'thread_456',
          user_choice: 'lets_talk',
          drafted_reply: 'Thanks for reaching out!',
          suggested_times: ['2026-03-30T14:00:00.000Z'],
        },
      ]);

      const response = await app.inject({
        method: 'GET',
        url: '/webhook/pending-replies',
        headers: { 'X-API-Key': 'test-api-key' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.replies).toHaveLength(1);
      expect(body.replies[0].message_id).toBe('msg_123');
    });

    it('should return empty array when no pending replies', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/webhook/pending-replies',
        headers: { 'X-API-Key': 'test-api-key' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.replies).toEqual([]);
    });

    it('should reject requests without API key', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/webhook/pending-replies',
      });

      expect(response.statusCode).toBe(401);
    });
  });
});

describe('server.ts - createApp & start', () => {
  it('should export createApp function', async () => {
    const { createApp } = await import('../src/server.js');
    expect(typeof createApp).toBe('function');
  });

  it('should create an app with health endpoint', async () => {
    const { createApp } = await import('../src/server.js');
    const app = await createApp();
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual({ status: 'ok' });
    await app.close();
  });

  it('should export start function', async () => {
    const { start } = await import('../src/server.js');
    expect(typeof start).toBe('function');
  });

  describe('body size limit', () => {
    it('should reject bodies exceeding 64KB with 413', async () => {
      const { createApp } = await import('../src/server.js');
      const testApp = await createApp();
      const response = await testApp.inject({
        method: 'POST',
        url: '/webhook/message',
        payload: JSON.stringify({ data: 'x'.repeat(65600) }),
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
      });
      expect(response.statusCode).toBe(413);
      await testApp.close();
    });
  });

  describe('CORS', () => {
    it('should allow requests from the configured extension ID', async () => {
      const { createApp } = await import('../src/server.js');
      const app = await createApp();
      const response = await app.inject({
        method: 'GET',
        url: '/health',
        headers: { Origin: 'chrome-extension://test-extension-id' },
      });
      expect(response.headers['access-control-allow-origin']).toBe(
        'chrome-extension://test-extension-id',
      );
      await app.close();
    });

    it('should not reflect a different extension ID as an allowed origin', async () => {
      const { createApp } = await import('../src/server.js');
      const app = await createApp();
      const response = await app.inject({
        method: 'GET',
        url: '/health',
        headers: { Origin: 'chrome-extension://malicious-extension-id' },
      });
      expect(response.headers['access-control-allow-origin']).toBe(
        'chrome-extension://test-extension-id',
      );
      await app.close();
    });
  });

  describe('trustProxy / header spoofing protection (GHSA-444r-cwp2-x5xf)', () => {
    it('should not reflect X-Forwarded-Host in hostname when trustProxy is false', async () => {
      const { createApp } = await import('../src/server.js');
      const app = await createApp();
      app.get('/debug/hostname', async (request) => ({ hostname: request.hostname }));

      const response = await app.inject({
        method: 'GET',
        url: '/debug/hostname',
        headers: { 'X-Forwarded-Host': 'evil.attacker.com' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.hostname).not.toBe('evil.attacker.com');
      await app.close();
    });

    it('should ignore X-Forwarded-Proto and X-Forwarded-For when trustProxy is false', async () => {
      const { createApp } = await import('../src/server.js');
      const app = await createApp();

      const response = await app.inject({
        method: 'GET',
        url: '/health',
        headers: {
          'X-Forwarded-Proto': 'https',
          'X-Forwarded-For': '1.2.3.4, 5.6.7.8',
          'X-Forwarded-Host': 'evil.attacker.com',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.status).toBe('ok');
      await app.close();
    });

    it('should use socket IP for rate limiting, ignoring X-Forwarded-For', async () => {
      const { createApp } = await import('../src/server.js');
      const app = await createApp();

      // With trustProxy: false, X-Forwarded-For is ignored and the real socket
      // IP (127.0.0.1 in inject) is used — an attacker cannot bypass rate limiting
      // by spoofing this header to appear as a different IP
      const response = await app.inject({
        method: 'GET',
        url: '/health',
        headers: { 'X-Forwarded-For': '1.2.3.4' },
      });

      expect(response.statusCode).toBe(200);
      await app.close();
    });
  });
});
