import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  injectReplyButton,
  sendReply,
  handleReplyMessage,
} from '../src/content';

describe('content.ts - reply injection', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
    // Mock CSS.escape if not available in jsdom
    if (typeof CSS === 'undefined' || !CSS.escape) {
      (global as any).CSS = {
        escape: (value: string) => value.replace(/([^\w-])/g, '\\$1'),
      };
    }
    // Mock Selection/Range APIs for jsdom (used by sendReply cursor positioning)
    const mockRange = {
      selectNodeContents: vi.fn(),
      collapse: vi.fn(),
    };
    const mockSelection = {
      removeAllRanges: vi.fn(),
      addRange: vi.fn(),
    };
    vi.spyOn(document, 'createRange').mockReturnValue(mockRange as any);
    vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('injectReplyButton', () => {
    it('should inject a reply container into the thread', () => {
      document.body.innerHTML = `
        <div id="msg-conversations-container">
          <div class="msg-s-message-group" data-thread-id="thread_1">
            <div class="msg-s-event-listitem__body">
              <p>I have an opportunity for you</p>
            </div>
          </div>
        </div>
      `;

      injectReplyButton('thread_1', 'Thanks for reaching out!');

      const replyContainer = document.querySelector('[data-reply-thread="thread_1"]');
      expect(replyContainer).not.toBeNull();
      expect(replyContainer!.querySelector('.lrp-reply-text')!.textContent).toBe('Thanks for reaching out!');
    });

    it('should include a Send button', () => {
      document.body.innerHTML = `
        <div id="msg-conversations-container">
          <div class="msg-s-message-group" data-thread-id="thread_1">
            <div class="msg-s-event-listitem__body"><p>Opportunity</p></div>
          </div>
        </div>
      `;

      injectReplyButton('thread_1', 'Reply text');

      const sendBtn = document.querySelector('[data-reply-thread="thread_1"] .lrp-send-btn');
      expect(sendBtn).not.toBeNull();
      expect(sendBtn!.textContent).toBe('Send');
    });

    it('should include a Dismiss button', () => {
      document.body.innerHTML = `
        <div id="msg-conversations-container">
          <div class="msg-s-message-group" data-thread-id="thread_1">
            <div class="msg-s-event-listitem__body"><p>Opportunity</p></div>
          </div>
        </div>
      `;

      injectReplyButton('thread_1', 'Reply text');

      const dismissBtn = document.querySelector('[data-reply-thread="thread_1"] .lrp-dismiss-btn');
      expect(dismissBtn).not.toBeNull();
      expect(dismissBtn!.textContent).toBe('Dismiss');
    });

    it('should not inject duplicate reply containers', () => {
      document.body.innerHTML = `
        <div id="msg-conversations-container">
          <div class="msg-s-message-group" data-thread-id="thread_1">
            <div class="msg-s-event-listitem__body"><p>Opportunity</p></div>
          </div>
        </div>
      `;

      injectReplyButton('thread_1', 'Reply 1');
      injectReplyButton('thread_1', 'Reply 2');

      const containers = document.querySelectorAll('[data-reply-thread="thread_1"]');
      expect(containers.length).toBe(1);
      // Should update the text
      expect(containers[0].querySelector('.lrp-reply-text')!.textContent).toBe('Reply 2');
    });

    it('should do nothing if container is missing', () => {
      document.body.innerHTML = '';

      injectReplyButton('thread_1', 'Reply');

      expect(document.querySelectorAll('[data-reply-thread]').length).toBe(0);
    });

    it('should do nothing if thread element not found', () => {
      document.body.innerHTML = '<div id="msg-conversations-container"></div>';

      injectReplyButton('nonexistent_thread', 'Reply');

      const containers = document.querySelectorAll('[data-reply-thread]');
      expect(containers.length).toBe(0);
    });

    it('should remove reply container when Send is clicked', () => {
      document.body.innerHTML = `
        <div id="msg-conversations-container">
          <div class="msg-s-message-group" data-thread-id="thread_1">
            <div class="msg-s-event-listitem__body"><p>Opportunity</p></div>
          </div>
        </div>
      `;

      injectReplyButton('thread_1', 'Reply text');

      const sendBtn = document.querySelector('.lrp-send-btn') as HTMLButtonElement;
      sendBtn.click();

      expect(document.querySelector('[data-reply-thread="thread_1"]')).toBeNull();
    });

    it('should remove reply container when Dismiss is clicked', () => {
      document.body.innerHTML = `
        <div id="msg-conversations-container">
          <div class="msg-s-message-group" data-thread-id="thread_1">
            <div class="msg-s-event-listitem__body"><p>Opportunity</p></div>
          </div>
        </div>
      `;

      injectReplyButton('thread_1', 'Reply text');

      const dismissBtn = document.querySelector('.lrp-dismiss-btn') as HTMLButtonElement;
      dismissBtn.click();

      expect(document.querySelector('[data-reply-thread="thread_1"]')).toBeNull();
    });
  });

  describe('sendReply', () => {
    it('should focus the input element before typing', () => {
      document.body.innerHTML = `
        <div class="msg-form__contenteditable" contenteditable="true" data-thread-id="thread_1"></div>
      `;

      const input = document.querySelector('.msg-form__contenteditable') as HTMLElement;
      const focusSpy = vi.spyOn(input, 'focus');

      sendReply('thread_1', 'My reply text');

      expect(focusSpy).toHaveBeenCalled();
    });

    it('should set textContent and dispatch InputEvent for React compatibility', () => {
      document.body.innerHTML = `
        <div class="msg-form__contenteditable" contenteditable="true" data-thread-id="thread_1">old text</div>
      `;

      const input = document.querySelector('.msg-form__contenteditable') as HTMLElement;
      const dispatchSpy = vi.spyOn(input, 'dispatchEvent');

      sendReply('thread_1', 'My reply text');

      expect(input.textContent).toBe('My reply text');
      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'input',
          bubbles: true,
          inputType: 'insertText',
          data: 'My reply text',
        })
      );
    });

    it('should position cursor at end of inserted text', () => {
      document.body.innerHTML = `
        <div class="msg-form__contenteditable" contenteditable="true" data-thread-id="thread_1"></div>
      `;

      sendReply('thread_1', 'My reply text');

      const mockSelection = window.getSelection();
      expect(mockSelection!.removeAllRanges).toHaveBeenCalled();
      expect(mockSelection!.addRange).toHaveBeenCalled();
      expect(document.createRange).toHaveBeenCalled();
    });

    it('should handle missing input element gracefully', () => {
      document.body.innerHTML = '';

      expect(() => sendReply('thread_1', 'text')).not.toThrow();
    });
  });

  describe('handleReplyMessage', () => {
    it('should inject reply when receiving NEW_REPLY_AVAILABLE message', () => {
      document.body.innerHTML = `
        <div id="msg-conversations-container">
          <div class="msg-s-message-group" data-thread-id="thread_1">
            <div class="msg-s-event-listitem__body"><p>Opportunity</p></div>
          </div>
        </div>
      `;

      handleReplyMessage({
        type: 'NEW_REPLY_AVAILABLE',
        threadId: 'thread_1',
        messageId: 'msg_1',
        draftedReply: 'Auto-drafted reply',
      });

      const replyContainer = document.querySelector('[data-reply-thread="thread_1"]');
      expect(replyContainer).not.toBeNull();
      expect(replyContainer!.querySelector('.lrp-reply-text')!.textContent).toBe('Auto-drafted reply');
    });

    it('should do nothing when draftedReply is missing', () => {
      document.body.innerHTML = `
        <div id="msg-conversations-container">
          <div class="msg-s-message-group" data-thread-id="thread_1">
            <div class="msg-s-event-listitem__body"><p>Opportunity</p></div>
          </div>
        </div>
      `;

      handleReplyMessage({
        type: 'NEW_REPLY_AVAILABLE',
        threadId: 'thread_1',
        messageId: 'msg_1',
      });

      expect(document.querySelector('[data-reply-thread]')).toBeNull();
    });

    it('should ignore non-reply messages', () => {
      document.body.innerHTML = `
        <div id="msg-conversations-container">
          <div class="msg-s-message-group" data-thread-id="thread_1">
            <div class="msg-s-event-listitem__body"><p>Opportunity</p></div>
          </div>
        </div>
      `;

      handleReplyMessage({
        type: 'SOME_OTHER_MESSAGE',
        threadId: 'thread_1',
      });

      const replyContainer = document.querySelector('[data-reply-thread]');
      expect(replyContainer).toBeNull();
    });
  });
});
