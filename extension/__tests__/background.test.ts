import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  handleWebhookSend,
  handleWebhookResponse,
  maintainConnection,
  getConfig,
  pollPendingReplies,
  __testSetAllowedSenders,
} from '../src/background';
import type { MessageData } from '../../shared/types';

describe('background.ts', () => {
  const mockFetch = vi.fn();
  global.fetch = mockFetch;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('getConfig', () => {
    it('should read config from chrome.storage.local', async () => {
      (global as any).chrome = {
        storage: {
          local: {
            get: vi.fn().mockResolvedValueOnce({
              settings: {
                webhookUrl: 'http://custom:9000',
                apiKey: 'my-key',
              },
            }),
          },
        },
      };

      const config = await getConfig();
      expect(config.webhookUrl).toBe('http://custom:9000');
      expect(config.apiKey).toBe('my-key');
    });

    it('should return defaults when no settings stored', async () => {
      (global as any).chrome = {
        storage: {
          local: {
            get: vi.fn().mockResolvedValueOnce({}),
          },
        },
      };

      const config = await getConfig();
      expect(config.webhookUrl).toContain('localhost:8000');
      expect(config.apiKey).toBe('');
    });

    it('should return defaults on storage error', async () => {
      (global as any).chrome = {
        storage: {
          local: {
            get: vi.fn().mockRejectedValueOnce(new Error('fail')),
          },
        },
      };

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
      (global as any).chrome = {
        storage: {
          local: {
            get: vi.fn().mockResolvedValue({
              settings: { webhookUrl: 'http://localhost:8000', apiKey: 'test-key' },
            }),
          },
        },
      };
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

      const sendPromise = handleWebhookSend(mockMessage);
      // Advance past all retry delays (1000 + 2000 + 3000)
      await vi.advanceTimersByTimeAsync(10000);
      await expect(sendPromise).resolves.not.toThrow();
    });

    it('should handle HTTP error responses', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const sendPromise = handleWebhookSend(mockMessage);
      await vi.advanceTimersByTimeAsync(10000);
      await expect(sendPromise).resolves.not.toThrow();
    });

    it('should retry on failure', async () => {
      mockFetch
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true }),
        });

      const sendPromise = handleWebhookSend(mockMessage);
      // Advance past retry delay
      await vi.advanceTimersByTimeAsync(2000);
      await sendPromise;

      expect(mockFetch).toHaveBeenCalledTimes(2);
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

    it('should set up message listener', () => {
      const mockRuntime = {
        onMessage: { addListener: vi.fn() },
        onMessageExternal: { addListener: vi.fn() },
      };
      (global as any).chrome = { runtime: mockRuntime, alarms: { create: vi.fn(), onAlarm: { addListener: vi.fn() } } };

      maintainConnection();

      expect(mockRuntime.onMessage.addListener).toHaveBeenCalled();
    });

    it('should listen for external messages with sender validation', () => {
      const mockOnMessageExternal = { addListener: vi.fn() };
      const mockRuntime = {
        onMessage: { addListener: vi.fn() },
        onMessageExternal: mockOnMessageExternal,
      };
      (global as any).chrome = { runtime: mockRuntime, alarms: { create: vi.fn(), onAlarm: { addListener: vi.fn() } } };

      maintainConnection();

      expect(mockOnMessageExternal.addListener).toHaveBeenCalled();
    });

    it('should handle NEW_MESSAGE_DETECTED and call sendResponse on success', async () => {
      let messageCallback: Function;
      const mockRuntime = {
        onMessage: {
          addListener: vi.fn((cb: Function) => { messageCallback = cb; }),
        },
        onMessageExternal: { addListener: vi.fn() },
      };
      (global as any).chrome = {
        runtime: mockRuntime,
        alarms: { create: vi.fn(), onAlarm: { addListener: vi.fn() } },
        storage: {
          local: {
            get: vi.fn().mockResolvedValue({
              settings: { webhookUrl: 'http://localhost:8000/webhook/message', apiKey: '' },
            }),
          },
        },
      };

      mockFetch.mockResolvedValueOnce({ ok: true });

      maintainConnection();

      const sendResponse = vi.fn();
      const result = messageCallback!(
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
      let messageCallback: Function;
      const mockRuntime = {
        onMessage: {
          addListener: vi.fn((cb: Function) => { messageCallback = cb; }),
        },
        onMessageExternal: { addListener: vi.fn() },
      };
      (global as any).chrome = { runtime: mockRuntime, alarms: { create: vi.fn(), onAlarm: { addListener: vi.fn() } } };

      maintainConnection();

      const sendResponse = vi.fn();
      const result = messageCallback!({ type: 'UNKNOWN' }, {}, sendResponse);

      expect(result).toBe(false);
    });

    it('should reject external messages when allowlist is empty', async () => {
      let externalCallback: Function;
      const mockRuntime = {
        onMessage: { addListener: vi.fn() },
        onMessageExternal: {
          addListener: vi.fn((cb: Function) => { externalCallback = cb; }),
        },
      };
      const mockStorage = { set: vi.fn().mockResolvedValue(undefined) };
      const mockTabs = { query: vi.fn().mockResolvedValue([]), sendMessage: vi.fn() };
      (global as any).chrome = {
        runtime: mockRuntime,
        storage: { local: mockStorage },
        tabs: mockTabs,
        alarms: { create: vi.fn(), onAlarm: { addListener: vi.fn() } },
      };

      maintainConnection();

      // Send from an unknown extension — should be rejected since allowlist is empty
      externalCallback!({
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

      let externalCallback: Function;
      const mockRuntime = {
        onMessage: { addListener: vi.fn() },
        onMessageExternal: {
          addListener: vi.fn((cb: Function) => { externalCallback = cb; }),
        },
      };
      const mockStorage = { set: vi.fn().mockResolvedValue(undefined) };
      const mockTabs = { query: vi.fn().mockResolvedValue([]), sendMessage: vi.fn() };
      (global as any).chrome = {
        runtime: mockRuntime,
        storage: { local: mockStorage },
        tabs: mockTabs,
        alarms: { create: vi.fn(), onAlarm: { addListener: vi.fn() } },
      };

      maintainConnection();

      externalCallback!({
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
              settings: { webhookUrl: 'http://localhost:8000', apiKey: 'test-key' },
            }),
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
              settings: { webhookUrl: 'http://localhost:8000', apiKey: 'test-key' },
            }),
          },
        },
      };

      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(pollPendingReplies()).resolves.not.toThrow();
    });

    it('should be triggered by pollReplies alarm', () => {
      let alarmCallback: Function;
      const mockAlarms = {
        create: vi.fn(),
        onAlarm: { addListener: vi.fn((cb: Function) => { alarmCallback = cb; }) },
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
