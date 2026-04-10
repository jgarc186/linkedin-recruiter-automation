import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  sendApprovalRequest,
  handleCallbackQuery,
  createInlineKeyboard,
  __testSetMockBot,
} from '../src/services/telegram.js';
import type { MessageData } from '../../../shared/types.js';

describe('telegram.ts', () => {
  let mockBot: any;
  const mockUserId = '123456789';

  beforeEach(() => {
    vi.clearAllMocks();
    mockBot = {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 999 }),
      answerCallbackQuery: vi.fn().mockResolvedValue(true),
      editMessageText: vi.fn().mockResolvedValue({ message_id: 999 }),
    };
    __testSetMockBot(mockBot);
  });

  describe('createInlineKeyboard', () => {
    it('should create keyboard with 3 options', () => {
      const messageId = 'msg_123';
      const keyboard = createInlineKeyboard(messageId);

      expect(keyboard).toHaveLength(1);
      expect(keyboard[0]).toHaveLength(3);
      expect(keyboard[0][0].text).toContain('❌');
      expect(keyboard[0][1].text).toContain('🤔');
      expect(keyboard[0][2].text).toContain('✅');
    });

    it('should include message_id in callback data', () => {
      const messageId = 'msg_123';
      const keyboard = createInlineKeyboard(messageId);

      const callbackData = JSON.parse(keyboard[0][0].callback_data);
      expect(callbackData.m).toBe(messageId);
    });

    it('should keep callback_data under 64 bytes', () => {
      const longId = 'msg_thread_12345_1711468800000';
      const keyboard = createInlineKeyboard(longId);

      keyboard[0].forEach(button => {
        const bytes = Buffer.byteLength(button.callback_data, 'utf8');
        expect(bytes).toBeLessThanOrEqual(64);
      });
    });
  });

  describe('sendApprovalRequest', () => {
    const mockMessage: MessageData = {
      message_id: 'msg_123',
      thread_id: 'thread_456',
      sender: {
        name: 'Jane Smith',
        title: 'Senior Technical Recruiter at TechCorp',
        company: 'TechCorp',
      },
      content: 'We have a Senior Backend Engineer role with Go and Kubernetes',
      timestamp: '2026-03-26T17:00:00Z',
    };

    it('should send message with recruiter info', async () => {
      await sendApprovalRequest(mockMessage, mockUserId);

      expect(mockBot.sendMessage).toHaveBeenCalledWith(
        mockUserId,
        expect.stringContaining('Jane Smith'),
        expect.any(Object)
      );
    });

    it('should include role analysis summary', async () => {
      await sendApprovalRequest(mockMessage, mockUserId);

      const callArgs = mockBot.sendMessage.mock.calls[0];
      expect(callArgs[1]).toContain('Senior Backend Engineer');
    });

    it('should include inline keyboard', async () => {
      await sendApprovalRequest(mockMessage, mockUserId);

      const options = mockBot.sendMessage.mock.calls[0][2];
      expect(options.reply_markup).toBeDefined();
      expect(options.reply_markup.inline_keyboard).toHaveLength(1);
      expect(options.parse_mode).toBe('MarkdownV2');
    });

    it('should throw when sendMessage fails', async () => {
      mockBot.sendMessage.mockRejectedValueOnce(new Error('Telegram API error'));

      await expect(sendApprovalRequest(mockMessage, mockUserId)).rejects.toThrow('Telegram API error');
    });

    it('should truncate long messages to 500 chars', async () => {
      const longMessage: MessageData = {
        ...mockMessage,
        content: 'A'.repeat(600),
      };

      await sendApprovalRequest(longMessage, mockUserId);

      const callArgs = mockBot.sendMessage.mock.calls[0];
      expect(callArgs[1]).toContain('...');
    });

    it('should escape MarkdownV2 special characters in user content', async () => {
      const markdownMessage: MessageData = {
        ...mockMessage,
        sender: {
          name: '_ * [ ] ( ) ~ ` > # + - = | { } . ! \\',
          title: 'Senior _Italic_ Recruiter',
          company: 'Tech[Corp]',
        },
      };

      await sendApprovalRequest(markdownMessage, mockUserId);

      const text = mockBot.sendMessage.mock.calls[0][1];
      const expectedEscapedChars = ['\\_', '\\*', '\\[', '\\]', '\\(', '\\)', '\\~', '\\`', '\\>', '\\#', '\\+', '\\-', '\\=', '\\|', '\\{', '\\}', '\\.', '\\!', '\\\\'];

      expectedEscapedChars.forEach(char => {
        expect(text).toContain(char);
      });

      expect(text).toContain('Senior \\_Italic\\_ Recruiter');
      expect(text).toContain('Tech\\[Corp\\]');
    });
  });

  describe('handleCallbackQuery', () => {
    const mockQuery = {
      id: 'callback_123',
      from: { id: 123456789, first_name: 'Test' },
      message: { chat: { id: 123456789 }, message_id: 999 },
      data: '{"m": "msg_123", "a": "lt"}',
    };

    it('should parse abbreviated callback data correctly', async () => {
      const result = await handleCallbackQuery(mockQuery as any);

      expect(result).toBeDefined();
      expect(result.message_id).toBe('msg_123');
      expect(result.action).toBe('lets_talk');
    });

    it('should answer callback query', async () => {
      await handleCallbackQuery(mockQuery as any);

      expect(mockBot.answerCallbackQuery).toHaveBeenCalledWith('callback_123');
    });

    it('should throw when query.data is missing', async () => {
      const noDataQuery = {
        id: 'callback_123',
        from: { id: 123456789, first_name: 'Test' },
        message: { chat: { id: 123456789 }, message_id: 999 },
      };

      await expect(handleCallbackQuery(noDataQuery as any)).rejects.toThrow('No callback data');
    });

    it('should handle invalid JSON', async () => {
      const invalidQuery = { ...mockQuery, data: 'invalid json' };

      await expect(handleCallbackQuery(invalidQuery as any)).rejects.toThrow('Invalid callback data format');
    });

    it('should handle callback without message (no confirmation)', async () => {
      const queryNoMessage = {
        id: 'callback_456',
        from: { id: 123456789, first_name: 'Test' },
        data: '{"m": "msg_123", "a": "ni"}',
      };

      const result = await handleCallbackQuery(queryNoMessage as any);
      expect(result.message_id).toBe('msg_123');
      expect(result.action).toBe('not_interested');
      expect(mockBot.editMessageText).not.toHaveBeenCalled();
      expect(mockBot.sendMessage).not.toHaveBeenCalled();
    });

    it('should send a separate confirmation message in MarkdownV2', async () => {
      await handleCallbackQuery(mockQuery as any);

      expect(mockBot.editMessageText).not.toHaveBeenCalled();
      expect(mockBot.sendMessage).toHaveBeenCalledWith(
        '123456789',
        expect.stringContaining('*You selected:*'),
        { parse_mode: 'MarkdownV2' }
      );
    });

    it('should replace all underscores in action display text', async () => {
      const tellMoreQuery = {
        ...mockQuery,
        data: '{"m": "msg_123", "a": "tm"}',
        message: { chat: { id: 123456789 }, message_id: 999, text: 'Original message' },
      };

      await handleCallbackQuery(tellMoreQuery as any);

      const sendCallArgs = mockBot.sendMessage.mock.calls[0];
      expect(sendCallArgs[1]).toContain('tell me more');
      expect(sendCallArgs[1]).not.toContain('tell_me_more');
    });

    it('should allow message_id = 0 with non-null checks', async () => {
      const zeroMessageIdQuery = {
        ...mockQuery,
        message: { chat: { id: 123456789 }, message_id: 0, text: 'Original message' },
      };

      await handleCallbackQuery(zeroMessageIdQuery as any);

      expect(mockBot.sendMessage).toHaveBeenCalled();
    });
  });
});
