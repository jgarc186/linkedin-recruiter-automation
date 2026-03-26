import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  loadSettings,
  saveSettings,
  initOptions,
  DEFAULT_SETTINGS,
} from '../src/options';
import type { ExtensionSettings } from '../src/options';

describe('options.ts', () => {
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
      const stored: ExtensionSettings = {
        webhookUrl: 'http://custom:9000',
        apiKey: 'my-key',
        criteria: {
          minSeniority: 'staff',
          preferredTechStack: ['Rust'],
          avoidKeywords: ['PHP'],
          locations: ['Remote'],
          minCompensation: 250000,
        },
      };

      (global as any).chrome = {
        storage: {
          local: {
            get: vi.fn().mockResolvedValueOnce({ settings: stored }),
          },
        },
      };

      const settings = await loadSettings();
      expect(settings.webhookUrl).toBe('http://custom:9000');
      expect(settings.apiKey).toBe('my-key');
      expect(settings.criteria.minCompensation).toBe(250000);
    });

    it('should return defaults when no settings stored', async () => {
      (global as any).chrome = {
        storage: {
          local: {
            get: vi.fn().mockResolvedValueOnce({}),
          },
        },
      };

      const settings = await loadSettings();
      expect(settings).toEqual(DEFAULT_SETTINGS);
    });

    it('should return defaults on storage error', async () => {
      (global as any).chrome = {
        storage: {
          local: {
            get: vi.fn().mockRejectedValueOnce(new Error('fail')),
          },
        },
      };

      const settings = await loadSettings();
      expect(settings).toEqual(DEFAULT_SETTINGS);
    });
  });

  describe('saveSettings', () => {
    it('should save settings to chrome storage', async () => {
      const mockSet = vi.fn().mockResolvedValueOnce(undefined);
      (global as any).chrome = {
        storage: { local: { set: mockSet } },
      };

      const settings: ExtensionSettings = {
        ...DEFAULT_SETTINGS,
        apiKey: 'new-key',
      };

      await saveSettings(settings);

      expect(mockSet).toHaveBeenCalledWith({ settings });
    });

    it('should throw on storage error', async () => {
      (global as any).chrome = {
        storage: {
          local: {
            set: vi.fn().mockRejectedValueOnce(new Error('Storage full')),
          },
        },
      };

      await expect(saveSettings(DEFAULT_SETTINGS)).rejects.toThrow('Storage full');
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

      (global as any).chrome = {
        storage: {
          local: {
            get: vi.fn().mockResolvedValueOnce({ settings: stored }),
            set: vi.fn().mockResolvedValueOnce(undefined),
          },
        },
      };

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

      const mockSet = vi.fn().mockResolvedValue(undefined);
      (global as any).chrome = {
        storage: {
          local: {
            get: vi.fn().mockResolvedValueOnce({}),
            set: mockSet,
          },
        },
      };

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
        expect(mockSet).toHaveBeenCalledWith({
          settings: expect.objectContaining({
            webhookUrl: 'http://new:3000',
            apiKey: 'new-key',
          }),
        });
      });
    });

    it('should show save confirmation', async () => {
      setupOptionsDOM();

      const mockSet = vi.fn().mockResolvedValue(undefined);
      (global as any).chrome = {
        storage: {
          local: {
            get: vi.fn().mockResolvedValueOnce({}),
            set: mockSet,
          },
        },
      };

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
