import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { webhookRoutes } from '../src/routes/webhook.js';

// Mock config with real values
vi.mock('../src/config.js', () => ({
  config: {
    port: 8000,
    host: '127.0.0.1',
    telegramBotToken: 'test-token',
    telegramUserId: '123456789',
    apiKey: 'test-api-key',
    telegramWebhookSecret: 'test-webhook-secret',
    databasePath: ':memory:',
    googleClientId: 'test-client-id',
    googleClientSecret: 'test-client-secret',
    googleRefreshToken: 'test-refresh-token',
  },
  validateConfig: vi.fn(),
}));

// Mock TelegramBot
vi.mock('node-telegram-bot-api', () => ({
  default: vi.fn().mockImplementation(() => ({
    sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
    answerCallbackQuery: vi.fn().mockResolvedValue(true),
    editMessageText: vi.fn().mockResolvedValue({ message_id: 1 }),
  })),
}));

// Mock only external APIs — telegram service and calendar
vi.mock('../src/services/telegram.js', () => ({
  sendApprovalRequest: vi.fn().mockResolvedValue(undefined),
  handleCallbackQuery: vi.fn().mockResolvedValue({
    message_id: 'msg_int_1',
    action: 'lets_talk',
  }),
}));

vi.mock('../src/services/calendar.js', () => ({
  generateTimeSlots: vi.fn().mockReturnValue([
    '2026-03-30T14:00:00.000Z',
    '2026-03-30T18:00:00.000Z',
    '2026-03-30T20:00:00.000Z',
  ]),
  scheduleMeeting: vi.fn().mockResolvedValue({
    id: 'event_int_1',
    summary: 'Interview',
    start: { dateTime: '2026-03-30T14:00:00.000Z', timeZone: 'America/New_York' },
    end: { dateTime: '2026-03-30T15:00:00.000Z', timeZone: 'America/New_York' },
  }),
}));

// Use REAL database (not mocked) — this is what makes it an integration test
// database.js is NOT mocked, so it uses real SQLite in-memory

import { sendApprovalRequest, handleCallbackQuery } from '../src/services/telegram.js';

describe('integration: full webhook flow with real database', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    await app.register(webhookRoutes);
  });

  afterEach(async () => {
    await app.close();
  });

  it('should store message in DB, then retrieve it during callback, then deliver via pending-replies', async () => {
    // Step 1: Send a message from the extension
    const messageResponse = await app.inject({
      method: 'POST',
      url: '/webhook/message',
      payload: {
        message_id: 'msg_int_1',
        thread_id: 'thread_int_1',
        sender: {
          name: 'Integration Recruiter',
          title: 'VP Engineering',
          company: 'IntegrationCorp',
        },
        content: 'We have a senior Go backend role with distributed systems. Remote, $250K.',
        timestamp: '2026-03-26T17:00:00Z',
      },
      headers: { 'X-API-Key': 'test-api-key' },
    });

    expect(messageResponse.statusCode).toBe(200);
    const messageBody = JSON.parse(messageResponse.payload);
    expect(messageBody.success).toBe(true);
    expect(messageBody.status).toBe('approval_requested');

    // Verify Telegram approval was sent
    expect(vi.mocked(sendApprovalRequest)).toHaveBeenCalledWith(
      expect.objectContaining({ message_id: 'msg_int_1' }),
      '123456789'
    );

    // Step 2: Simulate Telegram callback (user taps "let's talk")
    vi.mocked(handleCallbackQuery).mockResolvedValueOnce({
      message_id: 'msg_int_1',
      action: 'lets_talk',
    });

    const callbackResponse = await app.inject({
      method: 'POST',
      url: '/webhook/telegram/callback',
      payload: {
        callback_query: {
          id: 'cb_int_1',
          data: '{"m":"msg_int_1","a":"lt"}',
          message: { chat: { id: 123 }, message_id: 999 },
        },
      },
      headers: { 'X-Telegram-Bot-Api-Secret-Token': 'test-webhook-secret' },
    });

    expect(callbackResponse.statusCode).toBe(200);
    const callbackBody = JSON.parse(callbackResponse.payload);

    // Should have used the REAL stored message data from DB
    expect(callbackBody.thread_id).toBe('thread_int_1');
    expect(callbackBody.drafted_reply).toContain('IntegrationCorp');
    expect(callbackBody.suggested_times).toHaveLength(3);

    // Step 3: Poll for pending replies (extension polling)
    const pendingResponse = await app.inject({
      method: 'GET',
      url: '/webhook/pending-replies',
      headers: { 'X-API-Key': 'test-api-key' },
    });

    expect(pendingResponse.statusCode).toBe(200);
    const pendingBody = JSON.parse(pendingResponse.payload);
    expect(pendingBody.replies).toHaveLength(1);
    expect(pendingBody.replies[0].message_id).toBe('msg_int_1');
    expect(pendingBody.replies[0].thread_id).toBe('thread_int_1');
    expect(pendingBody.replies[0].drafted_reply).toContain('IntegrationCorp');

    // Step 4: Poll again — should be empty (marked delivered)
    const secondPoll = await app.inject({
      method: 'GET',
      url: '/webhook/pending-replies',
      headers: { 'X-API-Key': 'test-api-key' },
    });

    expect(secondPoll.statusCode).toBe(200);
    const secondBody = JSON.parse(secondPoll.payload);
    expect(secondBody.replies).toHaveLength(0);
  });

  it('should handle not_interested flow without scheduling', async () => {
    // Send message
    await app.inject({
      method: 'POST',
      url: '/webhook/message',
      payload: {
        message_id: 'msg_int_2',
        thread_id: 'thread_int_2',
        sender: { name: 'Recruiter B', title: 'Recruiter', company: 'CorpB' },
        content: 'PHP developer needed for WordPress project',
        timestamp: '2026-03-26T18:00:00Z',
      },
      headers: { 'X-API-Key': 'test-api-key' },
    });

    // Callback with not_interested
    vi.mocked(handleCallbackQuery).mockResolvedValueOnce({
      message_id: 'msg_int_2',
      action: 'not_interested',
    });

    const callbackResponse = await app.inject({
      method: 'POST',
      url: '/webhook/telegram/callback',
      payload: {
        callback_query: {
          id: 'cb_int_2',
          data: '{"m":"msg_int_2","a":"ni"}',
          message: { chat: { id: 123 }, message_id: 888 },
        },
      },
      headers: { 'X-Telegram-Bot-Api-Secret-Token': 'test-webhook-secret' },
    });

    const body = JSON.parse(callbackResponse.payload);
    expect(body.success).toBe(true);
    expect(body.user_choice).toBe('not_interested');
    expect(body.drafted_reply).toContain("doesn't align");
    expect(body.suggested_times).toBeUndefined();
  });
});
