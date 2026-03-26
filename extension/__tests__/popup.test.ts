import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getConnectionStatus,
  getPendingMessagesCount,
  formatStatusText,
  initPopup,
} from '../src/popup';

describe('popup.ts', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('getConnectionStatus', () => {
    it('should return connected when backend responds ok', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({ ok: true });

      const status = await getConnectionStatus('http://localhost:8000');
      expect(status.backend).toBe(true);
    });

    it('should return disconnected when backend fails', async () => {
      global.fetch = vi.fn().mockRejectedValueOnce(new Error('Network error'));

      const status = await getConnectionStatus('http://localhost:8000');
      expect(status.backend).toBe(false);
    });

    it('should return disconnected for non-ok response', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({ ok: false });

      const status = await getConnectionStatus('http://localhost:8000');
      expect(status.backend).toBe(false);
    });

    it('should use the provided webhook URL base', async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({ ok: true });
      global.fetch = mockFetch;

      await getConnectionStatus('http://custom:9000');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://custom:9000/health',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });
  });

  describe('getPendingMessagesCount', () => {
    it('should count reply_ keys in chrome storage', async () => {
      (global as any).chrome = {
        storage: {
          local: {
            get: vi.fn().mockResolvedValueOnce({
              reply_thread_1: { draftedReply: 'Hi' },
              reply_thread_2: { draftedReply: 'Hello' },
              other_key: 'value',
            }),
          },
        },
      };

      const count = await getPendingMessagesCount();
      expect(count).toBe(2);
    });

    it('should return 0 when no pending replies', async () => {
      (global as any).chrome = {
        storage: {
          local: {
            get: vi.fn().mockResolvedValueOnce({}),
          },
        },
      };

      const count = await getPendingMessagesCount();
      expect(count).toBe(0);
    });

    it('should return 0 on storage error', async () => {
      (global as any).chrome = {
        storage: {
          local: {
            get: vi.fn().mockRejectedValueOnce(new Error('Storage error')),
          },
        },
      };

      const count = await getPendingMessagesCount();
      expect(count).toBe(0);
    });
  });

  describe('formatStatusText', () => {
    it('should show connected when backend is up', () => {
      expect(formatStatusText({ backend: true })).toBe('Connected');
    });

    it('should show disconnected when backend is down', () => {
      expect(formatStatusText({ backend: false })).toBe('Disconnected');
    });
  });

  describe('initPopup', () => {
    it('should populate DOM elements with status info', async () => {
      document.body.innerHTML = `
        <span id="connection-status"></span>
        <span id="status-indicator"></span>
        <span id="pending-count"></span>
      `;

      (global as any).chrome = {
        storage: {
          local: {
            get: vi.fn().mockResolvedValueOnce({
              webhookUrl: 'http://localhost:8000',
            }).mockResolvedValueOnce({
              reply_thread_1: { draftedReply: 'Hi' },
            }),
          },
        },
      };
      global.fetch = vi.fn().mockResolvedValueOnce({ ok: true });

      await initPopup();

      expect(document.getElementById('connection-status')!.textContent).toBe('Connected');
      expect(document.getElementById('status-indicator')!.classList.contains('connected')).toBe(true);
      expect(document.getElementById('pending-count')!.textContent).toBe('1');
    });

    it('should show disconnected state in DOM', async () => {
      document.body.innerHTML = `
        <span id="connection-status"></span>
        <span id="status-indicator"></span>
        <span id="pending-count"></span>
      `;

      (global as any).chrome = {
        storage: {
          local: {
            get: vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({}),
          },
        },
      };
      global.fetch = vi.fn().mockRejectedValueOnce(new Error('fail'));

      await initPopup();

      expect(document.getElementById('connection-status')!.textContent).toBe('Disconnected');
      expect(document.getElementById('status-indicator')!.classList.contains('disconnected')).toBe(true);
      expect(document.getElementById('pending-count')!.textContent).toBe('0');
    });
  });
});
