import type { MessageData } from '../../shared/types';

// Fallback selector chains — each array is tried in order; first match wins.
// Prefer data-* attributes over class names where available (class names change; data attrs are stable).
export const SELECTORS = {
  container:    ['#msg-conversations-container', '[data-view-name="messaging-thread-container"]', '.msg-overlay-list-bubble'],
  messageGroup: ['.msg-s-message-group', '[data-thread-id]', '.msg-s-event-listitem'],
  senderName:   ['.msg-s-message-group__name', '[data-sender-name]', '.msg-s-profile-card__name'],
  senderTitle:  ['.msg-s-message-group__title', '[data-sender-title]', '.msg-s-profile-card__headline'],
  messageBody:  ['.msg-s-event-listitem__body', '[data-message-body]', '.msg-s-event__body'],
  messageInput: ['.msg-form__contenteditable', '[data-placeholder][contenteditable]', '.msg-form__message-texteditor [contenteditable]'],
};

export function queryFirst(root: Element | Document, selectors: string[]): Element | null {
  for (let i = 0; i < selectors.length; i++) {
    const el = root.querySelector(selectors[i]);
    if (el) {
      if (i > 0) console.warn(`[LRA] Primary selector failed, using fallback: ${selectors[i]}`);
      return el;
    }
  }
  console.error(`[LRA] All selectors failed: ${selectors.join(', ')}`);
  return null;
}

export function queryAll(root: Element | Document, selectors: string[]): Element[] {
  for (let i = 0; i < selectors.length; i++) {
    const els = Array.from(root.querySelectorAll(selectors[i]));
    if (els.length > 0) {
      if (i > 0) console.warn(`[LRA] Primary selector failed, using fallback: ${selectors[i]}`);
      return els;
    }
  }
  console.error(`[LRA] All selectors failed: ${selectors.join(', ')}`);
  return [];
}

// Base recruiter keywords — shared with backend via shared/constants.ts
export const RECRUITER_KEYWORDS = [
  'opportunity',
  'role',
  'hiring',
  'position',
  'interview',
  'recruiter',
  'job',
  'career',
  'vacancy',
  'opening',
];

const MAX_PROCESSED_SIZE = 1000;
const PRUNE_TO_SIZE = 500;

const processedMessages = new Set<string>();

export function resetProcessedMessages(): void {
  processedMessages.clear();
}

function pruneProcessedMessages(): void {
  if (processedMessages.size <= MAX_PROCESSED_SIZE) return;

  const entries = Array.from(processedMessages);
  const toKeep = entries.slice(entries.length - PRUNE_TO_SIZE);
  processedMessages.clear();
  for (const entry of toKeep) {
    processedMessages.add(entry);
  }
}

export function isRecruiterMessage(text: string): boolean {
  if (!text) return false;
  const lowerText = text.toLowerCase();
  return RECRUITER_KEYWORDS.some(keyword => lowerText.includes(keyword));
}

export function extractMessageData(element: Element, messageId: string): MessageData {
  const threadId = element.getAttribute('data-thread-id') || 'unknown';

  // Try to find name
  const nameElement = queryFirst(element, SELECTORS.senderName);
  const name = nameElement?.textContent?.trim() || 'Unknown';

  // Try to find title
  const titleElement = queryFirst(element, SELECTORS.senderTitle);
  const titleText = titleElement?.textContent?.trim() || 'Unknown';

  // Extract company from title (e.g., "Senior Technical Recruiter at TechCorp")
  const companyMatch = titleText.match(/at\s+(.+)$/i);
  const company = companyMatch ? companyMatch[1].trim() : 'Unknown';

  // Try to find message content
  const bodyElement = queryFirst(element, SELECTORS.messageBody);
  const content = bodyElement?.textContent?.trim() || '';

  return {
    message_id: messageId,
    thread_id: threadId,
    sender: {
      name,
      title: titleText,
      company,
    },
    content,
    timestamp: new Date().toISOString(),
  };
}

export function detectNewMessages(): MessageData[] {
  const container = queryFirst(document, SELECTORS.container);
  if (!container) return [];

  const messageGroups = queryAll(container, SELECTORS.messageGroup);
  const newMessages: MessageData[] = [];

  messageGroups.forEach((group, index) => {
    const threadId = group.getAttribute('data-thread-id') || `thread_${index}`;

    if (processedMessages.has(threadId)) return;

    const bodyElement = queryFirst(group, SELECTORS.messageBody);
    const content = bodyElement?.textContent?.trim() || '';

    if (isRecruiterMessage(content)) {
      const messageData = extractMessageData(group, `msg_${threadId}_${Date.now()}`);
      newMessages.push(messageData);
      processedMessages.add(threadId);

      // Send to background script for webhook processing
      chrome.runtime?.sendMessage({
        type: 'NEW_MESSAGE_DETECTED',
        data: messageData,
      }).catch(() => {
        // Background script might not be ready, ignore
      });
    }
  });

  pruneProcessedMessages();

  return newMessages;
}

function safeSelector(attr: string, value: string): string {
  return `[${attr}="${CSS.escape(value)}"]`;
}

export function injectReplyButton(threadId: string, reply: string): void {
  const container = queryFirst(document, SELECTORS.container);
  if (!container) return;

  const threadEl = container.querySelector(safeSelector('data-thread-id', threadId));
  if (!threadEl) return;

  // Check for existing reply container -- update text if found
  const existing = document.querySelector(safeSelector('data-reply-thread', threadId));
  if (existing) {
    const textEl = existing.querySelector('.lrp-reply-text');
    // Security: textContent (not innerHTML) prevents XSS from backend-supplied reply
    if (textEl) textEl.textContent = reply;
    return;
  }

  const replyContainer = document.createElement('div');
  replyContainer.setAttribute('data-reply-thread', threadId);
  replyContainer.className = 'lrp-reply-container';

  const replyText = document.createElement('div');
  replyText.className = 'lrp-reply-text';
  // Security: textContent (not innerHTML) prevents XSS from backend-supplied reply
  replyText.textContent = reply;

  const sendBtn = document.createElement('button');
  sendBtn.className = 'lrp-send-btn';
  sendBtn.textContent = 'Send';
  sendBtn.addEventListener('click', () => {
    sendReply(threadId, reply);
    replyContainer.remove();
  });

  const dismissBtn = document.createElement('button');
  dismissBtn.className = 'lrp-dismiss-btn';
  dismissBtn.textContent = 'Dismiss';
  dismissBtn.addEventListener('click', () => {
    replyContainer.remove();
  });

  replyContainer.appendChild(replyText);
  replyContainer.appendChild(sendBtn);
  replyContainer.appendChild(dismissBtn);
  threadEl.appendChild(replyContainer);
}

export function sendReply(threadId: string, text: string): void {
  const threadSelector = safeSelector('data-thread-id', threadId);
  const inputSelectors = SELECTORS.messageInput.map(s => `${s}${threadSelector}`);
  const input = queryFirst(document, inputSelectors) as HTMLElement | null;

  if (!input) return;

  input.focus();

  // Set content directly, then dispatch InputEvent so React reconciles
  input.textContent = text;

  // Reset React's internal value tracker so it detects the change
  const tracker = (input as any)._valueTracker;
  if (tracker) {
    tracker.setValue('');
  }

  // Position cursor at end of inserted text
  const selection = window.getSelection();
  if (selection && input.childNodes.length > 0) {
    const range = document.createRange();
    range.selectNodeContents(input);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  // Notify React's synthetic event system
  input.dispatchEvent(
    new InputEvent('input', {
      bubbles: true,
      cancelable: false,
      inputType: 'insertText',
      data: text,
    })
  );
}

export interface ReplyMessage {
  type: string;
  threadId: string;
  messageId?: string;
  draftedReply?: string;
}

export function handleReplyMessage(message: ReplyMessage): void {
  if (message.type !== 'NEW_REPLY_AVAILABLE') return;
  if (!message.draftedReply) return;

  injectReplyButton(message.threadId, message.draftedReply);
}

export function onMessageListener(
  message: ReplyMessage,
  sender: chrome.runtime.MessageSender
): void {
  if (sender.id !== chrome.runtime.id) return;
  handleReplyMessage(message);
}

let observer: MutationObserver | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

export function initContentScript(): void {
  // Initial scan
  detectNewMessages();

  // Set up MutationObserver for dynamic message detection
  const container = queryFirst(document, SELECTORS.container) || document.body;

  observer = new MutationObserver(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      detectNewMessages();
    }, 500);
  });

  observer.observe(container, { childList: true, subtree: true });

  chrome.runtime?.onMessage?.addListener(onMessageListener);
}

// Auto-initialize when injected as a content script
if (!import.meta.env.VITEST) {
  initContentScript();
}
