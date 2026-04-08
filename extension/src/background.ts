import type { MessageData, WebhookReplyPayload, UserCriteria } from '../../shared/types';

const PENDING_SENDS_KEY = 'pending_sends';
const PENDING_SEND_TTL_MS = 24 * 60 * 60 * 1000;

interface PendingSend {
  id: string;
  data: MessageData;
  enqueuedAt: number;
  attempts: number;
}

export async function getConfig(): Promise<{ webhookUrl: string; apiKey: string; criteria?: UserCriteria }> {
  try {
    const data = await chrome.storage.local.get('settings');
    const settings = data.settings || {};
    return {
      webhookUrl: settings.webhookUrl || 'http://localhost:8000',
      apiKey: settings.apiKey || '',
      criteria: settings.criteria,
    };
  } catch {
    return {
      webhookUrl: 'http://localhost:8000',
      apiKey: '',
    };
  }
}

// Storage helpers for pending sends queue
async function loadPendingSends(): Promise<PendingSend[]> {
  try {
    const data = await chrome.storage.local.get(PENDING_SENDS_KEY);
    return data[PENDING_SENDS_KEY] || [];
  } catch {
    return [];
  }
}

async function enqueuePendingSend(data: MessageData): Promise<string> {
  const pending = await loadPendingSends();
  const id = `${Date.now()}_${Math.random()}`;
  pending.push({
    id,
    data,
    enqueuedAt: Date.now(),
    attempts: 0,
  });
  await chrome.storage.local.set({ [PENDING_SENDS_KEY]: pending });
  return id;
}

async function removePendingSend(id: string): Promise<void> {
  const pending = await loadPendingSends();
  const filtered = pending.filter(entry => entry.id !== id);
  await chrome.storage.local.set({ [PENDING_SENDS_KEY]: filtered });
}

export async function handleWebhookSend(data: MessageData): Promise<void> {
  const id = await enqueuePendingSend(data);
  try {
    const { webhookUrl, apiKey, criteria } = await getConfig();
    const payload = criteria ? { ...data, criteria } : data;
    const response = await fetch(`${webhookUrl}/webhook/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    await removePendingSend(id);
  } catch (error) {
    // Left in pending_sends — will be retried by processPendingSends on next wake
    console.error('Failed to send webhook, queued for retry:', error);
  }
}

export async function processPendingSends(): Promise<void> {
  const pending = await loadPendingSends();
  const now = Date.now();
  const stillPending: PendingSend[] = [];

  for (const entry of pending) {
    if (now - entry.enqueuedAt > PENDING_SEND_TTL_MS) continue; // prune stale

    try {
      const { webhookUrl, apiKey, criteria } = await getConfig();
      const payload = criteria ? { ...entry.data, criteria } : entry.data;
      const response = await fetch(`${webhookUrl}/webhook/message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      // success — don't add to stillPending
    } catch {
      stillPending.push({ ...entry, attempts: entry.attempts + 1 });
    }
  }

  await chrome.storage.local.set({ [PENDING_SENDS_KEY]: stillPending });
}

export async function handleWebhookResponse(response: WebhookReplyPayload): Promise<void> {
  try {
    // Store the drafted reply
    await chrome.storage.local.set({
      [`reply_${response.thread_id}`]: {
        messageId: response.message_id,
        draftedReply: response.drafted_reply,
        suggestedTimes: response.suggested_times,
        timestamp: Date.now(),
      },
    });

    // Notify content script
    const tabs = await chrome.tabs.query({
      url: 'https://www.linkedin.com/messaging/*',
    });

    for (const tab of tabs) {
      if (tab.id) {
        try {
          await chrome.tabs.sendMessage(tab.id, {
            type: 'NEW_REPLY_AVAILABLE',
            threadId: response.thread_id,
            messageId: response.message_id,
            draftedReply: response.drafted_reply,
          });
        } catch {
          // Tab might not have content script loaded, ignore
        }
      }
    }
  } catch (error) {
    console.error('Error handling webhook response:', error);
  }
}

export async function pollPendingReplies(): Promise<void> {
  try {
    const { webhookUrl, apiKey } = await getConfig();
    const response = await fetch(`${webhookUrl}/webhook/pending-replies`, {
      headers: {
        'X-API-Key': apiKey,
      },
    });

    if (!response.ok) return;

    const data = await response.json();
    const replies: WebhookReplyPayload[] = data.replies || [];

    for (const reply of replies) {
      await handleWebhookResponse(reply);
    }
  } catch (error) {
    console.error('Error polling pending replies:', error);
  }
}

// Allowed extension IDs that can send external messages
let ALLOWED_EXTERNAL_SENDERS: string[] = [
  // Add your backend/companion extension IDs here
];

export function __testSetAllowedSenders(senders: string[]): void {
  ALLOWED_EXTERNAL_SENDERS = senders;
}

// Named listener functions for reliable MV3 registration
function onAlarmHandler(alarm: chrome.alarms.Alarm): void {
  if (alarm.name === 'keepAlive') {
    processPendingSends();
  }
  if (alarm.name === 'pollReplies') {
    pollPendingReplies();
  }
}

function onMessageHandler(
  message: any,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response: any) => void
): boolean {
  if (message.type === 'NEW_MESSAGE_DETECTED') {
    handleWebhookSend(message.data)
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep channel open for async
  }

  return false;
}

function onExternalMessageHandler(message: any, sender: chrome.runtime.MessageSender): void {
  if (!ALLOWED_EXTERNAL_SENDERS.includes(sender.id || '')) {
    console.warn('Rejected external message from unauthorized sender:', sender.id);
    return;
  }

  if (message.type === 'DRAFTED_REPLY') {
    handleWebhookResponse(message.data);
  }
}

export function maintainConnection(): void {
  // Use chrome.alarms for reliable MV3 keep-alive and polling
  if (chrome.alarms) {
    chrome.alarms.create('keepAlive', { periodInMinutes: 1 });
    chrome.alarms.create('pollReplies', { periodInMinutes: 0.5 });
  }
}

// Export listeners for testing
export { onAlarmHandler as __testOnAlarmHandler };
export { onMessageHandler as __testOnMessageHandler };
export { onExternalMessageHandler as __testOnExternalMessageHandler };

// Module-level listener registration (runs synchronously on every SW wake)
if (typeof chrome !== 'undefined' && chrome.alarms) {
  chrome.alarms.onAlarm.addListener(onAlarmHandler);
  chrome.runtime.onMessage.addListener(onMessageHandler);
  chrome.runtime.onMessageExternal?.addListener(onExternalMessageHandler);
  maintainConnection();
}
