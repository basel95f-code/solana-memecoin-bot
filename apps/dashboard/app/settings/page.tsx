'use client';

import { useEffect, useState } from 'react';
import { Settings, Bell, Filter, Wallet, Shield, Save } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { botApi } from '@/lib/api';

interface FilterSettings {
  profile: string;
  minLiquidity: number;
  maxTop10Percent: number;
  minHolders: number;
  minRiskScore: number;
  alertsEnabled: boolean;
}

const PROFILES = [
  { value: 'sniper', label: 'Sniper', description: 'Catch tokens at birth' },
  { value: 'early', label: 'Early', description: 'Early entry with basic safety' },
  { value: 'balanced', label: 'Balanced', description: 'Default moderate risk' },
  { value: 'conservative', label: 'Conservative', description: 'Safe, established tokens' },
  { value: 'degen', label: 'Degen', description: 'Alert on everything' },
];

export default function SettingsPage() {
  const [settings, setSettings] = useState<FilterSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const data = await botApi.getSettings();
        setSettings(data.filters);
      } catch (error) {
        console.error('Failed to fetch settings:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchSettings();
  }, []);

  const handleProfileChange = async (profile: string) => {
    try {
      await botApi.sendCommand('setProfile', { profile });
      setSettings(prev => prev ? { ...prev, profile } : null);
    } catch (error) {
      console.error('Failed to change profile:', error);
    }
  };

  const handleToggleAlerts = async () => {
    if (!settings) return;

    try {
      await botApi.sendCommand('toggleAlerts', { enabled: !settings.alertsEnabled });
      setSettings(prev => prev ? { ...prev, alertsEnabled: !prev.alertsEnabled } : null);
    } catch (error) {
      console.error('Failed to toggle alerts:', error);
    }
  };

  const handleSaveSettings = async () => {
    if (!settings) return;

    setSaving(true);
    try {
      await botApi.updateSettings({ filters: settings });
      alert('Settings saved!');
    } catch (error) {
      console.error('Failed to save settings:', error);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted-foreground">Loading settings...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-muted-foreground">Configure your bot preferences</p>
        </div>
        <Button onClick={handleSaveSettings} disabled={saving}>
          <Save className="h-4 w-4 mr-2" />
          {saving ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>

      {/* Filter Profile */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="h-5 w-5" />
            Filter Profile
          </CardTitle>
          <CardDescription>
            Choose a preset filter profile or customize your own
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {PROFILES.map((profile) => (
              <button
                key={profile.value}
                onClick={() => handleProfileChange(profile.value)}
                className={`rounded-lg border p-4 text-left transition-colors ${
                  settings?.profile === profile.value
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:border-primary/50'
                }`}
              >
                <div className="font-semibold">{profile.label}</div>
                <div className="text-sm text-muted-foreground">{profile.description}</div>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Alert Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Alert Settings
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">Enable Alerts</div>
              <div className="text-sm text-muted-foreground">
                Receive Telegram notifications for new discoveries
              </div>
            </div>
            <button
              onClick={handleToggleAlerts}
              className={`relative h-6 w-11 rounded-full transition-colors ${
                settings?.alertsEnabled ? 'bg-primary' : 'bg-secondary'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                  settings?.alertsEnabled ? 'translate-x-5' : ''
                }`}
              />
            </button>
          </div>
        </CardContent>
      </Card>

      {/* Filter Parameters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Filter Parameters
          </CardTitle>
          <CardDescription>
            Fine-tune your token filtering criteria
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <label className="text-sm font-medium mb-2 block">
                Min Liquidity (USD)
              </label>
              <input
                type="number"
                value={settings?.minLiquidity || 0}
                onChange={(e) =>
                  setSettings(prev =>
                    prev ? { ...prev, minLiquidity: parseInt(e.target.value) } : null
                  )
                }
                className="h-10 w-full rounded-lg bg-secondary px-4 text-sm outline-none"
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">
                Max Top 10 Holders (%)
              </label>
              <input
                type="number"
                value={settings?.maxTop10Percent || 0}
                onChange={(e) =>
                  setSettings(prev =>
                    prev ? { ...prev, maxTop10Percent: parseInt(e.target.value) } : null
                  )
                }
                className="h-10 w-full rounded-lg bg-secondary px-4 text-sm outline-none"
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">
                Min Holders
              </label>
              <input
                type="number"
                value={settings?.minHolders || 0}
                onChange={(e) =>
                  setSettings(prev =>
                    prev ? { ...prev, minHolders: parseInt(e.target.value) } : null
                  )
                }
                className="h-10 w-full rounded-lg bg-secondary px-4 text-sm outline-none"
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">
                Min Risk Score
              </label>
              <input
                type="number"
                value={settings?.minRiskScore || 0}
                onChange={(e) =>
                  setSettings(prev =>
                    prev ? { ...prev, minRiskScore: parseInt(e.target.value) } : null
                  )
                }
                className="h-10 w-full rounded-lg bg-secondary px-4 text-sm outline-none"
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
