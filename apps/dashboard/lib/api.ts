const BOT_API_URL = process.env.NEXT_PUBLIC_BOT_API_URL || 'http://localhost:3001';
const API_KEY = process.env.DASHBOARD_API_KEY || '';

interface FetchOptions extends RequestInit {
  timeout?: number;
}

async function fetchWithTimeout(url: string, options: FetchOptions = {}): Promise<Response> {
  const { timeout = 10000, ...fetchOptions } = options;

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
}

async function apiRequest<T>(
  endpoint: string,
  options: FetchOptions = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(API_KEY && { 'X-API-Key': API_KEY }),
    ...(options.headers as Record<string, string>),
  };

  const response = await fetchWithTimeout(`${BOT_API_URL}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

// Bot API endpoints
export const botApi = {
  // Health & Status
  getHealth: () => apiRequest<any>('/api/health'),
  getStats: () => apiRequest<any>('/api/stats'),
  getSyncStatus: () => apiRequest<any>('/api/sync/status'),

  // Portfolio & Watchlist
  getPortfolio: () => apiRequest<any>('/api/portfolio'),
  getWatchlist: () => apiRequest<any>('/api/watchlist'),
  addToWatchlist: (mint: string, symbol?: string, name?: string, price?: number) =>
    apiRequest<any>('/api/watchlist', {
      method: 'POST',
      body: JSON.stringify({ mint, symbol, name, price }),
    }),
  removeFromWatchlist: (mint: string) =>
    apiRequest<any>(`/api/watchlist?mint=${mint}`, { method: 'DELETE' }),

  // Discoveries & Alerts
  getDiscoveries: () => apiRequest<any>('/api/discoveries'),
  getAlerts: () => apiRequest<any>('/api/alerts'),

  // Settings
  getSettings: () => apiRequest<any>('/api/settings'),
  updateSettings: (settings: any) =>
    apiRequest<any>('/api/settings', {
      method: 'POST',
      body: JSON.stringify(settings),
    }),

  // Backtest
  getStrategies: () => apiRequest<any>('/api/backtest/strategies'),
  getBacktestRuns: (limit = 20) =>
    apiRequest<any>(`/api/backtest/runs?limit=${limit}`),
  getBacktestRun: (runId: number) =>
    apiRequest<any>(`/api/backtest/run/${runId}`),
  triggerBacktest: (strategyName: string, days?: number, initialCapital?: number) =>
    apiRequest<any>('/api/backtest/run', {
      method: 'POST',
      body: JSON.stringify({ strategyName, days, initialCapital }),
    }),

  // Token Analysis
  getTokenAnalysis: (mint: string) =>
    apiRequest<any>(`/api/token/analysis?mint=${mint}`),

  // Commands
  sendCommand: (command: string, params?: any) =>
    apiRequest<any>('/api/command', {
      method: 'POST',
      body: JSON.stringify({ command, params }),
    }),
};
