import { useState } from 'react';
import { Plus, Bell, CheckCheck, Trash2 } from 'lucide-react';
import { useAlerts, useAlertRules, useMarkAllRead, useDeleteAlert } from '@/hooks/useAlerts';
import { AlertRule } from '@/api/alerts';
import { AlertRuleCard } from '@/components/AlertRuleCard';
import { AlertRuleBuilder } from '@/components/AlertRuleBuilder';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { timeAgo } from '@/utils/format';
import { cn } from '@/utils/cn';

export const Alerts = () => {
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const [editingRule, setEditingRule] = useState<AlertRule | null>(null);
  const [showRuleBuilder, setShowRuleBuilder] = useState(false);

  const { data: alerts, isLoading: alertsLoading } = useAlerts(100, showUnreadOnly);
  const { data: rules, isLoading: rulesLoading } = useAlertRules();
  const markAllReadMutation = useMarkAllRead();
  const deleteAlertMutation = useDeleteAlert();

  const unreadCount = alerts?.filter((a) => !a.read).length || 0;

  const getSeverityColor = (severity: string) => {
    const colors = {
      info: 'bg-blue-500/20 border-blue-500/30 text-blue-400',
      warning: 'bg-yellow-500/20 border-yellow-500/30 text-yellow-400',
      critical: 'bg-red-500/20 border-red-500/30 text-red-400',
    };
    return colors[severity as keyof typeof colors] || colors.info;
  };

  const getTypeEmoji = (type: string) => {
    const emojis: Record<string, string> = {
      new_token: '🆕',
      smart_money: '💎',
      pattern_match: '🧠',
      price_change: '📈',
    };
    return emojis[type] || '🔔';
  };

  const handleMarkAllRead = async () => {
    await markAllReadMutation.mutateAsync();
  };

  const handleDeleteAlert = async (id: number) => {
    if (confirm('Delete this alert?')) {
      await deleteAlertMutation.mutateAsync(id);
    }
  };

  const handleEditRule = (rule: AlertRule) => {
    setEditingRule(rule);
    setShowRuleBuilder(true);
  };

  const handleCloseBuilder = () => {
    setShowRuleBuilder(false);
    setEditingRule(null);
  };

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">
              Alerts & Rules 🔔
            </h1>
            <p className="text-gray-400">
              Manage notification rules and view alert history
            </p>
          </div>
          <button
            onClick={() => setShowRuleBuilder(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors"
          >
            <Plus className="h-4 w-4" />
            New Rule
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
            <div className="text-sm text-gray-400 mb-1">Unread Alerts</div>
            <div className="text-2xl font-bold text-white">{unreadCount}</div>
          </div>
          <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
            <div className="text-sm text-gray-400 mb-1">Total Alerts</div>
            <div className="text-2xl font-bold text-white">{alerts?.length || 0}</div>
          </div>
          <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
            <div className="text-sm text-gray-400 mb-1">Active Rules</div>
            <div className="text-2xl font-bold text-white">
              {rules?.filter((r) => r.enabled).length || 0}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Alert List */}
        <div className="lg:col-span-2 space-y-6">
          {/* Alert History */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-white">Alert History</h2>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showUnreadOnly}
                    onChange={(e) => setShowUnreadOnly(e.target.checked)}
                    className="rounded border-gray-600 text-blue-600"
                  />
                  Unread only
                </label>
                {unreadCount > 0 && (
                  <button
                    onClick={handleMarkAllRead}
                    disabled={markAllReadMutation.isPending}
                    className="flex items-center gap-1 px-3 py-1 rounded text-sm text-blue-400 hover:bg-blue-500/10 transition-colors"
                  >
                    <CheckCheck className="h-4 w-4" />
                    Mark all read
                  </button>
                )}
              </div>
            </div>

            {alertsLoading ? (
              <LoadingSpinner size="lg" />
            ) : alerts && alerts.length > 0 ? (
              <div className="space-y-3 max-h-[600px] overflow-y-auto">
                {alerts.map((alert) => (
                  <div
                    key={alert.id}
                    className={cn(
                      'p-4 rounded-lg border transition-all',
                      !alert.read && 'border-blue-500/50 bg-blue-500/5',
                      alert.read && 'border-gray-800 bg-gray-800/30 opacity-70'
                    )}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xl">{getTypeEmoji(alert.type)}</span>
                        <div>
                          <div
                            className={cn(
                              'inline-block px-2 py-0.5 rounded text-xs font-medium mb-1',
                              getSeverityColor(alert.severity)
                            )}
                          >
                            {alert.severity.toUpperCase()}
                          </div>
                          <div className="text-sm text-gray-400">
                            {alert.token_symbol} • {timeAgo(alert.created_at * 1000)}
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => handleDeleteAlert(alert.id)}
                        className="p-1 rounded hover:bg-gray-800 text-gray-500 hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>

                    <p className="text-white mb-2">{alert.message}</p>

                    {alert.data && Object.keys(alert.data).length > 0 && (
                      <div className="text-xs text-gray-500 font-mono">
                        {JSON.stringify(alert.data, null, 2)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <Bell className="h-16 w-16 text-gray-600 mx-auto mb-4" />
                <h3 className="text-xl font-semibold text-gray-400 mb-2">
                  No alerts yet
                </h3>
                <p className="text-gray-500">
                  {showUnreadOnly ? 'All caught up!' : 'Alerts will appear here'}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Alert Rules Sidebar */}
        <div>
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6 sticky top-24">
            <h2 className="text-xl font-bold text-white mb-4">Alert Rules</h2>

            {rulesLoading ? (
              <LoadingSpinner />
            ) : rules && rules.length > 0 ? (
              <div className="space-y-3 max-h-[600px] overflow-y-auto">
                {rules.map((rule) => (
                  <AlertRuleCard key={rule.id} rule={rule} onEdit={handleEditRule} />
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-gray-500 mb-4">No alert rules configured</p>
                <button
                  onClick={() => setShowRuleBuilder(true)}
                  className="px-4 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700"
                >
                  Create First Rule
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Rule Builder Modal */}
      {showRuleBuilder && (
        <AlertRuleBuilder rule={editingRule || undefined} onClose={handleCloseBuilder} />
      )}
    </div>
  );
};
