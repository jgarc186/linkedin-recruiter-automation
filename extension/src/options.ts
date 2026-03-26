export interface UserCriteria {
  minSeniority: string;
  preferredTechStack: string[];
  avoidKeywords: string[];
  locations: string[];
  minCompensation: number;
}

export interface ExtensionSettings {
  webhookUrl: string;
  apiKey: string;
  criteria: UserCriteria;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  webhookUrl: 'http://localhost:8000',
  apiKey: '',
  criteria: {
    minSeniority: 'senior',
    preferredTechStack: ['Go', 'Rust', 'Distributed Systems', 'Backend'],
    avoidKeywords: ['PHP', 'WordPress', 'Staff Augmentation', 'Frontend-only'],
    locations: ['Remote', 'Charlotte, NC'],
    minCompensation: 200000,
  },
};

export async function loadSettings(): Promise<ExtensionSettings> {
  try {
    const data = await chrome.storage.local.get('settings');
    return data.settings || DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: ExtensionSettings): Promise<void> {
  await chrome.storage.local.set({ settings });
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
    if (saveStatusEl) saveStatusEl.textContent = 'Settings saved!';
  });
}
