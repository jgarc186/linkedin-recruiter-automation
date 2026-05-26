import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { config, validateConfig } from '../src/config.js';

describe('config.ts', () => {
  describe('default values', () => {
    // config reads process.env at module load time. We reset the module with
    // env vars cleared so we can observe the fallback defaults.
    const VARS_TO_CLEAR = [
      'TELEGRAM_BOT_TOKEN',
      'TELEGRAM_USER_ID',
      'EXTENSION_API_KEY',
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'GOOGLE_REFRESH_TOKEN',
      'TELEGRAM_WEBHOOK_SECRET',
      'EXTENSION_ID',
    ];

    let defaultConfig: typeof config;
    const saved: Record<string, string | undefined> = {};

    beforeAll(async () => {
      for (const name of VARS_TO_CLEAR) {
        saved[name] = process.env[name];
        delete process.env[name];
      }
      vi.resetModules();
      defaultConfig = (await import('../src/config.js')).config;
    });

    afterAll(() => {
      for (const name of VARS_TO_CLEAR) {
        if (saved[name] !== undefined) process.env[name] = saved[name];
        else delete process.env[name];
      }
      vi.resetModules();
    });

    it('should have default port 8000', () => {
      expect(defaultConfig.port).toBe(8000);
    });

    it('should have default host 127.0.0.1', () => {
      expect(defaultConfig.host).toBe('127.0.0.1');
    });

    it('should default telegramBotToken to empty string', () => {
      expect(defaultConfig.telegramBotToken).toBe('');
    });

    it('should default telegramUserId to empty string', () => {
      expect(defaultConfig.telegramUserId).toBe('');
    });

    it('should default apiKey to empty string', () => {
      expect(defaultConfig.apiKey).toBe('');
    });

    it('should default databasePath to :memory:', () => {
      expect(defaultConfig.databasePath).toBe(':memory:');
    });

    it('should default googleClientId to empty string', () => {
      expect(defaultConfig.googleClientId).toBe('');
    });

    it('should default googleClientSecret to empty string', () => {
      expect(defaultConfig.googleClientSecret).toBe('');
    });

    it('should default googleRefreshToken to empty string', () => {
      expect(defaultConfig.googleRefreshToken).toBe('');
    });

    it('should default telegramWebhookSecret to empty string', () => {
      expect(defaultConfig.telegramWebhookSecret).toBe('');
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
  });
});
