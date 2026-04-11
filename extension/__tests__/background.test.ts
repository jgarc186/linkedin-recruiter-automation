import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  handleWebhookSend,
  handleWebhookResponse,
  maintainConnection,
  getConfig,
  pollPendingReplies,
  processPendingSends,
  __testSetAllowedSenders,
  __testOnAlarmHandler,
  __testOnMessageHandler,
  __testOnExternalMessageHandler,
} from '../src/background';
import type { MessageData } from '../../shared/types';

describe('background.ts', () => {
  const mockFetch = vi.fn();
  global.fetch = mockFetch;

  function setupChromeStorageMocks(overrides?: {
    localGet?: ReturnType<typeof vi.fn>;
    localSet?: ReturnType<typeof vi.fn>;
    sessionGet?: ReturnType<typeof vi.fn>;
    sessionSet?: ReturnType<typeof vi.fn>;
  }) {
    const localGet = overrides?.localGet ?? vi.fn().mockResolvedValue({});
    const localSet = overrides?.localSet ?? vi.fn().mockResolvedValue(undefined);
    const sessionGet = overrides?.sessionGet ?? vi.fn().mockResolvedValue({});
    const sessionSet = overrides?.sessionSet ?? vi.fn().mockResolvedValue(undefined);

    (global as any).chrome = {
      storage: {
        local: { get: localGet, set: localSet },
        session: { get: sessionGet, set: sessionSet },
      },
    };

    return { localGet, localSet, sessionGet, sessionSet };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('getConfig', () => {
    it('should read config from chrome.storage.local/session', async () => {
      setupChromeStorageMocks({
        localGet: vi.fn().mockResolvedValueOnce({
          settings: {
            webhookUrl: 'http://custom:9000',
          },
        }),
        sessionGet: vi.fn().mockResolvedValueOnce({ apiKey: 'my-key' }),
      });

      const config = await getConfig();
      expect(config.webhookUrl).toBe('http://custom:9000');
      expect(config.apiKey).toBe('my-key');
    });

    it('should return defaults when no settings stored', async () => {
      setupChromeStorageMocks({
        localGet: vi.fn().mockResolvedValueOnce({}),
        sessionGet: vi.fn().mockResolvedValueOnce({}),
      });

      const config = await getConfig();
      expect(config.webhookUrl).toContain('localhost:8000');
      expect(config.apiKey).toBe('');
    });

    it('should read criteria from settings', async () => {
      const criteria = {
        minSeniority: 'staff',
        preferredTechStack: ['Python'],
        avoidKeywords: [],
        locations: ['Remote'],
        minCompensation: 150000,
      };

      setupChromeStorageMocks({
        localGet: vi.fn().mockResolvedValueOnce({
          settings: {
            webhookUrl: 'http://localhost:8000',
            criteria,
          },
        }),
        sessionGet: vi.fn().mockResolvedValueOnce({ apiKey: 'test-key' }),
      });

      const config = await getConfig();
      expect(config.criteria).toEqual(criteria);
    });

    it('should migrate legacy apiKey from local to session', async () => {
      const localSet = vi.fn().mockResolvedValue(undefined);
      const sessionSet = vi.fn().mockResolvedValue(undefined);
      setupChromeStorageMocks({
        localGet: vi.fn().mockResolvedValueOnce({
          settings: {
            webhookUrl: 'http://localhost:8000',
            apiKey: 'legacy-key',
          },
        }),
        localSet,
        sessionGet: vi.fn().mockResolvedValueOnce({}),
        sessionSet,
      });

      const config = await getConfig();
      expect(config.apiKey).toBe('legacy-key');
      expect(sessionSet).toHaveBeenCalledWith({ apiKey: 'legacy-key' });
      expect(localSet).toHaveBeenCalledWith({
        settings: {
          webhookUrl: 'http://localhost:8000',
          criteria: undefined,
        },
      });
    });

    it('should return defaults on storage error', async () => {
      setupChromeStorageMocks({
        localGet: vi.fn().mockRejectedValueOnce(new Error('fail')),
      });

      const config = await getConfig();
      expect(config.webhookUrl).toContain('localhost:8000');
    });
  });

  describe('handleWebhookSend', () => {
    const mockMessage: MessageData = {
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

    beforeEach(() => {
      setupChromeStorageMocks({
        localGet: vi.fn().mockResolvedValue({
          settings: { webhookUrl: 'http://localhost:8000' },
        }),
        localSet: vi.fn().mockResolvedValue(undefined),
        sessionGet: vi.fn().mockResolvedValue({ apiKey: 'test-key' }),
      });
    });

    it('should POST message data to webhook endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      await handleWebhookSend(mockMessage);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/webhook/message'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
          body: expect.any(String),
        })
      );

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.message_id).toBe('msg_123');
    });

    it('should include API key in headers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      await handleWebhookSend(mockMessage);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-API-Key': 'test-key',
          }),
        })
      );
    });

    it('should handle network errors gracefully', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      await expect(handleWebhookSend(mockMessage)).resolves.not.toThrow();
      // Should have enqueued to pending_sends since single attempt failed
      expect((global as any).chrome.storage.local.set).toHaveBeenCalled();
    });

    it('should handle HTTP error responses', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(handleWebhookSend(mockMessage)).resolves.not.toThrow();
      // Should have enqueued to pending_sends since single attempt failed
      expect((global as any).chrome.storage.local.set).toHaveBeenCalled();
    });

    it('should queue message on failure for retry by processPendingSends', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await handleWebhookSend(mockMessage);

      // Single attempt made (no retry loop inside handleWebhookSend)
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // But message should be enqueued to pending_sends for later retry
      expect((global as any).chrome.storage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({
          pending_sends: expect.any(Array),
        })
      );
    });

    it('should include criteria from settings in payload', async () => {
      const criteria = {
        minSeniority: 'staff',
        preferredTechStack: ['Python', 'Java'],
        avoidKeywords: ['PHP'],
        locations: ['Austin'],
        minCompensation: 150000,
      };

      (global as any).chrome.storage.local.get = vi.fn().mockResolvedValue({
        settings: {
          webhookUrl: 'http://localhost:8000',
          criteria,
        },
      });
      (global as any).chrome.storage.session.get = vi.fn().mockResolvedValue({
        apiKey: 'test-key',
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      await handleWebhookSend(mockMessage);

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.criteria).toEqual(criteria);
    });

    it('should omit criteria from payload when not in settings', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      await handleWebhookSend(mockMessage);

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.criteria).toBeUndefined();
    });
  });

  describe('processPendingSends', () => {
    it('should retry pending sends and remove successful ones', async () => {
      const pendingSends = [
        {
          id: 'send_1',
          data: { message_id: 'msg_1', thread_id: 't_1', sender: { name: 'A', title: 'B', company: 'C' }, content: 'test', timestamp: '2026-01-01' },
          enqueuedAt: Date.now() - 1000,
          attempts: 1,
        },
      ];

      (global as any).chrome = {
        storage: {
          local: {
            get: vi.fn()
              .mockResolvedValueOnce({ pending_sends: pendingSends })
              .mockResolvedValueOnce({ settings: { webhookUrl: 'http://localhost:8000' } }),
            set: vi.fn().mockResolvedValue(undefined),
          },
          session: {
            get: vi.fn().mockResolvedValueOnce({ apiKey: 'test-key' }),
            set: vi.fn().mockResolvedValue(undefined),
          },
        },
      };

      mockFetch.mockResolvedValueOnce({ ok: true });

      await processPendingSends();

      // Should have attempted fetch
      expect(mockFetch).toHaveBeenCalled();
      // Should have written updated (empty) list to storage
      expect((global as any).chrome.storage.local.set).toHaveBeenCalledWith({
        pending_sends: [],
      });
    });

    it('should keep failed sends in queue with incremented attempts', async () => {
      const pendingSends = [
        {
          id: 'send_1',
          data: { message_id: 'msg_1', thread_id: 't_1', sender: { name: 'A', title: 'B', company: 'C' }, content: 'test', timestamp: '2026-01-01' },
          enqueuedAt: Date.now() - 1000,
          attempts: 0,
        },
      ];

      (global as any).chrome = {
        storage: {
          local: {
            get: vi.fn()
              .mockResolvedValueOnce({ pending_sends: pendingSends })
              .mockResolvedValueOnce({ settings: { webhookUrl: 'http://localhost:8000' } }),
            set: vi.fn().mockResolvedValue(undefined),
          },
          session: {
            get: vi.fn().mockResolvedValueOnce({ apiKey: 'test-key' }),
            set: vi.fn().mockResolvedValue(undefined),
          },
        },
      };

      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await processPendingSends();

      // Should have attempted fetch
      expect(mockFetch).toHaveBeenCalled();
      // Should have written queue with failed send and incremented attempts
      expect((global as any).chrome.storage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({
          pending_sends: expect.arrayContaining([
            expect.objectContaining({
              id: 'send_1',
              attempts: 1,
            }),
          ]),
        })
      );
    });

    it('should prune stale sends older than TTL', async () => {
      const staleTime = Date.now() - (25 * 60 * 60 * 1000); // older than 24h TTL
      const pendingSends = [
        {
          id: 'stale_send',
          data: { message_id: 'msg_1', thread_id: 't_1', sender: { name: 'A', title: 'B', company: 'C' }, content: 'test', timestamp: '2026-01-01' },
          enqueuedAt: staleTime,
          attempts: 5,
        },
      ];

      (global as any).chrome = {
        storage: {
          local: {
            get: vi.fn().mockResolvedValueOnce({ pending_sends: pendingSends }),
            set: vi.fn().mockResolvedValue(undefined),
          },
        },
      };

      await processPendingSends();

      // Should NOT attempt to fetch stale send
      expect(mockFetch).not.toHaveBeenCalled();
      // Should have written empty queue (stale entry pruned)
      expect((global as any).chrome.storage.local.set).toHaveBeenCalledWith({
        pending_sends: [],
      });
    });

    it('should handle empty pending sends queue', async () => {
      (global as any).chrome = {
        storage: {
          local: {
            get: vi.fn().mockResolvedValueOnce({ pending_sends: [] }),
            set: vi.fn().mockResolvedValue(undefined),
          },
        },
      };

      await processPendingSends();

      // Should not fetch anything
      expect(mockFetch).not.toHaveBeenCalled();
      // Should write empty queue to storage
      expect((global as any).chrome.storage.local.set).toHaveBeenCalledWith({
        pending_sends: [],
      });
    });
  });

  describe('handleWebhookResponse', () => {
    it('should store drafted reply in chrome storage', async () => {
      const mockResponse = {
        message_id: 'msg_123',
        thread_id: 'thread_456',
        user_choice: 'lets_talk' as const,
        drafted_reply: 'Thanks for reaching out!',
      };

      const mockStorage = { set: vi.fn().mockResolvedValue(undefined) };
      const mockTabs = { query: vi.fn().mockResolvedValue([]), sendMessage: vi.fn() };
      (global as any).chrome = {
        storage: { local: mockStorage },
        tabs: mockTabs,
      };

      await handleWebhookResponse(mockResponse);

      expect(mockStorage.set).toHaveBeenCalledWith(
        expect.objectContaining({
          [`reply_thread_456`]: expect.any(Object),
        })
      );
    });

    it('should notify content script of new reply', async () => {
      const mockResponse = {
        message_id: 'msg_123',
        thread_id: 'thread_456',
        user_choice: 'lets_talk' as const,
        drafted_reply: 'Thanks for reaching out!',
      };

      const mockTabs = { query: vi.fn(), sendMessage: vi.fn() };
      (global as any).chrome = {
        tabs: mockTabs,
        storage: { local: { set: vi.fn().mockResolvedValue(undefined) } },
      };

      mockTabs.query.mockResolvedValueOnce([{ id: 123 }]);

      await handleWebhookResponse(mockResponse);

      expect(mockTabs.sendMessage).toHaveBeenCalledWith(
        123,
        expect.objectContaining({
          type: 'NEW_REPLY_AVAILABLE',
          threadId: 'thread_456',
        })
      );
    });

    it('should handle errors gracefully', async () => {
      const mockResponse = {
        message_id: 'msg_123',
        thread_id: 'thread_456',
        user_choice: 'lets_talk' as const,
        drafted_reply: 'Thanks!',
      };

      (global as any).chrome = {
        storage: {
          local: {
            set: vi.fn().mockRejectedValue(new Error('Storage error')),
          },
        },
      };

      await expect(handleWebhookResponse(mockResponse)).resolves.not.toThrow();
    });
  });

  describe('maintainConnection', () => {
    it('should set up chrome.alarms for keep-alive', () => {
      const mockAlarms = {
        create: vi.fn(),
        onAlarm: { addListener: vi.fn() },
      };
      const mockRuntime = {
        onMessage: { addListener: vi.fn() },
        onMessageExternal: { addListener: vi.fn() },
      };
      (global as any).chrome = { runtime: mockRuntime, alarms: mockAlarms };

      maintainConnection();

      expect(mockAlarms.create).toHaveBeenCalledWith('keepAlive', { periodInMinutes: 1 });
    });


    it('should handle NEW_MESSAGE_DETECTED and call sendResponse on success', async () => {
      (global as any).chrome = {
        storage: {
          local: {
            get: vi.fn().mockResolvedValue({
              settings: { webhookUrl: 'http://localhost:8000/webhook/message' },
            }),
            set: vi.fn().mockResolvedValue(undefined),
          },
          session: {
            get: vi.fn().mockResolvedValue({ apiKey: '' }),
            set: vi.fn().mockResolvedValue(undefined),
          },
        },
      };

      mockFetch.mockResolvedValueOnce({ ok: true });

      const sendResponse = vi.fn();
      const result = __testOnMessageHandler(
        { type: 'NEW_MESSAGE_DETECTED', data: { message_id: 'msg_1', thread_id: 't_1', sender: { name: 'A', title: 'B', company: 'C' }, content: 'test', timestamp: '2026-01-01' } },
        {},
        sendResponse
      );

      expect(result).toBe(true);

      // Wait for the async handler to complete
      await vi.waitFor(() => {
        expect(sendResponse).toHaveBeenCalledWith({ success: true });
      });
    });

    it('should return false for unknown message types', () => {
      const sendResponse = vi.fn();
      const result = __testOnMessageHandler({ type: 'UNKNOWN' }, {}, sendResponse);

      expect(result).toBe(false);
    });

    it('should reject external messages when allowlist is empty', async () => {
      const mockStorage = { set: vi.fn().mockResolvedValue(undefined), get: vi.fn().mockResolvedValue({}) };
      const mockTabs = { query: vi.fn().mockResolvedValue([]), sendMessage: vi.fn() };
      (global as any).chrome = {
        storage: { local: mockStorage },
        tabs: mockTabs,
      };

      // Send from an unknown extension — should be rejected since allowlist is empty
      __testOnExternalMessageHandler({
        type: 'DRAFTED_REPLY',
        data: { message_id: 'msg_1', thread_id: 't_1', drafted_reply: 'Hello', user_choice: 'lets_talk' },
      }, { id: 'unknown-extension-id' });

      // Wait a tick and verify storage was NOT called
      await vi.advanceTimersByTimeAsync(100);
      expect(mockStorage.set).not.toHaveBeenCalled();
    });

    it('should handle DRAFTED_REPLY from allowed external sender', async () => {
      // Temporarily allow a specific sender
      __testSetAllowedSenders(['allowed-extension-id']);

      const mockStorage = { set: vi.fn().mockResolvedValue(undefined), get: vi.fn().mockResolvedValue({}) };
      const mockTabs = { query: vi.fn().mockResolvedValue([]), sendMessage: vi.fn() };
      (global as any).chrome = {
        storage: { local: mockStorage },
        tabs: mockTabs,
      };

      __testOnExternalMessageHandler({
        type: 'DRAFTED_REPLY',
        data: { message_id: 'msg_1', thread_id: 't_1', drafted_reply: 'Hello', user_choice: 'lets_talk' },
      }, { id: 'allowed-extension-id' });

      await vi.waitFor(() => {
        expect(mockStorage.set).toHaveBeenCalled();
      });

      // Reset allowlist
      __testSetAllowedSenders([]);
    });
  });

  describe('pollPendingReplies', () => {
    it('should fetch pending replies and call handleWebhookResponse for each', async () => {
      const mockStorage = { set: vi.fn().mockResolvedValue(undefined) };
      const mockTabs = { query: vi.fn().mockResolvedValue([]), sendMessage: vi.fn() };
      (global as any).chrome = {
        storage: {
          local: {
            ...mockStorage,
            get: vi.fn().mockResolvedValue({
              settings: { webhookUrl: 'http://localhost:8000' },
            }),
          },
          session: {
            get: vi.fn().mockResolvedValue({ apiKey: 'test-key' }),
            set: vi.fn().mockResolvedValue(undefined),
          },
        },
        tabs: mockTabs,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          replies: [
            { message_id: 'msg_1', thread_id: 't_1', user_choice: 'lets_talk', drafted_reply: 'Hello' },
            { message_id: 'msg_2', thread_id: 't_2', user_choice: 'not_interested', drafted_reply: 'No thanks' },
          ],
        }),
      });

      await pollPendingReplies();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/webhook/pending-replies',
        expect.objectContaining({
          headers: expect.objectContaining({ 'X-API-Key': 'test-key' }),
        })
      );
      // handleWebhookResponse should be called for each reply (stores in chrome.storage)
      expect(mockStorage.set).toHaveBeenCalledTimes(2);
    });

    it('should handle fetch errors gracefully', async () => {
      (global as any).chrome = {
        storage: {
          local: {
            get: vi.fn().mockResolvedValue({
              settings: { webhookUrl: 'http://localhost:8000' },
            }),
          },
          session: {
            get: vi.fn().mockResolvedValue({ apiKey: 'test-key' }),
            set: vi.fn().mockResolvedValue(undefined),
          },
        },
      };

      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(pollPendingReplies()).resolves.not.toThrow();
    });

    it('should call processPendingSends on keepAlive alarm', async () => {
      (global as any).chrome = {
        storage: {
          local: {
            get: vi.fn().mockResolvedValue({ pending_sends: [] }),
            set: vi.fn().mockResolvedValue(undefined),
          },
        },
      };

      __testOnAlarmHandler({ name: 'keepAlive' } as chrome.alarms.Alarm);

      // processPendingSends should have been called (and thus storage.local.get)
      await vi.waitFor(() => {
        expect((global as any).chrome.storage.local.get).toHaveBeenCalledWith('pending_sends');
      });
    });

    it('should be triggered by pollReplies alarm', () => {
      const mockAlarms = {
        create: vi.fn(),
        onAlarm: { addListener: vi.fn() },
      };
      const mockRuntime = {
        onMessage: { addListener: vi.fn() },
        onMessageExternal: { addListener: vi.fn() },
      };
      (global as any).chrome = { runtime: mockRuntime, alarms: mockAlarms };

      maintainConnection();

      expect(mockAlarms.create).toHaveBeenCalledWith('pollReplies', { periodInMinutes: 0.5 });
    });
  });

  describe('handleWebhookResponse - tab sendMessage error', () => {
    it('should handle sendMessage errors gracefully per tab', async () => {
      const mockResponse = {
        message_id: 'msg_123',
        thread_id: 'thread_456',
        drafted_reply: 'Thanks!',
        user_choice: 'lets_talk' as const,
      };

      const mockTabs = {
        query: vi.fn().mockResolvedValueOnce([{ id: 1 }, { id: 2 }]),
        sendMessage: vi.fn()
          .mockRejectedValueOnce(new Error('Content script not loaded'))
          .mockResolvedValueOnce(undefined),
      };
      (global as any).chrome = {
        tabs: mockTabs,
        storage: { local: { set: vi.fn().mockResolvedValue(undefined) } },
      };

      await handleWebhookResponse(mockResponse);

      // Both tabs attempted
      expect(mockTabs.sendMessage).toHaveBeenCalledTimes(2);
    });
  });
});
