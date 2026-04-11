import type { UserCriteria } from '../../shared/types';

export const SETTINGS_KEY = 'settings';
export const API_KEY_KEY = 'apiKey';
export const DEFAULT_WEBHOOK_URL = 'http://localhost:8000';

interface RawSettings {
  webhookUrl?: string;
  apiKey?: string;
  criteria?: UserCriteria;
}

export interface StorageConfig {
  webhookUrl: string;
  apiKey: string;
  criteria?: UserCriteria;
}

function toLocalSettings(webhookUrl: string, criteria?: UserCriteria): { webhookUrl: string; criteria?: UserCriteria } {
  return {
    webhookUrl,
    ...(criteria ? { criteria } : {}),
  };
}

export async function loadStorageConfig(): Promise<StorageConfig> {
  const [localData, sessionData] = await Promise.all([
    chrome.storage.local.get(SETTINGS_KEY),
    chrome.storage.session.get(API_KEY_KEY),
  ]);

  const settings: RawSettings = localData[SETTINGS_KEY] || {};
  const webhookUrl = settings.webhookUrl || DEFAULT_WEBHOOK_URL;
  const sessionApiKey = sessionData[API_KEY_KEY];
  const legacyApiKey = settings.apiKey;
  const apiKey = sessionApiKey || legacyApiKey || '';
  const criteria = settings.criteria;

  // Backward-compatible migration from insecure local settings.apiKey to session storage.
  if (!sessionApiKey && legacyApiKey) {
    await Promise.all([
      chrome.storage.session.set({ [API_KEY_KEY]: legacyApiKey }),
      chrome.storage.local.set({
        [SETTINGS_KEY]: toLocalSettings(webhookUrl, criteria),
      }),
    ]);
  }

  return {
    webhookUrl,
    apiKey,
    criteria,
  };
}

export async function saveStorageConfig(config: StorageConfig): Promise<void> {
  const [prevLocal, prevSession] = await Promise.all([
    chrome.storage.local.get(SETTINGS_KEY),
    chrome.storage.session.get(API_KEY_KEY),
  ]);

  const previousLocalSettings = prevLocal?.[SETTINGS_KEY];
  const previousApiKey = prevSession?.[API_KEY_KEY];

  const nextLocalSettings = toLocalSettings(config.webhookUrl, config.criteria);
  const nextSessionApiKey = config.apiKey;

  let wroteLocal = false;
  let wroteSession = false;

  try {
    await chrome.storage.local.set({ [SETTINGS_KEY]: nextLocalSettings });
    wroteLocal = true;

    await chrome.storage.session.set({ [API_KEY_KEY]: nextSessionApiKey });
    wroteSession = true;
  } catch (error) {
    const rollbackOps: Promise<unknown>[] = [];
    if (wroteLocal) {
      rollbackOps.push(chrome.storage.local.set({ [SETTINGS_KEY]: previousLocalSettings }));
    }
    if (wroteSession) {
      rollbackOps.push(chrome.storage.session.set({ [API_KEY_KEY]: previousApiKey }));
    }

    if (rollbackOps.length > 0) {
      await Promise.allSettled(rollbackOps);
    }
    throw error;
  }
}
