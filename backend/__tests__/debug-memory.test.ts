import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/server.js';

vi.mock('../src/config.js', () => ({
  config: {
    port: 8000,
    host: '127.0.0.1',
    apiKey: 'test-api-key',
    extensionId: 'test-extension-id',
    databasePath: ':memory:',
    telegramBotToken: 'test-token',
    telegramUserId: '123456789',
    telegramWebhookSecret: 'test-webhook-secret',
    googleClientId: 'test-client-id',
    googleClientSecret: 'test-client-secret',
    googleRefreshToken: 'test-refresh-token',
  },
  validateConfig: vi.fn(),
}));

vi.mock('node-telegram-bot-api', () => ({
  default: vi.fn().mockImplementation(() => ({
    sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
    answerCallbackQuery: vi.fn().mockResolvedValue(true),
    editMessageText: vi.fn().mockResolvedValue({ message_id: 1 }),
  })),
}));

vi.mock('../src/services/telegram.js', () => ({
  sendApprovalRequest: vi.fn().mockResolvedValue(undefined),
  handleCallbackQuery: vi.fn().mockResolvedValue({ message_id: 'msg_123', action: 'lets_talk' }),
}));

vi.mock('../src/services/calendar.js', () => ({
  generateTimeSlots: vi.fn().mockReturnValue([]),
  scheduleMeeting: vi.fn().mockResolvedValue({}),
}));

vi.mock('../src/db/database.js', () => ({
  initDatabase: vi.fn().mockReturnValue({
    prepare: vi.fn().mockReturnValue({ run: vi.fn(), get: vi.fn(), all: vi.fn() }),
    transaction: vi.fn().mockReturnValue({ exclusive: vi.fn().mockReturnValue([]) }),
    exec: vi.fn(),
    close: vi.fn(),
  }),
  saveMessage: vi.fn(),
  getMessage: vi.fn().mockReturnValue(null),
  updateMessageStatus: vi.fn(),
  savePendingReply: vi.fn(),
  getPendingReplies: vi.fn().mockReturnValue([]),
}));

describe('GET /debug/memory', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await createApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns memory stats in non-production environment', async () => {
    const res = await app.inject({ method: 'GET', url: '/debug/memory' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(typeof body.rss).toBe('number');
    expect(typeof body.heapTotal).toBe('number');
    expect(typeof body.heapUsed).toBe('number');
    expect(typeof body.external).toBe('number');
    expect(body.heapUsed).toBeGreaterThan(0);
  });

  it('is excluded from rate limiting', async () => {
    for (let i = 0; i < 20; i++) {
      const res = await app.inject({ method: 'GET', url: '/debug/memory' });
      expect(res.statusCode).toBe(200);
    }
  });
});

describe('GET /debug/memory (production)', () => {
  let app: FastifyInstance;
  let originalEnv: string | undefined;

  beforeEach(async () => {
    originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    app = await createApp();
  });

  afterEach(async () => {
    process.env.NODE_ENV = originalEnv;
    await app.close();
  });

  it('returns 404 in production', async () => {
    const res = await app.inject({ method: 'GET', url: '/debug/memory' });
    expect(res.statusCode).toBe(404);
  });
});
