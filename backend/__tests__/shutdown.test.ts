import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

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

describe('registerShutdownHandlers', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let onceSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as () => never);
    onceSpy = vi.spyOn(process, 'once');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Remove any lingering SIGTERM/SIGINT listeners added during tests
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
  });

  function makeMockApp(closeImpl?: () => Promise<void>): FastifyInstance {
    return {
      close: vi.fn().mockImplementation(closeImpl ?? (() => Promise.resolve())),
      log: {
        info: vi.fn(),
        error: vi.fn(),
      },
    } as unknown as FastifyInstance;
  }

  it('registers SIGTERM and SIGINT listeners', async () => {
    const { registerShutdownHandlers } = await import('../src/server.js');
    const app = makeMockApp();
    registerShutdownHandlers(app);

    const signals = onceSpy.mock.calls.map(([sig]) => sig);
    expect(signals).toContain('SIGTERM');
    expect(signals).toContain('SIGINT');
  });

  it('SIGTERM calls app.close() and exits with 0', async () => {
    const { registerShutdownHandlers } = await import('../src/server.js');
    const app = makeMockApp();
    registerShutdownHandlers(app);

    process.emit('SIGTERM');
    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(0));
    expect(app.close).toHaveBeenCalledOnce();
  });

  it('SIGINT calls app.close() and exits with 0', async () => {
    const { registerShutdownHandlers } = await import('../src/server.js');
    const app = makeMockApp();
    registerShutdownHandlers(app);

    process.emit('SIGINT');
    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(0));
    expect(app.close).toHaveBeenCalledOnce();
  });

  it('double signal is idempotent — app.close() called only once', async () => {
    const { registerShutdownHandlers } = await import('../src/server.js');
    const app = makeMockApp();
    registerShutdownHandlers(app);

    process.emit('SIGTERM');
    process.emit('SIGTERM');
    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalled());
    expect(app.close).toHaveBeenCalledOnce();
  });

  it('exits with 1 when app.close() rejects', async () => {
    const { registerShutdownHandlers } = await import('../src/server.js');
    const app = makeMockApp(() => Promise.reject(new Error('close failed')));
    registerShutdownHandlers(app);

    process.emit('SIGTERM');
    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(1));
  });

  it('forced timeout calls process.exit(1) when app.close() hangs', async () => {
    vi.useFakeTimers();
    const { registerShutdownHandlers } = await import('../src/server.js');
    const app = makeMockApp(() => new Promise(() => {})); // never resolves
    registerShutdownHandlers(app, 5_000);

    process.emit('SIGTERM');
    await vi.advanceTimersByTimeAsync(5_001);
    expect(exitSpy).toHaveBeenCalledWith(1);
    vi.useRealTimers();
  });
});

describe('database onClose hook', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('closes the database when app.close() is called', async () => {
    // Clear module cache so the fresh import below picks up the doMock factory.
    vi.resetModules();

    const mockClose = vi.fn();
    const mockDb = {
      prepare: vi.fn().mockReturnValue({ run: vi.fn(), get: vi.fn(), all: vi.fn() }),
      exec: vi.fn(),
      close: mockClose,
      transaction: vi.fn().mockImplementation((fn: () => unknown) => {
        const txFn = fn as () => unknown;
        (txFn as any).exclusive = vi.fn().mockReturnValue([]);
        return txFn;
      }),
    };

    // vi.doMock overrides for this import cycle; top-level vi.mock factories
    // (config, telegram, calendar) remain active in the mock registry.
    vi.doMock('../src/db/database.js', () => ({
      initDatabase: vi.fn().mockReturnValue(mockDb),
      saveMessage: vi.fn(),
      getMessage: vi.fn().mockReturnValue(null),
      updateMessageStatus: vi.fn(),
      savePendingReply: vi.fn(),
      getPendingReplies: vi.fn().mockReturnValue([]),
    }));

    const { createApp } = await import('../src/server.js');
    const app = await createApp();
    await app.close();

    expect(mockClose).toHaveBeenCalledOnce();
  });
});
