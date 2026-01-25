import { useState } from 'react';
import { X } from 'lucide-react';
import { AlertRule } from '@/api/alerts';
import { useCreateAlertRule, useUpdateAlertRule } from '@/hooks/useAlerts';
import { cn } from '@/utils/cn';

interface AlertRuleBuilderProps {
  rule?: AlertRule;
  onClose: () => void;
  onSave?: () => void;
}

export const AlertRuleBuilder = ({ rule, onClose, onSave }: AlertRuleBuilderProps) => {
  const [formData, setFormData] = useState<Omit<AlertRule, 'id' | 'created_at'>>({
    name: rule?.name || '',
    enabled: rule?.enabled ?? true,
    conditions: {
      type: rule?.conditions.type || 'new_token',
      riskScoreMin: rule?.conditions.riskScoreMin,
      riskScoreMax: rule?.conditions.riskScoreMax,
      liquidityMin: rule?.conditions.liquidityMin,
      patternType: rule?.conditions.patternType,
      priceChangePercent: rule?.conditions.priceChangePercent,
      volumeMultiplier: rule?.conditions.volumeMultiplier,
    },
    actions: {
      telegram: rule?.actions.telegram ?? true,
      email: rule?.actions.email ?? false,
      discord: rule?.actions.discord ?? false,
    },
  });

  const createMutation = useCreateAlertRule();
  const updateMutation = useUpdateAlertRule();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      if (rule?.id) {
        await updateMutation.mutateAsync({ ruleId: rule.id, updates: formData });
      } else {
        await createMutation.mutateAsync(formData);
      }
      onSave?.();
      onClose();
    } catch (error) {
      console.error('Failed to save alert rule:', error);
    }
  };

  const updateCondition = (key: string, value: any) => {
    setFormData((prev) => ({
      ...prev,
      conditions: { ...prev.conditions, [key]: value },
    }));
  };

  const updateAction = (key: string, value: boolean) => {
    setFormData((prev) => ({
      ...prev,
      actions: { ...prev.actions, [key]: value },
    }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div className="w-full max-w-2xl rounded-xl border border-gray-800 bg-gray-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-800 p-6">
          <h2 className="text-xl font-bold text-white">
            {rule ? 'Edit Alert Rule' : 'Create Alert Rule'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Rule Name */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Rule Name
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-4 py-2 rounded-lg border border-gray-700 bg-gray-800 text-white focus:border-blue-500 focus:outline-none"
              placeholder="e.g., High Risk New Tokens"
              required
            />
          </div>

          {/* Condition Type */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Trigger Type
            </label>
            <select
              value={formData.conditions.type}
              onChange={(e) => updateCondition('type', e.target.value)}
              className="w-full px-4 py-2 rounded-lg border border-gray-700 bg-gray-800 text-white focus:border-blue-500 focus:outline-none"
            >
              <option value="new_token">🆕 New Token Discovered</option>
              <option value="smart_money">💎 Smart Money Activity</option>
              <option value="pattern_match">🧠 Pattern Match</option>
              <option value="price_change">📈 Price Change</option>
              <option value="volume_spike">📊 Volume Spike</option>
            </select>
          </div>

          {/* Conditional Fields */}
          <div className="grid grid-cols-2 gap-4">
            {/* Risk Score Min */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Min Risk Score
              </label>
              <input
                type="number"
                min="0"
                max="100"
                value={formData.conditions.riskScoreMin || ''}
                onChange={(e) => updateCondition('riskScoreMin', e.target.value ? Number(e.target.value) : undefined)}
                className="w-full px-4 py-2 rounded-lg border border-gray-700 bg-gray-800 text-white focus:border-blue-500 focus:outline-none"
                placeholder="0-100"
              />
            </div>

            {/* Risk Score Max */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Max Risk Score
              </label>
              <input
                type="number"
                min="0"
                max="100"
                value={formData.conditions.riskScoreMax || ''}
                onChange={(e) => updateCondition('riskScoreMax', e.target.value ? Number(e.target.value) : undefined)}
                className="w-full px-4 py-2 rounded-lg border border-gray-700 bg-gray-800 text-white focus:border-blue-500 focus:outline-none"
                placeholder="0-100"
              />
            </div>

            {/* Min Liquidity */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Min Liquidity ($)
              </label>
              <input
                type="number"
                min="0"
                value={formData.conditions.liquidityMin || ''}
                onChange={(e) => updateCondition('liquidityMin', e.target.value ? Number(e.target.value) : undefined)}
                className="w-full px-4 py-2 rounded-lg border border-gray-700 bg-gray-800 text-white focus:border-blue-500 focus:outline-none"
                placeholder="e.g., 10000"
              />
            </div>

            {/* Pattern Type */}
            {formData.conditions.type === 'pattern_match' && (
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Pattern Type
                </label>
                <select
                  value={formData.conditions.patternType || ''}
                  onChange={(e) => updateCondition('patternType', e.target.value || undefined)}
                  className="w-full px-4 py-2 rounded-lg border border-gray-700 bg-gray-800 text-white focus:border-blue-500 focus:outline-none"
                >
                  <option value="">Any</option>
                  <option value="success">Success</option>
                  <option value="rug">Rug</option>
                </select>
              </div>
            )}

            {/* Price Change % */}
            {formData.conditions.type === 'price_change' && (
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Price Change %
                </label>
                <input
                  type="number"
                  value={formData.conditions.priceChangePercent || ''}
                  onChange={(e) => updateCondition('priceChangePercent', e.target.value ? Number(e.target.value) : undefined)}
                  className="w-full px-4 py-2 rounded-lg border border-gray-700 bg-gray-800 text-white focus:border-blue-500 focus:outline-none"
                  placeholder="e.g., 50"
                />
              </div>
            )}

            {/* Volume Multiplier */}
            {formData.conditions.type === 'volume_spike' && (
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Volume Multiplier
                </label>
                <input
                  type="number"
                  min="1"
                  step="0.1"
                  value={formData.conditions.volumeMultiplier || ''}
                  onChange={(e) => updateCondition('volumeMultiplier', e.target.value ? Number(e.target.value) : undefined)}
                  className="w-full px-4 py-2 rounded-lg border border-gray-700 bg-gray-800 text-white focus:border-blue-500 focus:outline-none"
                  placeholder="e.g., 5"
                />
              </div>
            )}
          </div>

          {/* Notification Channels */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-3">
              Notification Channels
            </label>
            <div className="space-y-2">
              <label className="flex items-center gap-3 p-3 rounded-lg border border-gray-700 bg-gray-800/50 cursor-pointer hover:bg-gray-800">
                <input
                  type="checkbox"
                  checked={formData.actions.telegram || false}
                  onChange={(e) => updateAction('telegram', e.target.checked)}
                  className="w-4 h-4 rounded border-gray-600 text-blue-600 focus:ring-blue-500 focus:ring-offset-gray-900"
                />
                <span className="text-sm text-white">Telegram</span>
              </label>

              <label className="flex items-center gap-3 p-3 rounded-lg border border-gray-700 bg-gray-800/50 cursor-pointer hover:bg-gray-800">
                <input
                  type="checkbox"
                  checked={formData.actions.email || false}
                  onChange={(e) => updateAction('email', e.target.checked)}
                  className="w-4 h-4 rounded border-gray-600 text-blue-600 focus:ring-blue-500 focus:ring-offset-gray-900"
                />
                <span className="text-sm text-white">Email</span>
              </label>

              <label className="flex items-center gap-3 p-3 rounded-lg border border-gray-700 bg-gray-800/50 cursor-pointer hover:bg-gray-800">
                <input
                  type="checkbox"
                  checked={formData.actions.discord || false}
                  onChange={(e) => updateAction('discord', e.target.checked)}
                  className="w-4 h-4 rounded border-gray-600 text-blue-600 focus:ring-blue-500 focus:ring-offset-gray-900"
                />
                <span className="text-sm text-white">Discord</span>
              </label>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending || updateMutation.isPending}
              className={cn(
                'px-4 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors',
                (createMutation.isPending || updateMutation.isPending) && 'opacity-50 cursor-not-allowed'
              )}
            >
              {createMutation.isPending || updateMutation.isPending ? 'Saving...' : rule ? 'Update Rule' : 'Create Rule'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
