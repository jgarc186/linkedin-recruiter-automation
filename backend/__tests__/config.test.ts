import { describe, it, expect } from 'vitest';
import { config, validateConfig } from '../src/config.js';

describe('config.ts', () => {
  it('should have default port 8000', () => {
    expect(config.port).toBe(8000);
  });

  it('should have default host 127.0.0.1', () => {
    expect(config.host).toBe('127.0.0.1');
  });

  it('should have telegramBotToken', () => {
    expect(typeof config.telegramBotToken).toBe('string');
  });

  it('should have telegramUserId', () => {
    expect(typeof config.telegramUserId).toBe('string');
  });

  it('should have apiKey', () => {
    expect(typeof config.apiKey).toBe('string');
  });

  it('should have databasePath default to :memory:', () => {
    expect(config.databasePath).toBe(':memory:');
  });

  it('should have googleClientId', () => {
    expect(typeof config.googleClientId).toBe('string');
  });

  it('should have googleClientSecret', () => {
    expect(typeof config.googleClientSecret).toBe('string');
  });

  it('should have googleRefreshToken', () => {
    expect(typeof config.googleRefreshToken).toBe('string');
  });

  it('should export validateConfig function', () => {
    expect(typeof validateConfig).toBe('function');
  });
});
