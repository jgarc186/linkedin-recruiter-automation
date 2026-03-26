export interface ConnectionStatus {
  backend: boolean;
}

export async function getConnectionStatus(webhookBaseUrl: string): Promise<ConnectionStatus> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const response = await fetch(`${webhookBaseUrl}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return { backend: response.ok };
  } catch {
    return { backend: false };
  }
}

export async function getPendingMessagesCount(): Promise<number> {
  try {
    const data = await chrome.storage.local.get(null);
    return Object.keys(data).filter(key => key.startsWith('reply_')).length;
  } catch {
    return 0;
  }
}

export function formatStatusText(status: ConnectionStatus): string {
  return status.backend ? 'Connected' : 'Disconnected';
}

export async function initPopup(): Promise<void> {
  const statusEl = document.getElementById('connection-status');
  const indicatorEl = document.getElementById('status-indicator');
  const pendingEl = document.getElementById('pending-count');

  // Load webhook URL from settings
  const stored = await chrome.storage.local.get('webhookUrl');
  const webhookUrl = stored.webhookUrl || 'http://localhost:8000';

  const [status, pendingCount] = await Promise.all([
    getConnectionStatus(webhookUrl),
    getPendingMessagesCount(),
  ]);

  if (statusEl) statusEl.textContent = formatStatusText(status);
  if (indicatorEl) {
    indicatorEl.classList.remove('connected', 'disconnected');
    indicatorEl.classList.add(status.backend ? 'connected' : 'disconnected');
  }
  if (pendingEl) pendingEl.textContent = String(pendingCount);
}
