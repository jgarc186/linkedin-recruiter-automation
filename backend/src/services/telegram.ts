import TelegramBot from 'node-telegram-bot-api';
import type { MessageData, TelegramCallbackData } from '../../../shared/types.js';

let bot: TelegramBot | null = null;

function getBot(): TelegramBot {
  /* v8 ignore start — tests always pre-seed bot via __testSetMockBot */
  if (!bot) {
    const token = process.env.TELEGRAM_BOT_TOKEN || '';
    if (!token) {
      throw new Error('TELEGRAM_BOT_TOKEN is not configured');
    }
    bot = new TelegramBot(token, { polling: false });
  }
  /* v8 ignore end */
  return bot;
}

// For testing only
export function __testSetMockBot(mockBot: TelegramBot): void {
  /* v8 ignore start — guard only fires outside test env, never in vitest */
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('__testSetMockBot is only available in test environment');
  }
  /* v8 ignore end */
  bot = mockBot as TelegramBot;
}

function escapeTelegramMarkdownV2(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

// Short action codes for Telegram's 64-byte callback_data limit
const ACTION_CODES: Record<string, string> = {
  ni: 'not_interested',
  tm: 'tell_me_more',
  lt: 'lets_talk',
};

export const createInlineKeyboard = (messageId: string) => {
  return [
    [
      {
        text: '❌ Not interested',
        callback_data: JSON.stringify({ m: messageId, a: 'ni' }),
      },
      {
        text: '🤔 Tell me more',
        callback_data: JSON.stringify({ m: messageId, a: 'tm' }),
      },
      {
        text: '✅ Let\'s talk',
        callback_data: JSON.stringify({ m: messageId, a: 'lt' }),
      },
    ],
  ];
};

export async function sendApprovalRequest(
  messageData: MessageData,
  userId: string
): Promise<void> {
  const { sender, content } = messageData;
  const truncatedContent = content.length > 500 ? `${content.substring(0, 500)}...` : content;

  const text = `
📬 *New Recruiter Message*

*From:* ${escapeTelegramMarkdownV2(sender.name)}
*Title:* ${escapeTelegramMarkdownV2(sender.title)}
*Company:* ${escapeTelegramMarkdownV2(sender.company)}

*Message:*
${escapeTelegramMarkdownV2(truncatedContent)}

_Reply with an option below:_
  `.trim();

  await getBot().sendMessage(userId, text, {
    parse_mode: 'MarkdownV2',
    reply_markup: {
      inline_keyboard: createInlineKeyboard(messageData.message_id),
    },
  });
}

export async function handleCallbackQuery(
  query: TelegramBot.CallbackQuery
): Promise<TelegramCallbackData> {
  // Answer the callback query (removes loading spinner)
  await getBot().answerCallbackQuery(query.id);

  if (!query.data) {
    throw new Error('No callback data');
  }

  try {
    const raw = JSON.parse(query.data);
    const callbackData: TelegramCallbackData = {
      message_id: raw.m || raw.message_id,
      action: (ACTION_CODES[raw.a] || raw.action || raw.a) as TelegramCallbackData['action'],
    };

    // Keep original message formatting intact and send a separate confirmation.
    if (query.message?.chat?.id != null && query.message?.message_id != null) {
      const choiceEmoji = {
        not_interested: '❌',
        tell_me_more: '🤔',
        lets_talk: '✅',
      }[callbackData.action];

      const selectedAction = escapeTelegramMarkdownV2(callbackData.action.replace(/_/g, ' '));

      await getBot().sendMessage(
        query.message.chat.id,
        `${choiceEmoji} *You selected:* ${selectedAction}`,
        { parse_mode: 'MarkdownV2' }
      );

      await getBot().editMessageReplyMarkup(
        { inline_keyboard: [] },
        {
          chat_id: query.message.chat.id,
          message_id: query.message.message_id,
        }
      );
    }

    return callbackData;
  } catch (error) {
    throw new Error('Invalid callback data format');
  }
}
