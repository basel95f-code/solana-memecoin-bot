'use client';

import { useEffect, useState } from 'react';
import { Bell, Search, Activity } from 'lucide-react';
import { cn, getStatusColor } from '@/lib/utils';
import { botApi } from '@/lib/api';

interface BotHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime: string;
  memory: {
    heapUsedMB: number;
  };
}

export function Header() {
  const [health, setHealth] = useState<BotHealth | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const fetchHealth = async () => {
      try {
        const data = await botApi.getHealth();
        setHealth(data);
      } catch (error) {
        setHealth({
          status: 'unhealthy',
          uptime: '0m',
          memory: { heapUsedMB: 0 },
        });
      }
    };

    fetchHealth();
    const interval = setInterval(fetchHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="flex h-16 items-center justify-between border-b border-border bg-background px-6">
      {/* Search */}
      <div className="relative w-96">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search tokens, wallets, or addresses..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="h-10 w-full rounded-lg bg-secondary pl-10 pr-4 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-primary"
        />
      </div>

      {/* Right side */}
      <div className="flex items-center gap-4">
        {/* Bot Status */}
        <div className="flex items-center gap-2 rounded-lg bg-secondary px-3 py-2">
          <div
            className={cn(
              'h-2 w-2 rounded-full',
              health ? getStatusColor(health.status) : 'bg-gray-500'
            )}
          />
          <span className="text-sm font-medium">
            {health?.status || 'Loading...'}
          </span>
          {health && (
            <span className="text-xs text-muted-foreground">
              {health.uptime} | {health.memory.heapUsedMB}MB
            </span>
          )}
        </div>

        {/* Notifications */}
        <button className="relative rounded-lg p-2 hover:bg-secondary">
          <Bell className="h-5 w-5" />
          <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
            3
          </span>
        </button>

        {/* Activity */}
        <button className="rounded-lg p-2 hover:bg-secondary">
          <Activity className="h-5 w-5" />
        </button>
      </div>
    </header>
  );
}
