'use client';

import { useEffect, useState } from 'react';
import { Bell, Filter, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { botApi } from '@/lib/api';
import { getSupabase, subscribeToAlerts } from '@/lib/supabase';

interface Alert {
  type: string;
  title: string;
  description: string;
  emoji: string;
  timestamp: number;
  timeAgo: string;
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    const fetchAlerts = async () => {
      try {
        const data = await botApi.getAlerts();
        setAlerts(data.alerts || []);
      } catch (error) {
        console.error('Failed to fetch alerts:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchAlerts();

    const channel = subscribeToAlerts((payload) => {
      const newAlert = payload.new as any;
      setAlerts(prev => [{
        type: newAlert.alert_type,
        title: newAlert.title || newAlert.symbol || 'Alert',
        description: newAlert.description || '',
        emoji: '🔔',
        timestamp: new Date(newAlert.sent_at).getTime(),
        timeAgo: 'Just now',
      }, ...prev].slice(0, 100));
    });

    return () => {
      const client = getSupabase();
      if (client && channel) {
        client.removeChannel(channel);
      }
    };
  }, []);

  const alertTypes = ['all', 'new_token', 'volume_spike', 'whale_movement', 'price_alert'];

  const filteredAlerts = filter === 'all'
    ? alerts
    : alerts.filter(a => a.type === filter);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Alert History</h1>
          <p className="text-muted-foreground">View past alerts and notifications</p>
        </div>
        <Button onClick={() => window.location.reload()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      <Card>
        <CardContent className="py-4">
          <div className="flex gap-2 flex-wrap">
            {alertTypes.map((type) => (
              <Button
                key={type}
                variant={filter === type ? 'default' : 'secondary'}
                size="sm"
                onClick={() => setFilter(type)}
              >
                {type === 'all' ? 'All' : type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
        <span>Live updates enabled</span>
      </div>

      <Card>
        <CardContent className="py-4">
          {loading ? (
            <div className="py-8 text-center text-muted-foreground">Loading alerts...</div>
          ) : filteredAlerts.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              <Bell className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No alerts found</p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredAlerts.map((alert, i) => (
                <div
                  key={i}
                  className="flex items-center gap-4 rounded-lg bg-secondary/50 p-4"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/20 text-2xl">
                    {alert.emoji || '🔔'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{alert.title}</span>
                      <Badge variant="outline" className="text-xs">
                        {alert.type}
                      </Badge>
                    </div>
                    <div className="text-sm text-muted-foreground truncate">
                      {alert.description}
                    </div>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {alert.timeAgo}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
