import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  injectReplyButton,
  detectNewMessages,
  resetProcessedMessages,
} from '../src/content';
import {
  handleWebhookSend,
  getConfig,
  pollPendingReplies,
  processPendingSends,
} from '../src/background';
import type { MessageData } from '../../shared/types';

// ── Chrome / fetch mock helpers ────────────────────────────────────────────

function setupChrome(overrides?: {
  localGet?: ReturnType<typeof vi.fn>;
  localSet?: ReturnType<typeof vi.fn>;
  sessionGet?: ReturnType<typeof vi.fn>;
}) {
  const localGet = overrides?.localGet ?? vi.fn().mockResolvedValue({});
  const localSet = overrides?.localSet ?? vi.fn().mockResolvedValue(undefined);
  const sessionGet = overrides?.sessionGet ?? vi.fn().mockResolvedValue({});

  (global as any).chrome = {
    runtime: { sendMessage: vi.fn().mockResolvedValue(undefined) },
    storage: {
      local: { get: localGet, set: localSet },
      session: { get: sessionGet, set: vi.fn().mockResolvedValue(undefined) },
    },
    tabs: {
      query: vi.fn().mockResolvedValue([]),
    },
    action: {
      setBadgeText: vi.fn(),
      setBadgeBackgroundColor: vi.fn(),
      setTitle: vi.fn(),
    },
    alarms: {
      create: vi.fn(),
      onAlarm: { addListener: vi.fn() },
    },
  };

  return { localGet, localSet, sessionGet };
}

function setupCSS() {
  if (typeof CSS === 'undefined' || !CSS.escape) {
    (global as any).CSS = {
      escape: (value: string) => value.replace(/([^\w-])/g, '\\$1'),
    };
  }
}

const MOCK_MESSAGE: MessageData = {
  message_id: 'msg_sec_ext',
  thread_id: 'thread_sec_ext',
  sender: { name: 'Alice', title: 'Recruiter', company: 'Acme' },
  content: 'We have an opportunity for you',
  timestamp: '2026-01-01T00:00:00Z',
};

function linkedInThread(threadId: string, messageText = 'We have an opportunity for you') {
  return `
    <div id="msg-conversations-container">
      <div class="msg-s-message-group" data-thread-id="${threadId}">
        <div class="msg-s-event-listitem__body"><p>${messageText}</p></div>
      </div>
    </div>
  `;
}

// ── Suite 1: XSS Prevention in DOM ────────────────────────────────────────

describe('security: XSS prevention in DOM (content.ts)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
    setupCSS();
    setupChrome();
    // Mock Selection/Range APIs for jsdom
    const mockRange = { selectNodeContents: vi.fn(), collapse: vi.fn() };
    const mockSelection = { removeAllRanges: vi.fn(), addRange: vi.fn() };
    vi.spyOn(document, 'createRange').mockReturnValue(mockRange as any);
    vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const XSS_PAYLOADS = [
    '<script>alert(1)</script>',
    '<img src=x onerror="alert(document.cookie)">',
    '<a href="javascript:alert(1)">click</a>',
    '" onmouseover="alert(1)" x="',
    '<svg/onload=alert(1)>',
    '<iframe src="javascript:alert(1)"></iframe>',
  ] as const;

  it.each(XSS_PAYLOADS)(
    'stores reply text as literal textContent, not HTML markup: %s',
    (xss) => {
      document.body.innerHTML = linkedInThread('thread_xss');

      injectReplyButton('thread_xss', xss);

      const textEl = document.querySelector('[data-reply-thread="thread_xss"] .lrp-reply-text');
      expect(textEl).not.toBeNull();

      // textContent must equal the raw payload — browser escapes < > when set via textContent
      expect(textEl!.textContent).toBe(xss);

      // No live <script> or <img> tags were created in the DOM
      expect(document.querySelector('script')).toBeNull();
      expect(document.querySelector('iframe')).toBeNull();
    }
  );

  it('innerHTML of reply text element has no unescaped <script> tag', () => {
    document.body.innerHTML = linkedInThread('thread_script');

    injectReplyButton('thread_script', '<script>alert(1)</script>');

    const textEl = document.querySelector('[data-reply-thread="thread_script"] .lrp-reply-text');
    expect(textEl).not.toBeNull();

    // When set via textContent, < becomes &lt; in innerHTML
    expect(textEl!.innerHTML).not.toContain('<script>');
    expect(textEl!.innerHTML).toContain('&lt;script&gt;');
  });

  it('updates existing reply container via textContent, not innerHTML', () => {
    document.body.innerHTML = linkedInThread('thread_update');

    injectReplyButton('thread_update', 'Safe reply');

    // Update with XSS payload — should overwrite textContent only
    injectReplyButton('thread_update', '<img src=x onerror="alert(1)">');

    const textEl = document.querySelector('[data-reply-thread="thread_update"] .lrp-reply-text');
    expect(textEl!.textContent).toBe('<img src=x onerror="alert(1)">');
    expect(document.querySelector('img')).toBeNull();
  });
});

// ── Suite 2: Chrome Storage Overflow ──────────────────────────────────────

describe('security: Chrome storage overflow (background.ts)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('getConfig returns defaults when loadStorageConfig throws', async () => {
    setupChrome({
      localGet: vi.fn().mockRejectedValue(new Error('Storage unavailable')),
      sessionGet: vi.fn().mockRejectedValue(new Error('Storage unavailable')),
    });

    const config = await getConfig();
    // Falls back to defaults without propagating the error
    expect(config.apiKey).toBe('');
    expect(config.webhookUrl).toContain('localhost');
  });

  it('loadPendingSends falls back to empty array when storage.get throws', async () => {
    // processPendingSends calls loadPendingSends internally
    setupChrome({
      localGet: vi.fn().mockRejectedValue(new Error('QUOTA_BYTES exceeded')),
      sessionGet: vi.fn().mockResolvedValue({ apiKey: 'test-key' }),
    });

    // Should not throw — loadPendingSends catches the error and returns []
    await expect(processPendingSends()).resolves.not.toThrow();
  });

  it('enqueuePendingSend propagates QUOTA_EXCEEDED from storage.set', async () => {
    setupChrome({
      localGet: vi.fn().mockResolvedValue({ pending_sends: [] }),
      localSet: vi.fn().mockRejectedValue(new Error('QUOTA_BYTES exceeded')),
      sessionGet: vi.fn().mockResolvedValue({ apiKey: 'test-key' }),
    });

    // handleWebhookSend calls enqueuePendingSend first (outside its try-catch),
    // so a QUOTA error propagates as a Promise rejection — the MV3 message handler
    // catches this via .catch() and sends { success: false }
    await expect(handleWebhookSend(MOCK_MESSAGE)).rejects.toThrow('QUOTA_BYTES exceeded');
  });

  it('processPendingSends prunes TTL-expired entries before retrying', async () => {
    const staleTimestamp = Date.now() - 25 * 60 * 60 * 1000; // 25 hours ago

    const staleEntry = {
      id: 'stale_1',
      data: MOCK_MESSAGE,
      enqueuedAt: staleTimestamp,
      attempts: 0,
      nextRetryAt: 0,
    };

    const { localSet } = setupChrome({
      localGet: vi.fn().mockResolvedValue({ pending_sends: [staleEntry] }),
      sessionGet: vi.fn().mockResolvedValue({ apiKey: '' }), // no API key → early return after pruning
    });

    await processPendingSends();

    // Stale entry is filtered out; storage.set is called with the cleaned-up queue
    expect(localSet).toHaveBeenCalledWith(
      expect.objectContaining({ pending_sends: [] })
    );
  });

  it('processPendingSends does not retry entries exceeding MAX_RETRY_ATTEMPTS', async () => {
    const exhaustedEntry = {
      id: 'exhausted_1',
      data: MOCK_MESSAGE,
      enqueuedAt: Date.now(),
      attempts: 5, // MAX_RETRY_ATTEMPTS = 5
      nextRetryAt: 0,
    };

    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);

    const { localSet } = setupChrome({
      localGet: vi.fn().mockResolvedValue({ pending_sends: [exhaustedEntry] }),
      sessionGet: vi.fn().mockResolvedValue({ apiKey: 'test-key' }),
    });

    await processPendingSends();

    // Exhausted entry is dropped without making a fetch call
    expect(mockFetch).not.toHaveBeenCalled();
    // Storage is updated with the entry removed
    expect(localSet).toHaveBeenCalledWith(
      expect.objectContaining({ pending_sends: [] })
    );
  });
});

// ── Suite 3: Malformed Backend Responses ──────────────────────────────────

describe('security: malformed backend responses (background.ts)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('pollPendingReplies handles non-JSON response without crashing', async () => {
    setupChrome({
      localGet: vi.fn().mockResolvedValue({ settings: { webhookUrl: 'http://localhost:8000' } }),
      sessionGet: vi.fn().mockResolvedValue({ apiKey: 'test-key' }),
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => { throw new SyntaxError('Unexpected token'); },
    }));

    await expect(pollPendingReplies()).resolves.not.toThrow();
  });

  it('pollPendingReplies handles missing replies key without crashing', async () => {
    setupChrome({
      localGet: vi.fn().mockResolvedValue({ settings: { webhookUrl: 'http://localhost:8000' } }),
      sessionGet: vi.fn().mockResolvedValue({ apiKey: 'test-key' }),
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    }));

    await expect(pollPendingReplies()).resolves.not.toThrow();
  });

  it('pollPendingReplies handles replies: null without crashing', async () => {
    setupChrome({
      localGet: vi.fn().mockResolvedValue({ settings: { webhookUrl: 'http://localhost:8000' } }),
      sessionGet: vi.fn().mockResolvedValue({ apiKey: 'test-key' }),
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ replies: null }),
    }));

    await expect(pollPendingReplies()).resolves.not.toThrow();
  });

  it('pollPendingReplies handles reply items with missing thread_id without crashing', async () => {
    setupChrome({
      localGet: vi.fn().mockResolvedValue({ settings: { webhookUrl: 'http://localhost:8000' } }),
      sessionGet: vi.fn().mockResolvedValue({ apiKey: 'test-key' }),
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        replies: [{ message_id: 'msg_1', drafted_reply: 'Hello', user_choice: 'lets_talk' }],
      }),
    }));

    await expect(pollPendingReplies()).resolves.not.toThrow();
  });

  it('pollPendingReplies handles HTTP 500 without crashing', async () => {
    setupChrome({
      localGet: vi.fn().mockResolvedValue({ settings: { webhookUrl: 'http://localhost:8000' } }),
      sessionGet: vi.fn().mockResolvedValue({ apiKey: 'test-key' }),
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    await expect(pollPendingReplies()).resolves.not.toThrow();
  });

  it('pollPendingReplies handles network fetch rejection without crashing', async () => {
    setupChrome({
      localGet: vi.fn().mockResolvedValue({ settings: { webhookUrl: 'http://localhost:8000' } }),
      sessionGet: vi.fn().mockResolvedValue({ apiKey: 'test-key' }),
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(pollPendingReplies()).resolves.not.toThrow();
  });

  it('handleWebhookSend enqueues message to pending_sends on fetch failure', async () => {
    const { localSet } = setupChrome({
      localGet: vi.fn().mockResolvedValue({
        settings: { webhookUrl: 'http://localhost:8000' },
        pending_sends: [],
      }),
      sessionGet: vi.fn().mockResolvedValue({ apiKey: 'test-key' }),
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await handleWebhookSend(MOCK_MESSAGE);

    // Message is enqueued for later retry
    expect(localSet).toHaveBeenCalledWith(
      expect.objectContaining({ pending_sends: expect.any(Array) })
    );
  });
});

// ── Suite 4: Message Deduplication ────────────────────────────────────────

describe('security: message deduplication (content.ts)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
    resetProcessedMessages();
    setupCSS();
    setupChrome();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not process the same thread twice', () => {
    document.body.innerHTML = linkedInThread('thread_dup');

    const first = detectNewMessages();
    expect(first).toHaveLength(1);
    expect(first[0].thread_id).toBe('thread_dup');

    // Same DOM, same threadId — already processed
    const second = detectNewMessages();
    expect(second).toHaveLength(0);
  });

  it('prunes processedMessages from 1001 to 500 when threshold is exceeded', () => {
    // Build DOM with 1001 unique message groups, all with recruiter content
    const groups = Array.from({ length: 1001 }, (_, i) =>
      `<div class="msg-s-message-group" data-thread-id="prune_thread_${i}">
        <div class="msg-s-event-listitem__body"><p>We have an opportunity for you</p></div>
      </div>`
    ).join('');
    document.body.innerHTML = `<div id="msg-conversations-container">${groups}</div>`;

    // First call: all 1001 are new → added → pruned to last 500 (prune_thread_501–1000)
    detectNewMessages();

    // prune_thread_0 through prune_thread_500 were evicted from processedMessages
    // Setting DOM to just prune_thread_0 should yield it as a new detection
    document.body.innerHTML = `
      <div id="msg-conversations-container">
        <div class="msg-s-message-group" data-thread-id="prune_thread_0">
          <div class="msg-s-event-listitem__body"><p>We have an opportunity for you</p></div>
        </div>
      </div>
    `;

    const redetected = detectNewMessages();
    expect(redetected).toHaveLength(1);
    expect(redetected[0].thread_id).toBe('prune_thread_0');
  });

  it('a thread that survived pruning is not re-detected', () => {
    // Build 1001 entries so pruning fires; last 500 survive (501–1000)
    const groups = Array.from({ length: 1001 }, (_, i) =>
      `<div class="msg-s-message-group" data-thread-id="keep_thread_${i}">
        <div class="msg-s-event-listitem__body"><p>We have an opportunity for you</p></div>
      </div>`
    ).join('');
    document.body.innerHTML = `<div id="msg-conversations-container">${groups}</div>`;
    detectNewMessages();

    // keep_thread_1000 was in the last 500 — still in processedMessages
    document.body.innerHTML = `
      <div id="msg-conversations-container">
        <div class="msg-s-message-group" data-thread-id="keep_thread_1000">
          <div class="msg-s-event-listitem__body"><p>We have an opportunity for you</p></div>
        </div>
      </div>
    `;

    const result = detectNewMessages();
    expect(result).toHaveLength(0);
  });

  it('non-recruiter messages are not added to processedMessages', () => {
    document.body.innerHTML = `
      <div id="msg-conversations-container">
        <div class="msg-s-message-group" data-thread-id="thread_non_recruiter">
          <div class="msg-s-event-listitem__body"><p>Hey, how are you?</p></div>
        </div>
      </div>
    `;

    const first = detectNewMessages();
    expect(first).toHaveLength(0);

    // Because non-recruiter messages are NOT added to processedMessages,
    // the same thread is checked again — but still returns nothing (not a recruiter msg)
    const second = detectNewMessages();
    expect(second).toHaveLength(0);
  });
});
