import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  detectNewMessages,
  isRecruiterMessage,
  extractMessageData,
  resetProcessedMessages,
  RECRUITER_KEYWORDS,
} from '../src/content';
import type { MessageData } from '../../shared/types';

describe('content.ts', () => {
  beforeEach(() => {
    // Mock DOM
    document.body.innerHTML = '';
    vi.clearAllMocks();
    resetProcessedMessages();

    // Mock chrome.runtime.sendMessage
    (global as any).chrome = {
      runtime: {
        sendMessage: vi.fn().mockResolvedValue(undefined),
      },
    };
    // Mock CSS.escape if not available in jsdom
    if (typeof CSS === 'undefined' || !CSS.escape) {
      (global as any).CSS = {
        escape: (value: string) => value.replace(/([^\w-])/g, '\\$1'),
      };
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('RECRUITER_KEYWORDS', () => {
    it('should contain expected recruiter keywords', () => {
      expect(RECRUITER_KEYWORDS).toContain('opportunity');
      expect(RECRUITER_KEYWORDS).toContain('role');
      expect(RECRUITER_KEYWORDS).toContain('hiring');
      expect(RECRUITER_KEYWORDS).toContain('position');
      expect(RECRUITER_KEYWORDS).toContain('interview');
    });

    it('should be case-insensitive in usage', () => {
      expect(RECRUITER_KEYWORDS.length).toBeGreaterThan(0);
    });
  });

  describe('isRecruiterMessage', () => {
    it('should return true for messages containing recruiter keywords', () => {
      expect(isRecruiterMessage('I have an exciting opportunity for you')).toBe(true);
      expect(isRecruiterMessage('We are hiring for a senior role')).toBe(true);
      expect(isRecruiterMessage('This position would be perfect for you')).toBe(true);
    });

    it('should return false for non-recruiter messages', () => {
      expect(isRecruiterMessage('Hey, how are you doing?')).toBe(false);
      expect(isRecruiterMessage('Thanks for connecting')).toBe(false);
      expect(isRecruiterMessage('Great post!')).toBe(false);
    });

    it('should be case-insensitive', () => {
      expect(isRecruiterMessage('I have an OPPORTUNITY for you')).toBe(true);
      expect(isRecruiterMessage('We Are Hiring')).toBe(true);
    });

    it('should handle empty strings', () => {
      expect(isRecruiterMessage('')).toBe(false);
    });
  });

  describe('extractMessageData', () => {
    it('should extract message data from DOM element', () => {
      const mockElement = document.createElement('div');
      mockElement.innerHTML = `
        <div class="msg-s-message-group__profile-card">
          <span class="msg-s-message-group__name">Jane Smith</span>
          <span class="msg-s-message-group__title">Senior Technical Recruiter at TechCorp</span>
        </div>
        <div class="msg-s-event-listitem__body">
          <p>Hi! I have an exciting Senior Backend Engineer opportunity at TechCorp. We're looking for someone with Go and Kubernetes experience. Remote position paying $200K+.</p>
        </div>
      `;
      mockElement.setAttribute('data-thread-id', 'thread_123');

      const result = extractMessageData(mockElement, 'msg_456');

      expect(result).toBeDefined();
      expect(result.message_id).toBe('msg_456');
      expect(result.thread_id).toBe('thread_123');
      expect(result.sender.name).toBe('Jane Smith');
      expect(result.sender.title).toBe('Senior Technical Recruiter at TechCorp');
      expect(result.sender.company).toBe('TechCorp');
      expect(result.content).toContain('Senior Backend Engineer');
    });

    it('should handle missing elements gracefully', () => {
      const mockElement = document.createElement('div');
      mockElement.setAttribute('data-thread-id', 'thread_123');

      const result = extractMessageData(mockElement, 'msg_456');

      expect(result).toBeDefined();
      expect(result.sender.name).toBe('Unknown');
      expect(result.sender.title).toBe('Unknown');
      expect(result.sender.company).toBe('Unknown');
    });

    it('should use "unknown" when data-thread-id attribute is missing', () => {
      const mockElement = document.createElement('div');
      const result = extractMessageData(mockElement, 'msg_789');
      expect(result.thread_id).toBe('unknown');
    });

    it('should generate unique message IDs', () => {
      const mockElement = document.createElement('div');
      mockElement.setAttribute('data-thread-id', 'thread_123');

      const result1 = extractMessageData(mockElement, 'msg_456');
      const result2 = extractMessageData(mockElement, 'msg_457');

      expect(result1.message_id).not.toBe(result2.message_id);
    });
  });

  describe('detectNewMessages', () => {
    it('should find unprocessed messages', () => {
      document.body.innerHTML = `
        <div id="msg-conversations-container">
          <div class="msg-s-message-group" data-thread-id="thread_1">
            <div class="msg-s-message-group__profile-card">
              <span class="msg-s-message-group__name">Jane Smith</span>
            </div>
            <div class="msg-s-event-listitem__body">
              <p>I have an opportunity for you</p>
            </div>
          </div>
          <div class="msg-s-message-group" data-thread-id="thread_2">
            <div class="msg-s-message-group__profile-card">
              <span class="msg-s-message-group__name">Bob Johnson</span>
            </div>
            <div class="msg-s-event-listitem__body">
              <p>Hello!</p>
            </div>
          </div>
        </div>
      `;

      const messages = detectNewMessages();

      expect(messages).toHaveLength(1);
      expect(messages[0].sender.name).toBe('Jane Smith');
    });

    it('should mark messages as processed', () => {
      document.body.innerHTML = `
        <div id="msg-conversations-container">
          <div class="msg-s-message-group" data-thread-id="thread_1">
            <div class="msg-s-event-listitem__body">
              <p>I have an opportunity for you</p>
            </div>
          </div>
        </div>
      `;

      detectNewMessages();
      const messages = detectNewMessages();

      expect(messages).toHaveLength(0);
    });

    it('should return empty array when no messages found', () => {
      document.body.innerHTML = '';
      const messages = detectNewMessages();
      expect(messages).toEqual([]);
    });

    it('should fallback to thread_index when data-thread-id is missing', () => {
      document.body.innerHTML = `
        <div id="msg-conversations-container">
          <div class="msg-s-message-group">
            <div class="msg-s-event-listitem__body">
              <p>I have a great opportunity for you</p>
            </div>
          </div>
        </div>
      `;

      const messages = detectNewMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0].thread_id).toBe('unknown');
    });

    it('should skip messages with empty content', () => {
      document.body.innerHTML = `
        <div id="msg-conversations-container">
          <div class="msg-s-message-group" data-thread-id="thread_empty">
            <div class="msg-s-event-listitem__body"></div>
          </div>
        </div>
      `;

      const messages = detectNewMessages();
      expect(messages).toHaveLength(0);
    });

    it('should send detected messages to background script', () => {
      document.body.innerHTML = `
        <div id="msg-conversations-container">
          <div class="msg-s-message-group" data-thread-id="thread_bg">
            <div class="msg-s-event-listitem__body">
              <p>I have an exciting opportunity for you</p>
            </div>
          </div>
        </div>
      `;

      detectNewMessages();

      expect((global as any).chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'NEW_MESSAGE_DETECTED',
          data: expect.objectContaining({
            thread_id: 'thread_bg',
          }),
        })
      );
    });
  });
});
