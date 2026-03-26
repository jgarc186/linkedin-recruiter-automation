import TelegramBot from 'node-telegram-bot-api';
import type { MessageData, TelegramCallbackData } from '../../../shared/types.js';

let bot: TelegramBot | null = null;

function getBot(): TelegramBot {
  if (!bot) {
    const token = process.env.TELEGRAM_BOT_TOKEN || '';
    if (!token) {
      throw new Error('TELEGRAM_BOT_TOKEN is not configured');
    }
    bot = new TelegramBot(token, { polling: false });
  }
  return bot;
}

// For testing only
export function __testSetMockBot(mockBot: TelegramBot): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('__testSetMockBot is only available in test environment');
  }
  bot = mockBot as TelegramBot;
}

function escapeMarkdown(text: string): string {
  return text.replace(/([*_`\[\]])/g, '\\$1');
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

  const text = `
📬 *New Recruiter Message*

*From:* ${escapeMarkdown(sender.name)}
*Title:* ${escapeMarkdown(sender.title)}
*Company:* ${escapeMarkdown(sender.company)}

*Message:*
${escapeMarkdown(content.substring(0, 500))}${content.length > 500 ? '...' : ''}

_Reply with an option below:_
  `.trim();

  await getBot().sendMessage(userId, text, {
    parse_mode: 'Markdown',
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

    // Edit the original message to show the user's choice
    if (query.message) {
      const choiceEmoji = {
        not_interested: '❌',
        tell_me_more: '🤔',
        lets_talk: '✅',
      }[callbackData.action];

      await getBot().editMessageText(
        `${query.message.text}\n\n${choiceEmoji} *You selected:* ${callbackData.action.replace(/_/g, ' ')}`,
        {
          chat_id: query.message.chat.id,
          message_id: query.message.message_id,
          parse_mode: 'Markdown',
        }
      );
    }

    return callbackData;
  } catch (error) {
    throw new Error('Invalid callback data format');
  }
}
