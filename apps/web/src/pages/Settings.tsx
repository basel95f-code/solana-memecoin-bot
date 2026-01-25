import { useState } from 'react';
import { Save, Key, Bell, Database, Zap } from 'lucide-react';
import { cn } from '@/utils/cn';

export const Settings = () => {
  const [settings, setSettings] = useState({
    // API Settings
    apiUrl: import.meta.env.VITE_API_URL || 'http://localhost:3000',
    wsUrl: import.meta.env.VITE_WS_URL || 'ws://localhost:3000/ws',
    
    // Notification Settings
    enableTelegram: true,
    telegramChatId: '',
    enableEmail: false,
    emailAddress: '',
    enableDiscord: false,
    discordWebhook: '',
    
    // Monitoring Settings
    minLiquidity: 10000,
    maxRiskScore: 80,
    autoRefresh: true,
    refreshInterval: 10,
    
    // Performance
    enableWebSocket: true,
    cacheEnabled: true,
  });

  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    // Simulate save
    await new Promise((resolve) => setTimeout(resolve, 1000));
    localStorage.setItem('app_settings', JSON.stringify(settings));
    setIsSaving(false);
    alert('Settings saved!');
  };

  const updateSetting = (key: string, value: any) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Settings ⚙️</h1>
        <p className="text-gray-400">Configure your bot preferences and integrations</p>
      </div>

      <div className="space-y-6">
        {/* API Configuration */}
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
          <div className="flex items-center gap-2 mb-4">
            <Zap className="h-5 w-5 text-blue-400" />
            <h2 className="text-xl font-bold text-white">API Configuration</h2>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                API Base URL
              </label>
              <input
                type="text"
                value={settings.apiUrl}
                onChange={(e) => updateSetting('apiUrl', e.target.value)}
                className="w-full px-4 py-2 rounded-lg border border-gray-700 bg-gray-800 text-white focus:border-blue-500 focus:outline-none"
                placeholder="http://localhost:3000"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                WebSocket URL
              </label>
              <input
                type="text"
                value={settings.wsUrl}
                onChange={(e) => updateSetting('wsUrl', e.target.value)}
                className="w-full px-4 py-2 rounded-lg border border-gray-700 bg-gray-800 text-white focus:border-blue-500 focus:outline-none"
                placeholder="ws://localhost:3000/ws"
              />
            </div>
          </div>
        </div>

        {/* Notification Settings */}
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
          <div className="flex items-center gap-2 mb-4">
            <Bell className="h-5 w-5 text-yellow-400" />
            <h2 className="text-xl font-bold text-white">Notifications</h2>
          </div>

          <div className="space-y-4">
            {/* Telegram */}
            <div className="p-4 rounded-lg border border-gray-700 bg-gray-800/50">
              <label className="flex items-center justify-between mb-3 cursor-pointer">
                <span className="font-medium text-white">Telegram Notifications</span>
                <input
                  type="checkbox"
                  checked={settings.enableTelegram}
                  onChange={(e) => updateSetting('enableTelegram', e.target.checked)}
                  className="w-4 h-4 rounded border-gray-600 text-blue-600"
                />
              </label>
              {settings.enableTelegram && (
                <input
                  type="text"
                  value={settings.telegramChatId}
                  onChange={(e) => updateSetting('telegramChatId', e.target.value)}
                  className="w-full px-3 py-2 rounded border border-gray-600 bg-gray-700 text-white text-sm focus:border-blue-500 focus:outline-none"
                  placeholder="Chat ID"
                />
              )}
            </div>

            {/* Email */}
            <div className="p-4 rounded-lg border border-gray-700 bg-gray-800/50">
              <label className="flex items-center justify-between mb-3 cursor-pointer">
                <span className="font-medium text-white">Email Notifications</span>
                <input
                  type="checkbox"
                  checked={settings.enableEmail}
                  onChange={(e) => updateSetting('enableEmail', e.target.checked)}
                  className="w-4 h-4 rounded border-gray-600 text-blue-600"
                />
              </label>
              {settings.enableEmail && (
                <input
                  type="email"
                  value={settings.emailAddress}
                  onChange={(e) => updateSetting('emailAddress', e.target.value)}
                  className="w-full px-3 py-2 rounded border border-gray-600 bg-gray-700 text-white text-sm focus:border-blue-500 focus:outline-none"
                  placeholder="your@email.com"
                />
              )}
            </div>

            {/* Discord */}
            <div className="p-4 rounded-lg border border-gray-700 bg-gray-800/50">
              <label className="flex items-center justify-between mb-3 cursor-pointer">
                <span className="font-medium text-white">Discord Notifications</span>
                <input
                  type="checkbox"
                  checked={settings.enableDiscord}
                  onChange={(e) => updateSetting('enableDiscord', e.target.checked)}
                  className="w-4 h-4 rounded border-gray-600 text-blue-600"
                />
              </label>
              {settings.enableDiscord && (
                <input
                  type="text"
                  value={settings.discordWebhook}
                  onChange={(e) => updateSetting('discordWebhook', e.target.value)}
                  className="w-full px-3 py-2 rounded border border-gray-600 bg-gray-700 text-white text-sm focus:border-blue-500 focus:outline-none"
                  placeholder="Discord webhook URL"
                />
              )}
            </div>
          </div>
        </div>

        {/* Monitoring Settings */}
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
          <div className="flex items-center gap-2 mb-4">
            <Database className="h-5 w-5 text-purple-400" />
            <h2 className="text-xl font-bold text-white">Monitoring</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Min Liquidity ($)
              </label>
              <input
                type="number"
                value={settings.minLiquidity}
                onChange={(e) => updateSetting('minLiquidity', Number(e.target.value))}
                className="w-full px-4 py-2 rounded-lg border border-gray-700 bg-gray-800 text-white focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Max Risk Score
              </label>
              <input
                type="number"
                min="0"
                max="100"
                value={settings.maxRiskScore}
                onChange={(e) => updateSetting('maxRiskScore', Number(e.target.value))}
                className="w-full px-4 py-2 rounded-lg border border-gray-700 bg-gray-800 text-white focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.autoRefresh}
                  onChange={(e) => updateSetting('autoRefresh', e.target.checked)}
                  className="w-4 h-4 rounded border-gray-600 text-blue-600"
                />
                <span className="text-sm font-medium text-gray-300">Auto Refresh</span>
              </label>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Refresh Interval (seconds)
              </label>
              <input
                type="number"
                min="5"
                max="60"
                value={settings.refreshInterval}
                onChange={(e) => updateSetting('refreshInterval', Number(e.target.value))}
                disabled={!settings.autoRefresh}
                className="w-full px-4 py-2 rounded-lg border border-gray-700 bg-gray-800 text-white focus:border-blue-500 focus:outline-none disabled:opacity-50"
              />
            </div>
          </div>
        </div>

        {/* Performance */}
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
          <div className="flex items-center gap-2 mb-4">
            <Key className="h-5 w-5 text-green-400" />
            <h2 className="text-xl font-bold text-white">Performance</h2>
          </div>

          <div className="space-y-3">
            <label className="flex items-center justify-between p-3 rounded-lg border border-gray-700 bg-gray-800/50 cursor-pointer">
              <span className="font-medium text-white">Enable WebSocket</span>
              <input
                type="checkbox"
                checked={settings.enableWebSocket}
                onChange={(e) => updateSetting('enableWebSocket', e.target.checked)}
                className="w-4 h-4 rounded border-gray-600 text-blue-600"
              />
            </label>

            <label className="flex items-center justify-between p-3 rounded-lg border border-gray-700 bg-gray-800/50 cursor-pointer">
              <span className="font-medium text-white">Enable Caching</span>
              <input
                type="checkbox"
                checked={settings.cacheEnabled}
                onChange={(e) => updateSetting('cacheEnabled', e.target.checked)}
                className="w-4 h-4 rounded border-gray-600 text-blue-600"
              />
            </label>
          </div>
        </div>

        {/* Save Button */}
        <div className="flex items-center justify-end gap-3 pt-4">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className={cn(
              'flex items-center gap-2 px-6 py-3 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors',
              isSaving && 'opacity-50 cursor-not-allowed'
            )}
          >
            <Save className="h-4 w-4" />
            {isSaving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
};
