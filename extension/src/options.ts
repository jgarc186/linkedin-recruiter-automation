import type { UserCriteria } from '../../shared/types';
import { DEFAULT_CRITERIA } from '../../shared/types';

export type { UserCriteria };

export interface ExtensionSettings {
  webhookUrl: string;
  apiKey: string;
  criteria: UserCriteria;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  webhookUrl: 'http://localhost:8000',
  apiKey: '',
  criteria: DEFAULT_CRITERIA,
};

const SETTINGS_KEY = 'settings';
const API_KEY_KEY = 'apiKey';

export async function loadSettings(): Promise<ExtensionSettings> {
  try {
    const [localData, sessionData] = await Promise.all([
      chrome.storage.local.get(SETTINGS_KEY),
      chrome.storage.session.get(API_KEY_KEY),
    ]);

    const storedSettings = localData[SETTINGS_KEY] || {};
    const webhookUrl = storedSettings.webhookUrl || DEFAULT_SETTINGS.webhookUrl;
    const criteria = storedSettings.criteria || DEFAULT_SETTINGS.criteria;

    const sessionApiKey = sessionData[API_KEY_KEY];
    const legacyApiKey = storedSettings.apiKey;
    const apiKey = sessionApiKey || legacyApiKey || DEFAULT_SETTINGS.apiKey;

    // Backward-compatible migration from insecure local settings.apiKey to session storage.
    if (!sessionApiKey && legacyApiKey) {
      await Promise.all([
        chrome.storage.session.set({ [API_KEY_KEY]: legacyApiKey }),
        chrome.storage.local.set({
          [SETTINGS_KEY]: {
            webhookUrl,
            criteria,
          },
        }),
      ]);
    }

    return {
      webhookUrl,
      apiKey,
      criteria,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: ExtensionSettings): Promise<void> {
  await Promise.all([
    chrome.storage.local.set({
      [SETTINGS_KEY]: {
        webhookUrl: settings.webhookUrl,
        criteria: settings.criteria,
      },
    }),
    chrome.storage.session.set({ [API_KEY_KEY]: settings.apiKey }),
  ]);
}

function parseCommaSeparated(value: string): string[] {
  return value.split(',').map(s => s.trim()).filter(Boolean);
}

function isValidWebhookUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export async function initOptions(): Promise<void> {
  const settings = await loadSettings();

  const webhookUrlInput = document.getElementById('webhook-url') as HTMLInputElement | null;
  const apiKeyInput = document.getElementById('api-key') as HTMLInputElement | null;
  const minSeniorityInput = document.getElementById('min-seniority') as HTMLInputElement | null;
  const preferredTechInput = document.getElementById('preferred-tech') as HTMLInputElement | null;
  const avoidKeywordsInput = document.getElementById('avoid-keywords') as HTMLInputElement | null;
  const locationsInput = document.getElementById('locations') as HTMLInputElement | null;
  const minCompensationInput = document.getElementById('min-compensation') as HTMLInputElement | null;
  const saveStatusEl = document.getElementById('save-status');

  if (!webhookUrlInput || !apiKeyInput || !minSeniorityInput || !preferredTechInput ||
      !avoidKeywordsInput || !locationsInput || !minCompensationInput) {
    console.error('Options form elements not found');
    return;
  }

  // Populate form
  webhookUrlInput.value = settings.webhookUrl;
  apiKeyInput.value = settings.apiKey;
  minSeniorityInput.value = settings.criteria.minSeniority;
  preferredTechInput.value = settings.criteria.preferredTechStack.join(', ');
  avoidKeywordsInput.value = settings.criteria.avoidKeywords.join(', ');
  locationsInput.value = settings.criteria.locations.join(', ');
  minCompensationInput.value = String(settings.criteria.minCompensation);

  // Handle form submit
  const form = document.getElementById('options-form') as HTMLFormElement;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const webhookUrl = webhookUrlInput.value.trim();
    if (webhookUrl && !isValidWebhookUrl(webhookUrl)) {
      if (saveStatusEl) saveStatusEl.textContent = 'Invalid webhook URL. Must use http: or https:';
      return;
    }

    const compensation = Number(minCompensationInput.value);
    if (isNaN(compensation) || compensation < 0) {
      if (saveStatusEl) saveStatusEl.textContent = 'Invalid compensation value.';
      return;
    }

    const newSettings: ExtensionSettings = {
      webhookUrl: webhookUrl || DEFAULT_SETTINGS.webhookUrl,
      apiKey: apiKeyInput.value,
      criteria: {
        minSeniority: minSeniorityInput.value,
        preferredTechStack: parseCommaSeparated(preferredTechInput.value),
        avoidKeywords: parseCommaSeparated(avoidKeywordsInput.value),
        locations: parseCommaSeparated(locationsInput.value),
        minCompensation: compensation,
      },
    };

    await saveSettings(newSettings);

    if (saveStatusEl) {
      const parsed = new URL(newSettings.webhookUrl);
      if (parsed.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(parsed.hostname)) {
        saveStatusEl.textContent = 'Warning: Using HTTP for a non-localhost URL is insecure. Settings saved.';
      } else {
        saveStatusEl.textContent = 'Settings saved!';
      }
    }
  });
}

if (!import.meta.env.VITEST) {
  initOptions();
}
