import { useState } from 'react';
import { Edit2, Trash2, Power, PowerOff } from 'lucide-react';
import { AlertRule } from '@/api/alerts';
import { useToggleAlertRule, useDeleteAlertRule } from '@/hooks/useAlerts';
import { cn } from '@/utils/cn';

interface AlertRuleCardProps {
  rule: AlertRule;
  onEdit: (rule: AlertRule) => void;
}

export const AlertRuleCard = ({ rule, onEdit }: AlertRuleCardProps) => {
  const [isDeleting, setIsDeleting] = useState(false);
  const toggleMutation = useToggleAlertRule();
  const deleteMutation = useDeleteAlertRule();

  const handleToggle = async () => {
    if (!rule.id) return;
    await toggleMutation.mutateAsync({ ruleId: rule.id, enabled: !rule.enabled });
  };

  const handleDelete = async () => {
    if (!rule.id || !confirm('Are you sure you want to delete this alert rule?')) return;
    setIsDeleting(true);
    await deleteMutation.mutateAsync(rule.id);
  };

  const getConditionLabel = (type: string) => {
    const labels: Record<string, string> = {
      new_token: '🆕 New Token',
      smart_money: '💎 Smart Money Activity',
      pattern_match: '🧠 Pattern Match',
      price_change: '📈 Price Change',
      volume_spike: '📊 Volume Spike',
    };
    return labels[type] || type;
  };

  const getConditionDetails = () => {
    const details: string[] = [];
    const c = rule.conditions;

    if (c.riskScoreMin !== undefined) details.push(`Risk Score ≥ ${c.riskScoreMin}`);
    if (c.riskScoreMax !== undefined) details.push(`Risk Score ≤ ${c.riskScoreMax}`);
    if (c.liquidityMin !== undefined) details.push(`Liquidity ≥ $${c.liquidityMin.toLocaleString()}`);
    if (c.patternType) details.push(`Pattern: ${c.patternType}`);
    if (c.priceChangePercent) details.push(`Price ${c.priceChangePercent > 0 ? '+' : ''}${c.priceChangePercent}%`);
    if (c.volumeMultiplier) details.push(`Volume ${c.volumeMultiplier}x`);

    return details.join(' • ');
  };

  return (
    <div
      className={cn(
        'rounded-lg border p-4 transition-all',
        rule.enabled
          ? 'border-blue-500/30 bg-blue-500/5'
          : 'border-gray-800 bg-gray-900/50 opacity-60'
      )}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-white">{rule.name}</h3>
            {rule.enabled ? (
              <span className="px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 text-xs font-medium">
                Active
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded-full bg-gray-500/20 text-gray-400 text-xs font-medium">
                Disabled
              </span>
            )}
          </div>
          <div className="text-sm text-gray-400">
            {getConditionLabel(rule.conditions.type)}
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={handleToggle}
            disabled={toggleMutation.isPending}
            className="p-2 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors"
            title={rule.enabled ? 'Disable' : 'Enable'}
          >
            {rule.enabled ? <Power className="h-4 w-4" /> : <PowerOff className="h-4 w-4" />}
          </button>
          <button
            onClick={() => onEdit(rule)}
            className="p-2 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-blue-400 transition-colors"
            title="Edit"
          >
            <Edit2 className="h-4 w-4" />
          </button>
          <button
            onClick={handleDelete}
            disabled={isDeleting || deleteMutation.isPending}
            className="p-2 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-red-400 transition-colors"
            title="Delete"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Condition Details */}
      <div className="text-xs text-gray-500 mb-3">
        {getConditionDetails() || 'No specific filters'}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 text-xs">
        <span className="text-gray-500">Notify via:</span>
        {rule.actions.telegram && (
          <span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-400">Telegram</span>
        )}
        {rule.actions.email && (
          <span className="px-2 py-0.5 rounded bg-purple-500/20 text-purple-400">Email</span>
        )}
        {rule.actions.discord && (
          <span className="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-400">Discord</span>
        )}
        {!rule.actions.telegram && !rule.actions.email && !rule.actions.discord && (
          <span className="text-gray-500">None</span>
        )}
      </div>
    </div>
  );
};
