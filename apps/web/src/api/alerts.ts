import { apiClient } from './client';
import { Alert } from '@/types';

export interface AlertRule {
  id?: number;
  name: string;
  enabled: boolean;
  conditions: {
    type: 'new_token' | 'smart_money' | 'pattern_match' | 'price_change' | 'volume_spike';
    riskScoreMin?: number;
    riskScoreMax?: number;
    liquidityMin?: number;
    patternType?: 'success' | 'rug';
    priceChangePercent?: number;
    volumeMultiplier?: number;
  };
  actions: {
    telegram?: boolean;
    email?: boolean;
    discord?: boolean;
  };
  created_at?: number;
}

export const alertsApi = {
  // Get all alerts
  getAlerts: async (limit: number = 100, unreadOnly: boolean = false) => {
    const { data } = await apiClient.get<Alert[]>('/api/alerts', {
      params: { limit, unread_only: unreadOnly },
    });
    return data;
  },

  // Mark alert as read
  markRead: async (alertId: number) => {
    await apiClient.patch(`/api/alerts/${alertId}/read`);
  },

  // Mark all alerts as read
  markAllRead: async () => {
    await apiClient.post('/api/alerts/read-all');
  },

  // Delete alert
  deleteAlert: async (alertId: number) => {
    await apiClient.delete(`/api/alerts/${alertId}`);
  },

  // Get alert rules
  getRules: async () => {
    const { data } = await apiClient.get<AlertRule[]>('/api/alerts/rules');
    return data;
  },

  // Create alert rule
  createRule: async (rule: Omit<AlertRule, 'id' | 'created_at'>) => {
    const { data } = await apiClient.post<AlertRule>('/api/alerts/rules', rule);
    return data;
  },

  // Update alert rule
  updateRule: async (ruleId: number, updates: Partial<AlertRule>) => {
    const { data } = await apiClient.put<AlertRule>(`/api/alerts/rules/${ruleId}`, updates);
    return data;
  },

  // Delete alert rule
  deleteRule: async (ruleId: number) => {
    await apiClient.delete(`/api/alerts/rules/${ruleId}`);
  },

  // Toggle rule enabled status
  toggleRule: async (ruleId: number, enabled: boolean) => {
    await apiClient.patch(`/api/alerts/rules/${ruleId}/toggle`, { enabled });
  },
};
