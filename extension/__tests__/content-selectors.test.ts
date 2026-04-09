import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  SELECTORS,
  queryFirst,
  queryAll,
  extractMessageData,
  detectNewMessages,
  injectReplyButton,
  sendReply,
  resetProcessedMessages,
} from '../src/content';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockCSSEscape() {
  if (typeof CSS === 'undefined' || !CSS.escape) {
    (global as any).CSS = {
      escape: (value: string) => value.replace(/([^\w-])/g, '\\$1'),
    };
  }
}

function mockChrome() {
  (global as any).chrome = {
    runtime: { sendMessage: vi.fn().mockResolvedValue(undefined) },
  };
}

// ---------------------------------------------------------------------------
// SELECTORS constant
// ---------------------------------------------------------------------------

describe('SELECTORS', () => {
  it('defines fallback chains for all selector groups', () => {
    const keys = ['container', 'messageGroup', 'senderName', 'senderTitle', 'messageBody', 'messageInput'] as const;
    for (const key of keys) {
      expect(SELECTORS[key]).toBeInstanceOf(Array);
      expect(SELECTORS[key].length).toBeGreaterThanOrEqual(2);
    }
  });

  it('uses data-* attributes as second-level fallbacks for field selectors', () => {
    expect(SELECTORS.senderName[1]).toMatch(/^\[data-/);
    expect(SELECTORS.senderTitle[1]).toMatch(/^\[data-/);
    expect(SELECTORS.messageBody[1]).toMatch(/^\[data-/);
  });
});

// ---------------------------------------------------------------------------
// queryFirst
// ---------------------------------------------------------------------------

describe('queryFirst', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns element without warning when primary selector matches', () => {
    document.body.innerHTML = '<div class="primary"></div>';
    const el = queryFirst(document, ['.primary', '.fallback']);
    expect(el).not.toBeNull();
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it('returns element and warns when a fallback selector matches', () => {
    document.body.innerHTML = '<div class="fallback"></div>';
    const el = queryFirst(document, ['.primary', '.fallback', '.last']);
    expect(el).not.toBeNull();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('.fallback'));
    expect(console.error).not.toHaveBeenCalled();
  });

  it('returns null and errors when all selectors fail', () => {
    document.body.innerHTML = '<div class="unrelated"></div>';
    const el = queryFirst(document, ['.primary', '.fallback']);
    expect(el).toBeNull();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('[LRA] All selectors failed'));
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('accepts an Element (not just Document) as root', () => {
    document.body.innerHTML = '<div id="root"><span class="target"></span></div>';
    const root = document.getElementById('root')!;
    const el = queryFirst(root, ['.target']);
    expect(el).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// queryAll
// ---------------------------------------------------------------------------

describe('queryAll', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns elements without warning when primary selector matches', () => {
    document.body.innerHTML = '<div class="primary"></div><div class="primary"></div>';
    const els = queryAll(document, ['.primary', '.fallback']);
    expect(els).toHaveLength(2);
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it('returns elements and warns when a fallback selector matches', () => {
    document.body.innerHTML = '<div class="fallback"></div><div class="fallback"></div>';
    const els = queryAll(document, ['.primary', '.fallback']);
    expect(els).toHaveLength(2);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('.fallback'));
    expect(console.error).not.toHaveBeenCalled();
  });

  it('returns empty array and errors when all selectors fail', () => {
    document.body.innerHTML = '<div class="unrelated"></div>';
    const els = queryAll(document, ['.primary', '.fallback']);
    expect(els).toEqual([]);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('[LRA] All selectors failed'));
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('accepts an Element (not just Document) as root', () => {
    document.body.innerHTML = '<div id="root"><span class="item"></span><span class="item"></span></div>';
    const root = document.getElementById('root')!;
    const els = queryAll(root, ['.item']);
    expect(els).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// extractMessageData — fallback selectors
// ---------------------------------------------------------------------------

describe('extractMessageData - fallback selectors', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('reads name/title/body from second-level data-* fallback attributes', () => {
    const el = document.createElement('div');
    el.setAttribute('data-thread-id', 'thread_fb');
    el.innerHTML = `
      <span data-sender-name>Alice Recruiter</span>
      <span data-sender-title>Head of Talent at FooCorp</span>
      <div data-message-body>I have an opportunity for you</div>
    `;

    const result = extractMessageData(el, 'msg_fb');

    expect(result.sender.name).toBe('Alice Recruiter');
    expect(result.sender.title).toBe('Head of Talent at FooCorp');
    expect(result.sender.company).toBe('FooCorp');
    expect(result.content).toBe('I have an opportunity for you');
    // One warn per fallback field (name, title, body)
    expect(console.warn).toHaveBeenCalledTimes(3);
  });

  it('reads name/title/body from third-level class fallback selectors', () => {
    const el = document.createElement('div');
    el.setAttribute('data-thread-id', 'thread_fb2');
    el.innerHTML = `
      <span class="msg-s-profile-card__name">Bob Engineer</span>
      <span class="msg-s-profile-card__headline">Engineering Manager at BarCorp</span>
      <div class="msg-s-event__body">Exciting position available</div>
    `;

    const result = extractMessageData(el, 'msg_fb2');

    expect(result.sender.name).toBe('Bob Engineer');
    expect(result.sender.title).toBe('Engineering Manager at BarCorp');
    expect(result.sender.company).toBe('BarCorp');
    expect(result.content).toBe('Exciting position available');
    expect(console.warn).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// detectNewMessages — fallback selectors
// ---------------------------------------------------------------------------

describe('detectNewMessages - fallback selectors', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    resetProcessedMessages();
    mockChrome();
    mockCSSEscape();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('finds the container via the data-view-name fallback attribute', () => {
    document.body.innerHTML = `
      <div data-view-name="messaging-thread-container">
        <div class="msg-s-message-group" data-thread-id="thread_cont_fb">
          <span class="msg-s-message-group__name">Jane Smith</span>
          <span class="msg-s-message-group__title">Recruiter at Acme</span>
          <div class="msg-s-event-listitem__body"><p>I have an opportunity for you</p></div>
        </div>
      </div>
    `;

    const messages = detectNewMessages();

    expect(messages).toHaveLength(1);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('[data-view-name="messaging-thread-container"]')
    );
  });

  it('finds message groups via the [data-thread-id] fallback selector', () => {
    document.body.innerHTML = `
      <div id="msg-conversations-container">
        <div data-thread-id="thread_group_fb">
          <span class="msg-s-message-group__name">Carol Recruiter</span>
          <span class="msg-s-message-group__title">Talent Acquisition at TechCo</span>
          <div class="msg-s-event-listitem__body"><p>Exciting career opportunity</p></div>
        </div>
      </div>
    `;

    const messages = detectNewMessages();

    expect(messages).toHaveLength(1);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('[data-thread-id]'));
  });

  it('finds message body via the [data-message-body] fallback attribute', () => {
    document.body.innerHTML = `
      <div id="msg-conversations-container">
        <div class="msg-s-message-group" data-thread-id="thread_body_fb">
          <span class="msg-s-message-group__name">Dave Recruiter</span>
          <span class="msg-s-message-group__title">Recruiter at StartupCo</span>
          <div data-message-body>Great hiring opportunity at StartupCo</div>
        </div>
      </div>
    `;

    const messages = detectNewMessages();

    expect(messages).toHaveLength(1);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('[data-message-body]'));
  });

  it('returns empty array and logs error when no message groups match any selector', () => {
    document.body.innerHTML = `
      <div id="msg-conversations-container">
        <div class="unrelated-element">no matching selectors here</div>
      </div>
    `;

    const messages = detectNewMessages();

    expect(messages).toHaveLength(0);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('[LRA] All selectors failed'));
  });
});

// ---------------------------------------------------------------------------
// injectReplyButton — fallback container
// ---------------------------------------------------------------------------

describe('injectReplyButton - fallback container', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    mockCSSEscape();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('injects reply button when container is found via fallback selector', () => {
    document.body.innerHTML = `
      <div data-view-name="messaging-thread-container">
        <div data-thread-id="thread_inject_fb"></div>
      </div>
    `;

    injectReplyButton('thread_inject_fb', 'Fallback reply');

    expect(document.querySelector('[data-reply-thread="thread_inject_fb"]')).not.toBeNull();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('[data-view-name="messaging-thread-container"]')
    );
  });
});

// ---------------------------------------------------------------------------
// sendReply — fallback input selector
// ---------------------------------------------------------------------------

describe('sendReply - fallback input selector', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    mockCSSEscape();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const mockRange = { selectNodeContents: vi.fn(), collapse: vi.fn() };
    const mockSelection = { removeAllRanges: vi.fn(), addRange: vi.fn() };
    vi.spyOn(document, 'createRange').mockReturnValue(mockRange as any);
    vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection as any);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('types reply into input found via [data-placeholder][contenteditable] fallback', () => {
    document.body.innerHTML = `
      <div data-placeholder="Write a message…"
           contenteditable="true"
           data-thread-id="thread_input_fb"></div>
    `;
    const input = document.querySelector('[data-placeholder][contenteditable]') as HTMLElement;
    const dispatchSpy = vi.spyOn(input, 'dispatchEvent');

    sendReply('thread_input_fb', 'Fallback input reply');

    expect(input.textContent).toBe('Fallback input reply');
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'input', inputType: 'insertText' })
    );
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('[data-placeholder][contenteditable]')
    );
  });
});
