import { describe, it, expect } from 'vitest';
import { config, validateConfig } from '../src/config.js';

describe('config.ts', () => {
  describe('default values', () => {
    // PORT and HOST have CI values that match the defaults (8000 / 127.0.0.1),
    // so these assertions hold in every environment.
    it('should have default port 8000', () => {
      expect(config.port).toBe(8000);
    });

    it('should have default host 127.0.0.1', () => {
      expect(config.host).toBe('127.0.0.1');
    });

    it('should default databasePath to :memory:', () => {
      expect(config.databasePath).toBe(':memory:');
    });

    // Credential fields default to '' when the env var is absent.
    // We verify the shape (string) here; the exact value is env-dependent.
    it('should expose telegramBotToken as a string', () => {
      expect(typeof config.telegramBotToken).toBe('string');
    });

    it('should expose telegramUserId as a string', () => {
      expect(typeof config.telegramUserId).toBe('string');
    });

    it('should expose apiKey as a string', () => {
      expect(typeof config.apiKey).toBe('string');
    });

    it('should expose googleClientId as a string', () => {
      expect(typeof config.googleClientId).toBe('string');
    });

    it('should expose googleClientSecret as a string', () => {
      expect(typeof config.googleClientSecret).toBe('string');
    });

    it('should expose googleRefreshToken as a string', () => {
      expect(typeof config.googleRefreshToken).toBe('string');
    });

    it('should expose telegramWebhookSecret as a string', () => {
      expect(typeof config.telegramWebhookSecret).toBe('string');
    });
  });

  describe('validateConfig', () => {
    it('should be a function', () => {
      expect(typeof validateConfig).toBe('function');
    });

    it('should throw when apiKey is empty', () => {
      const orig = config.apiKey;
      Object.defineProperty(config, 'apiKey', { value: '', configurable: true });

      expect(() => validateConfig()).toThrow('EXTENSION_API_KEY must be set and non-empty');

      Object.defineProperty(config, 'apiKey', { value: orig, configurable: true });
    });

    it('should throw when telegramBotToken is empty', () => {
      const origApiKey = config.apiKey;
      const origToken = config.telegramBotToken;
      Object.defineProperty(config, 'apiKey', { value: 'test', configurable: true });
      Object.defineProperty(config, 'telegramBotToken', { value: '', configurable: true });

      expect(() => validateConfig()).toThrow('TELEGRAM_BOT_TOKEN must be set and non-empty');

      Object.defineProperty(config, 'apiKey', { value: origApiKey, configurable: true });
      Object.defineProperty(config, 'telegramBotToken', { value: origToken, configurable: true });
    });

    it('should throw when telegramUserId is empty', () => {
      const origApiKey = config.apiKey;
      const origToken = config.telegramBotToken;
      const origUserId = config.telegramUserId;
      Object.defineProperty(config, 'apiKey', { value: 'test', configurable: true });
      Object.defineProperty(config, 'telegramBotToken', { value: 'test', configurable: true });
      Object.defineProperty(config, 'telegramUserId', { value: '', configurable: true });

      expect(() => validateConfig()).toThrow('TELEGRAM_USER_ID must be set and non-empty');

      Object.defineProperty(config, 'apiKey', { value: origApiKey, configurable: true });
      Object.defineProperty(config, 'telegramBotToken', { value: origToken, configurable: true });
      Object.defineProperty(config, 'telegramUserId', { value: origUserId, configurable: true });
    });

    it('should throw when telegramWebhookSecret is empty', () => {
      const origApiKey = config.apiKey;
      const origToken = config.telegramBotToken;
      const origUserId = config.telegramUserId;
      const origSecret = config.telegramWebhookSecret;
      Object.defineProperty(config, 'apiKey', { value: 'test', configurable: true });
      Object.defineProperty(config, 'telegramBotToken', { value: 'test', configurable: true });
      Object.defineProperty(config, 'telegramUserId', { value: 'test', configurable: true });
      Object.defineProperty(config, 'telegramWebhookSecret', { value: '', configurable: true });

      expect(() => validateConfig()).toThrow('TELEGRAM_WEBHOOK_SECRET must be set and non-empty');

      Object.defineProperty(config, 'apiKey', { value: origApiKey, configurable: true });
      Object.defineProperty(config, 'telegramBotToken', { value: origToken, configurable: true });
      Object.defineProperty(config, 'telegramUserId', { value: origUserId, configurable: true });
      Object.defineProperty(config, 'telegramWebhookSecret', { value: origSecret, configurable: true });
    });

    it('should throw when extensionId is empty', () => {
      const origApiKey = config.apiKey;
      const origToken = config.telegramBotToken;
      const origUserId = config.telegramUserId;
      const origSecret = config.telegramWebhookSecret;
      const origExtId = config.extensionId;
      Object.defineProperty(config, 'apiKey', { value: 'test', configurable: true });
      Object.defineProperty(config, 'telegramBotToken', { value: 'test', configurable: true });
      Object.defineProperty(config, 'telegramUserId', { value: 'test', configurable: true });
      Object.defineProperty(config, 'telegramWebhookSecret', { value: 'test', configurable: true });
      Object.defineProperty(config, 'extensionId', { value: '', configurable: true });

      expect(() => validateConfig()).toThrow('EXTENSION_ID must be set and non-empty');

      Object.defineProperty(config, 'apiKey', { value: origApiKey, configurable: true });
      Object.defineProperty(config, 'telegramBotToken', { value: origToken, configurable: true });
      Object.defineProperty(config, 'telegramUserId', { value: origUserId, configurable: true });
      Object.defineProperty(config, 'telegramWebhookSecret', { value: origSecret, configurable: true });
      Object.defineProperty(config, 'extensionId', { value: origExtId, configurable: true });
    });

    it('should not throw when all required fields are set', () => {
      const orig = {
        apiKey: config.apiKey,
        telegramBotToken: config.telegramBotToken,
        telegramUserId: config.telegramUserId,
        telegramWebhookSecret: config.telegramWebhookSecret,
        extensionId: config.extensionId,
      };
      Object.defineProperty(config, 'apiKey', { value: 'test', configurable: true });
      Object.defineProperty(config, 'telegramBotToken', { value: 'test', configurable: true });
      Object.defineProperty(config, 'telegramUserId', { value: 'test', configurable: true });
      Object.defineProperty(config, 'telegramWebhookSecret', { value: 'test', configurable: true });
      Object.defineProperty(config, 'extensionId', { value: 'test', configurable: true });

      expect(() => validateConfig()).not.toThrow();

      Object.defineProperty(config, 'apiKey', { value: orig.apiKey, configurable: true });
      Object.defineProperty(config, 'telegramBotToken', { value: orig.telegramBotToken, configurable: true });
      Object.defineProperty(config, 'telegramUserId', { value: orig.telegramUserId, configurable: true });
      Object.defineProperty(config, 'telegramWebhookSecret', { value: orig.telegramWebhookSecret, configurable: true });
      Object.defineProperty(config, 'extensionId', { value: orig.extensionId, configurable: true });
    });
  });
});
