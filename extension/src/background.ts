import type { MessageData, WebhookReplyPayload } from '../../shared/types';

export async function getConfig(): Promise<{ webhookUrl: string; apiKey: string }> {
  try {
    const data = await chrome.storage.local.get('settings');
    const settings = data.settings || {};
    return {
      webhookUrl: settings.webhookUrl || 'http://localhost:8000',
      apiKey: settings.apiKey || '',
    };
  } catch {
    return {
      webhookUrl: 'http://localhost:8000',
      apiKey: '',
    };
  }
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function handleWebhookSend(data: MessageData): Promise<void> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const { webhookUrl, apiKey } = await getConfig();
      const response = await fetch(`${webhookUrl}/webhook/message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return; // Success
    } catch (error) {
      lastError = error as Error;

      if (attempt < MAX_RETRIES - 1) {
        await sleep(RETRY_DELAY_MS * (attempt + 1));
      }
    }
  }

  // All retries failed
  console.error('Failed to send webhook after retries:', lastError);
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

export function maintainConnection(): void {
  // Use chrome.alarms for reliable MV3 keep-alive and polling
  if (chrome.alarms) {
    chrome.alarms.create('keepAlive', { periodInMinutes: 1 });
    chrome.alarms.create('pollReplies', { periodInMinutes: 0.5 });
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === 'keepAlive') {
        // Heartbeat - keeps service worker alive
      }
      if (alarm.name === 'pollReplies') {
        pollPendingReplies();
      }
    });
  }

  // Listen for messages from content script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'NEW_MESSAGE_DETECTED') {
      handleWebhookSend(message.data)
        .then(() => sendResponse({ success: true }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true; // Keep channel open for async
    }

    return false;
  });

  // Handle external messages with sender validation
  chrome.runtime.onMessageExternal?.addListener((message, sender) => {
    if (!ALLOWED_EXTERNAL_SENDERS.includes(sender.id || '')) {
      console.warn('Rejected external message from unauthorized sender:', sender.id);
      return;
    }

    if (message.type === 'DRAFTED_REPLY') {
      handleWebhookResponse(message.data);
    }
  });
}
