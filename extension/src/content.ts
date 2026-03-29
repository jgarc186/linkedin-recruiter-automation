import type { MessageData } from '../../shared/types';

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
  const nameElement = element.querySelector('.msg-s-message-group__name');
  const name = nameElement?.textContent?.trim() || 'Unknown';

  // Try to find title
  const titleElement = element.querySelector('.msg-s-message-group__title');
  const titleText = titleElement?.textContent?.trim() || 'Unknown';

  // Extract company from title (e.g., "Senior Technical Recruiter at TechCorp")
  const companyMatch = titleText.match(/at\s+(.+)$/i);
  const company = companyMatch ? companyMatch[1].trim() : 'Unknown';

  // Try to find message content
  const bodyElement = element.querySelector('.msg-s-event-listitem__body');
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
  const container = document.getElementById('msg-conversations-container');
  if (!container) return [];

  const messageGroups = container.querySelectorAll('.msg-s-message-group');
  const newMessages: MessageData[] = [];

  messageGroups.forEach((group, index) => {
    const threadId = group.getAttribute('data-thread-id') || `thread_${index}`;

    if (processedMessages.has(threadId)) return;

    const bodyElement = group.querySelector('.msg-s-event-listitem__body');
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
  const container = document.getElementById('msg-conversations-container');
  if (!container) return;

  const threadEl = container.querySelector(safeSelector('data-thread-id', threadId));
  if (!threadEl) return;

  // Check for existing reply container -- update text if found
  const existing = document.querySelector(safeSelector('data-reply-thread', threadId));
  if (existing) {
    const textEl = existing.querySelector('.lrp-reply-text');
    if (textEl) textEl.textContent = reply;
    return;
  }

  const replyContainer = document.createElement('div');
  replyContainer.setAttribute('data-reply-thread', threadId);
  replyContainer.className = 'lrp-reply-container';

  const replyText = document.createElement('div');
  replyText.className = 'lrp-reply-text';
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
  const input = document.querySelector(
    `.msg-form__contenteditable${safeSelector('data-thread-id', threadId)}`
  ) as HTMLElement | null;

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

let observer: MutationObserver | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

export function initContentScript(): void {
  // Initial scan
  detectNewMessages();

  // Set up MutationObserver for dynamic message detection
  const container = document.getElementById('msg-conversations-container') || document.body;

  observer = new MutationObserver(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      detectNewMessages();
    }, 500);
  });

  observer.observe(container, { childList: true, subtree: true });

  // Listen for reply messages from background script
  chrome.runtime?.onMessage?.addListener((message: ReplyMessage) => {
    handleReplyMessage(message);
  });
}
