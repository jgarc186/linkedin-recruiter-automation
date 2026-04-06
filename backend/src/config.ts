import 'dotenv/config';

export const config = {
  port: parseInt(process.env.PORT || '8000', 10),
  host: process.env.HOST || '127.0.0.1',
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramUserId: process.env.TELEGRAM_USER_ID || '',
  apiKey: process.env.EXTENSION_API_KEY || '',
  databasePath: process.env.DATABASE_PATH || ':memory:',
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  googleRefreshToken: process.env.GOOGLE_REFRESH_TOKEN || '',
  telegramWebhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || '',
  extensionId: process.env.EXTENSION_ID || '',
} as const;

export function validateConfig(): void {
  if (!config.apiKey) {
    throw new Error('EXTENSION_API_KEY must be set and non-empty');
  }
  if (!config.telegramBotToken) {
    throw new Error('TELEGRAM_BOT_TOKEN must be set and non-empty');
  }
  if (!config.telegramUserId) {
    throw new Error('TELEGRAM_USER_ID must be set and non-empty');
  }
  if (!config.telegramWebhookSecret) {
    throw new Error('TELEGRAM_WEBHOOK_SECRET must be set and non-empty');
  }
  if (!config.extensionId) {
    throw new Error('EXTENSION_ID must be set and non-empty');
  }
}
