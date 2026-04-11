import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  loadSettings,
  saveSettings,
  initOptions,
  DEFAULT_SETTINGS,
} from '../src/options';
import type { ExtensionSettings } from '../src/options';

describe('options.ts', () => {
  function setupChromeStorageMocks(overrides?: {
    localGet?: ReturnType<typeof vi.fn>;
    localSet?: ReturnType<typeof vi.fn>;
    sessionGet?: ReturnType<typeof vi.fn>;
    sessionSet?: ReturnType<typeof vi.fn>;
  }) {
    const localGet = overrides?.localGet ?? vi.fn().mockResolvedValue({});
    const localSet = overrides?.localSet ?? vi.fn().mockResolvedValue(undefined);
    const sessionGet = overrides?.sessionGet ?? vi.fn().mockResolvedValue({});
    const sessionSet = overrides?.sessionSet ?? vi.fn().mockResolvedValue(undefined);

    (global as any).chrome = {
      storage: {
        local: { get: localGet, set: localSet },
        session: { get: sessionGet, set: sessionSet },
      },
    };

    return { localGet, localSet, sessionGet, sessionSet };
  }

  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('DEFAULT_SETTINGS', () => {
    it('should have sensible defaults', () => {
      expect(DEFAULT_SETTINGS.webhookUrl).toBe('http://localhost:8000');
      expect(DEFAULT_SETTINGS.apiKey).toBe('');
      expect(DEFAULT_SETTINGS.criteria.minSeniority).toBe('senior');
      expect(DEFAULT_SETTINGS.criteria.preferredTechStack).toContain('Go');
      expect(DEFAULT_SETTINGS.criteria.preferredTechStack).toContain('Rust');
      expect(DEFAULT_SETTINGS.criteria.avoidKeywords).toContain('PHP');
      expect(DEFAULT_SETTINGS.criteria.locations).toContain('Remote');
      expect(DEFAULT_SETTINGS.criteria.minCompensation).toBe(200000);
    });
  });

  describe('loadSettings', () => {
    it('should load settings from chrome storage', async () => {
      const stored: Omit<ExtensionSettings, 'apiKey'> = {
        webhookUrl: 'http://custom:9000',
        criteria: {
          minSeniority: 'staff',
          preferredTechStack: ['Rust'],
          avoidKeywords: ['PHP'],
          locations: ['Remote'],
          minCompensation: 250000,
        },
      };

      setupChromeStorageMocks({
        localGet: vi.fn().mockResolvedValueOnce({ settings: stored }),
        sessionGet: vi.fn().mockResolvedValueOnce({ apiKey: 'my-key' }),
      });

      const settings = await loadSettings();
      expect(settings.webhookUrl).toBe('http://custom:9000');
      expect(settings.apiKey).toBe('my-key');
      expect(settings.criteria.minCompensation).toBe(250000);
    });

    it('should return defaults when no settings stored', async () => {
      setupChromeStorageMocks({
        localGet: vi.fn().mockResolvedValueOnce({}),
        sessionGet: vi.fn().mockResolvedValueOnce({}),
      });

      const settings = await loadSettings();
      expect(settings).toEqual(DEFAULT_SETTINGS);
    });

    it('should migrate legacy apiKey from local to session storage', async () => {
      const localSet = vi.fn().mockResolvedValue(undefined);
      const sessionSet = vi.fn().mockResolvedValue(undefined);
      setupChromeStorageMocks({
        localGet: vi.fn().mockResolvedValueOnce({
          settings: {
            webhookUrl: 'http://custom:9000',
            apiKey: 'legacy-key',
            criteria: DEFAULT_SETTINGS.criteria,
          },
        }),
        localSet,
        sessionGet: vi.fn().mockResolvedValueOnce({}),
        sessionSet,
      });

      const settings = await loadSettings();

      expect(settings.apiKey).toBe('legacy-key');
      expect(sessionSet).toHaveBeenCalledWith({ apiKey: 'legacy-key' });
      expect(localSet).toHaveBeenCalledWith({
        settings: {
          webhookUrl: 'http://custom:9000',
          criteria: DEFAULT_SETTINGS.criteria,
        },
      });
    });

    it('should return defaults on storage error', async () => {
      setupChromeStorageMocks({
        localGet: vi.fn().mockRejectedValueOnce(new Error('fail')),
      });

      const settings = await loadSettings();
      expect(settings).toEqual(DEFAULT_SETTINGS);
    });
  });

  describe('saveSettings', () => {
    it('should save settings to chrome storage', async () => {
      const localSet = vi.fn().mockResolvedValueOnce(undefined);
      const sessionSet = vi.fn().mockResolvedValueOnce(undefined);
      setupChromeStorageMocks({
        localSet,
        sessionSet,
      });

      const settings: ExtensionSettings = {
        ...DEFAULT_SETTINGS,
        apiKey: 'new-key',
      };

      await saveSettings(settings);

      expect(localSet).toHaveBeenCalledWith({
        settings: {
          webhookUrl: settings.webhookUrl,
          criteria: settings.criteria,
        },
      });
      expect(sessionSet).toHaveBeenCalledWith({ apiKey: settings.apiKey });
    });

    it('should throw on storage error', async () => {
      setupChromeStorageMocks({
        localSet: vi.fn().mockRejectedValueOnce(new Error('Storage full')),
      });

      await expect(saveSettings(DEFAULT_SETTINGS)).rejects.toThrow('Storage full');
    });

    it('should rollback local settings when session write fails', async () => {
      const previousLocal = {
        webhookUrl: 'http://old:8000',
        criteria: DEFAULT_SETTINGS.criteria,
      };
      const previousApiKey = 'old-key';
      const localSet = vi.fn().mockResolvedValue(undefined);
      const sessionSet = vi.fn()
        .mockRejectedValueOnce(new Error('Session write failed'))
        .mockResolvedValueOnce(undefined);

      setupChromeStorageMocks({
        localGet: vi.fn().mockResolvedValue({ settings: previousLocal }),
        sessionGet: vi.fn().mockResolvedValue({ apiKey: previousApiKey }),
        localSet,
        sessionSet,
      });

      await expect(saveSettings({
        ...DEFAULT_SETTINGS,
        webhookUrl: 'http://new:9000',
        apiKey: 'new-key',
      })).rejects.toThrow('Session write failed');

      expect(localSet).toHaveBeenNthCalledWith(1, {
        settings: {
          webhookUrl: 'http://new:9000',
          criteria: DEFAULT_SETTINGS.criteria,
        },
      });
      expect(localSet).toHaveBeenNthCalledWith(2, {
        settings: previousLocal,
      });
    });
  });

  describe('initOptions', () => {
    function setupOptionsDOM() {
      document.body.innerHTML = `
        <form id="options-form">
          <input id="webhook-url" type="text" />
          <input id="api-key" type="text" />
          <input id="min-seniority" type="text" />
          <input id="preferred-tech" type="text" />
          <input id="avoid-keywords" type="text" />
          <input id="locations" type="text" />
          <input id="min-compensation" type="number" />
          <button type="submit">Save</button>
          <span id="save-status"></span>
        </form>
      `;
    }

    it('should populate form fields from stored settings', async () => {
      setupOptionsDOM();

      const stored: ExtensionSettings = {
        webhookUrl: 'http://myserver:5000',
        apiKey: 'secret-123',
        criteria: {
          minSeniority: 'staff',
          preferredTechStack: ['Go', 'Rust'],
          avoidKeywords: ['PHP', 'WordPress'],
          locations: ['Remote', 'Charlotte, NC'],
          minCompensation: 250000,
        },
      };

      setupChromeStorageMocks({
        localGet: vi.fn().mockResolvedValueOnce({ settings: stored }),
        localSet: vi.fn().mockResolvedValueOnce(undefined),
        sessionGet: vi.fn().mockResolvedValueOnce({ apiKey: 'secret-123' }),
      });

      await initOptions();

      expect((document.getElementById('webhook-url') as HTMLInputElement).value).toBe('http://myserver:5000');
      expect((document.getElementById('api-key') as HTMLInputElement).value).toBe('secret-123');
      expect((document.getElementById('min-seniority') as HTMLInputElement).value).toBe('staff');
      expect((document.getElementById('preferred-tech') as HTMLInputElement).value).toBe('Go, Rust');
      expect((document.getElementById('avoid-keywords') as HTMLInputElement).value).toBe('PHP, WordPress');
      expect((document.getElementById('locations') as HTMLInputElement).value).toBe('Remote, Charlotte, NC');
      expect((document.getElementById('min-compensation') as HTMLInputElement).value).toBe('250000');
    });

    it('should save settings on form submit', async () => {
      setupOptionsDOM();

      const localSet = vi.fn().mockResolvedValue(undefined);
      const sessionSet = vi.fn().mockResolvedValue(undefined);
      setupChromeStorageMocks({
        localGet: vi.fn().mockResolvedValueOnce({}),
        localSet,
        sessionGet: vi.fn().mockResolvedValueOnce({}),
        sessionSet,
      });

      await initOptions();

      // Fill in form values
      (document.getElementById('webhook-url') as HTMLInputElement).value = 'http://new:3000';
      (document.getElementById('api-key') as HTMLInputElement).value = 'new-key';
      (document.getElementById('min-seniority') as HTMLInputElement).value = 'senior';
      (document.getElementById('preferred-tech') as HTMLInputElement).value = 'Go, Rust';
      (document.getElementById('avoid-keywords') as HTMLInputElement).value = 'PHP';
      (document.getElementById('locations') as HTMLInputElement).value = 'Remote';
      (document.getElementById('min-compensation') as HTMLInputElement).value = '200000';

      // Submit form
      const form = document.getElementById('options-form') as HTMLFormElement;
      form.dispatchEvent(new Event('submit'));

      // Wait for async save
      await vi.waitFor(() => {
        expect(localSet).toHaveBeenCalledWith({
          settings: expect.objectContaining({
            webhookUrl: 'http://new:3000',
          }),
        });
        expect(sessionSet).toHaveBeenCalledWith({ apiKey: 'new-key' });
      });
    });

    it('should show save confirmation', async () => {
      setupOptionsDOM();

      const localSet = vi.fn().mockResolvedValue(undefined);
      setupChromeStorageMocks({
        localGet: vi.fn().mockResolvedValueOnce({}),
        localSet,
      });

      await initOptions();

      (document.getElementById('webhook-url') as HTMLInputElement).value = 'http://localhost:8000';
      (document.getElementById('api-key') as HTMLInputElement).value = '';
      (document.getElementById('min-seniority') as HTMLInputElement).value = 'senior';
      (document.getElementById('preferred-tech') as HTMLInputElement).value = 'Go';
      (document.getElementById('avoid-keywords') as HTMLInputElement).value = 'PHP';
      (document.getElementById('locations') as HTMLInputElement).value = 'Remote';
      (document.getElementById('min-compensation') as HTMLInputElement).value = '200000';

      const form = document.getElementById('options-form') as HTMLFormElement;
      form.dispatchEvent(new Event('submit'));

      await vi.waitFor(() => {
        expect(document.getElementById('save-status')!.textContent).toBe('Settings saved!');
      });
    });

    it('should show HTTP warning for non-localhost URLs', async () => {
      setupOptionsDOM();

      const localSet = vi.fn().mockResolvedValue(undefined);
      setupChromeStorageMocks({
        localGet: vi.fn().mockResolvedValueOnce({}),
        localSet,
      });

      await initOptions();

      (document.getElementById('webhook-url') as HTMLInputElement).value = 'http://remote-server.com';
      (document.getElementById('api-key') as HTMLInputElement).value = '';
      (document.getElementById('min-seniority') as HTMLInputElement).value = 'senior';
      (document.getElementById('preferred-tech') as HTMLInputElement).value = 'Go';
      (document.getElementById('avoid-keywords') as HTMLInputElement).value = 'PHP';
      (document.getElementById('locations') as HTMLInputElement).value = 'Remote';
      (document.getElementById('min-compensation') as HTMLInputElement).value = '200000';

      const form = document.getElementById('options-form') as HTMLFormElement;
      form.dispatchEvent(new Event('submit'));

      await vi.waitFor(() => {
        const statusText = document.getElementById('save-status')!.textContent!;
        expect(statusText).toContain('Warning');
        expect(statusText.toLowerCase()).toContain('http');
      });

      // Settings should still be saved despite warning
      expect(localSet).toHaveBeenCalled();
    });

    it('should not show HTTP warning for localhost URLs', async () => {
      setupOptionsDOM();

      setupChromeStorageMocks({
        localGet: vi.fn().mockResolvedValueOnce({}),
      });

      await initOptions();

      (document.getElementById('webhook-url') as HTMLInputElement).value = 'http://localhost:8000';
      (document.getElementById('api-key') as HTMLInputElement).value = '';
      (document.getElementById('min-seniority') as HTMLInputElement).value = 'senior';
      (document.getElementById('preferred-tech') as HTMLInputElement).value = 'Go';
      (document.getElementById('avoid-keywords') as HTMLInputElement).value = 'PHP';
      (document.getElementById('locations') as HTMLInputElement).value = 'Remote';
      (document.getElementById('min-compensation') as HTMLInputElement).value = '200000';

      const form = document.getElementById('options-form') as HTMLFormElement;
      form.dispatchEvent(new Event('submit'));

      await vi.waitFor(() => {
        expect(document.getElementById('save-status')!.textContent).toBe('Settings saved!');
      });
    });
  });
});
