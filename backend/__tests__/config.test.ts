import { describe, it, expect, vi } from 'vitest';
import { config, validateConfig } from '../src/config.js';

describe('config.ts', () => {
  describe('default values', () => {
    it('should have default port 8000', () => {
      expect(config.port).toBe(8000);
    });

    it('should have default host 127.0.0.1', () => {
      expect(config.host).toBe('127.0.0.1');
    });

    it('should default telegramBotToken to empty string', () => {
      expect(config.telegramBotToken).toBe('');
    });

    it('should default telegramUserId to empty string', () => {
      expect(config.telegramUserId).toBe('');
    });

    it('should default apiKey to empty string', () => {
      expect(config.apiKey).toBe('');
    });

    it('should default databasePath to :memory:', () => {
      expect(config.databasePath).toBe(':memory:');
    });

    it('should default googleClientId to empty string', () => {
      expect(config.googleClientId).toBe('');
    });

    it('should default googleClientSecret to empty string', () => {
      expect(config.googleClientSecret).toBe('');
    });

    it('should default googleRefreshToken to empty string', () => {
      expect(config.googleRefreshToken).toBe('');
    });

    it('should default telegramWebhookSecret to empty string', () => {
      expect(config.telegramWebhookSecret).toBe('');
    });
  });

  describe('validateConfig', () => {
    it('should be a function', () => {
      expect(typeof validateConfig).toBe('function');
    });

    it('should throw when apiKey is empty', () => {
      // config.apiKey defaults to '' in test env (no env var set)
      expect(() => validateConfig()).toThrow('EXTENSION_API_KEY must be set and non-empty');
    });

    it('should throw when telegramBotToken is empty', () => {
      // Temporarily set apiKey to pass its check
      const original = config.apiKey;
      Object.defineProperty(config, 'apiKey', { value: 'test', configurable: true });

      expect(() => validateConfig()).toThrow('TELEGRAM_BOT_TOKEN must be set and non-empty');

      Object.defineProperty(config, 'apiKey', { value: original, configurable: true });
    });

    it('should throw when telegramUserId is empty', () => {
      const origApiKey = config.apiKey;
      const origToken = config.telegramBotToken;
      Object.defineProperty(config, 'apiKey', { value: 'test', configurable: true });
      Object.defineProperty(config, 'telegramBotToken', { value: 'test', configurable: true });

      expect(() => validateConfig()).toThrow('TELEGRAM_USER_ID must be set and non-empty');

      Object.defineProperty(config, 'apiKey', { value: origApiKey, configurable: true });
      Object.defineProperty(config, 'telegramBotToken', { value: origToken, configurable: true });
    });

    it('should throw when telegramWebhookSecret is empty', () => {
      const origApiKey = config.apiKey;
      const origToken = config.telegramBotToken;
      const origUserId = config.telegramUserId;
      Object.defineProperty(config, 'apiKey', { value: 'test', configurable: true });
      Object.defineProperty(config, 'telegramBotToken', { value: 'test', configurable: true });
      Object.defineProperty(config, 'telegramUserId', { value: 'test', configurable: true });

      expect(() => validateConfig()).toThrow('TELEGRAM_WEBHOOK_SECRET must be set and non-empty');

      Object.defineProperty(config, 'apiKey', { value: origApiKey, configurable: true });
      Object.defineProperty(config, 'telegramBotToken', { value: origToken, configurable: true });
      Object.defineProperty(config, 'telegramUserId', { value: origUserId, configurable: true });
    });
  });
});
