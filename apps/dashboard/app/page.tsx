'use client';

import { useEffect, useState } from 'react';
import {
  TrendingUp,
  TrendingDown,
  Activity,
  Bell,
  Search,
  Wallet,
  BarChart3,
  Zap,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { botApi } from '@/lib/api';
import {
  formatCurrency,
  formatNumber,
  formatPercent,
  formatTimeAgo,
  getRiskColor,
  getRiskBgColor,
  shortenAddress,
} from '@/lib/utils';

interface Stats {
  tokenCount: number;
  winners: number;
  alertsToday: number;
  totalAnalyses: number;
  totalAlerts: number;
}

interface Discovery {
  mint: string;
  symbol: string;
  name: string;
  source: string;
  riskScore: number;
  riskLevel: string;
  timestamp: number;
  timeAgo: string;
}

interface Alert {
  type: string;
  title: string;
  description: string;
  emoji: string;
  timestamp: number;
  timeAgo: string;
}

interface Portfolio {
  totalValue: string;
  change: string;
  changePercent: string;
  tokenCount: number;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [discoveries, setDiscoveries] = useState<Discovery[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [statsData, discoveriesData, alertsData, portfolioData] = await Promise.all([
          botApi.getStats(),
          botApi.getDiscoveries(),
          botApi.getAlerts(),
          botApi.getPortfolio(),
        ]);

        setStats(statsData);
        setDiscoveries(discoveriesData.discoveries || []);
        setAlerts(alertsData.alerts || []);
        setPortfolio(portfolioData);
      } catch (error) {
        console.error('Failed to fetch dashboard data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span className="text-muted-foreground">Loading dashboard...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Portfolio Value</CardTitle>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {portfolio ? `$${portfolio.totalValue}` : '$0.00'}
            </div>
            <p className="text-xs text-muted-foreground">
              {portfolio && parseFloat(portfolio.changePercent) !== 0 && (
                <span className={parseFloat(portfolio.change) >= 0 ? 'text-green-500' : 'text-red-500'}>
                  {parseFloat(portfolio.change) >= 0 ? '+' : ''}{portfolio.changePercent}%
                </span>
              )}
              {' '}{portfolio?.tokenCount || 0} tokens
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Watchlist</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.tokenCount || 0}</div>
            <p className="text-xs text-muted-foreground">
              <span className="text-green-500">{stats?.winners || 0} winners</span>
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Alerts Today</CardTitle>
            <Bell className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.alertsToday || 0}</div>
            <p className="text-xs text-muted-foreground">
              {stats?.totalAlerts || 0} total alerts
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Analyses</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(stats?.totalAnalyses || 0, 0)}</div>
            <p className="text-xs text-muted-foreground">
              tokens analyzed
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent Discoveries */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Search className="h-5 w-5" />
              Recent Discoveries
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {discoveries.length === 0 ? (
                <p className="text-sm text-muted-foreground">No recent discoveries</p>
              ) : (
                discoveries.slice(0, 5).map((discovery, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded-lg bg-secondary/50 p-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/20 text-primary">
                        <Zap className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="font-medium">{discovery.symbol}</div>
                        <div className="text-xs text-muted-foreground">
                          {discovery.source} | {shortenAddress(discovery.mint)}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <Badge
                        className={getRiskBgColor(discovery.riskLevel)}
                        variant="outline"
                      >
                        {discovery.riskLevel}
                      </Badge>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {discovery.timeAgo}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* Recent Alerts */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5" />
              Recent Alerts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {alerts.length === 0 ? (
                <p className="text-sm text-muted-foreground">No recent alerts</p>
              ) : (
                alerts.slice(0, 5).map((alert, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 rounded-lg bg-secondary/50 p-3"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/20 text-2xl">
                      {alert.emoji || '🔔'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{alert.title}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {alert.description}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {alert.timeAgo}
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-4">
            <button className="flex flex-col items-center gap-2 rounded-lg bg-secondary p-4 hover:bg-secondary/80 transition-colors">
              <Search className="h-6 w-6 text-primary" />
              <span className="text-sm font-medium">Scan New Tokens</span>
            </button>
            <button className="flex flex-col items-center gap-2 rounded-lg bg-secondary p-4 hover:bg-secondary/80 transition-colors">
              <Activity className="h-6 w-6 text-green-500" />
              <span className="text-sm font-medium">View Trending</span>
            </button>
            <button className="flex flex-col items-center gap-2 rounded-lg bg-secondary p-4 hover:bg-secondary/80 transition-colors">
              <BarChart3 className="h-6 w-6 text-blue-500" />
              <span className="text-sm font-medium">Run Backtest</span>
            </button>
            <button className="flex flex-col items-center gap-2 rounded-lg bg-secondary p-4 hover:bg-secondary/80 transition-colors">
              <Bell className="h-6 w-6 text-yellow-500" />
              <span className="text-sm font-medium">Configure Alerts</span>
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
