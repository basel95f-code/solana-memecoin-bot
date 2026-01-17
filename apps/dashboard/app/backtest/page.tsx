'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { TestTube2, Play, TrendingUp, TrendingDown, Clock, BarChart3 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { botApi } from '@/lib/api';
import {
  formatCurrency,
  formatPercent,
  formatNumber,
} from '@/lib/utils';

interface Strategy {
  id: number;
  name: string;
  description: string;
  isPreset: boolean;
}

interface BacktestRun {
  id: number;
  strategyName: string;
  totalTrades: number;
  winRate: number;
  totalReturn: number;
  maxDrawdown: number;
  sharpeRatio: number;
  executedAt: number;
}

export default function BacktestPage() {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [runs, setRuns] = useState<BacktestRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedStrategy, setSelectedStrategy] = useState<string>('');

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [strategiesData, runsData] = await Promise.all([
          botApi.getStrategies(),
          botApi.getBacktestRuns(10),
        ]);
        setStrategies(strategiesData.strategies || []);
        setRuns(runsData.runs || []);
      } catch (error) {
        console.error('Failed to fetch backtest data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const handleRunBacktest = async () => {
    if (!selectedStrategy) return;

    try {
      await botApi.triggerBacktest(selectedStrategy, 7, 10000);
      alert('Backtest queued successfully!');
    } catch (error) {
      console.error('Failed to trigger backtest:', error);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Backtesting</h1>
        <p className="text-muted-foreground">Test trading strategies against historical data</p>
      </div>

      {/* Run Backtest */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TestTube2 className="h-5 w-5" />
            Run New Backtest
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 items-end">
            <div className="flex-1">
              <label className="text-sm font-medium mb-2 block">Strategy</label>
              <select
                value={selectedStrategy}
                onChange={(e) => setSelectedStrategy(e.target.value)}
                className="w-full h-10 rounded-lg bg-secondary px-4 text-sm outline-none"
              >
                <option value="">Select a strategy...</option>
                {strategies.map((s) => (
                  <option key={s.id} value={s.name}>
                    {s.name} {s.isPreset && '(Preset)'}
                  </option>
                ))}
              </select>
            </div>
            <Button onClick={handleRunBacktest} disabled={!selectedStrategy}>
              <Play className="h-4 w-4 mr-2" />
              Run Backtest
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Strategies */}
      <Card>
        <CardHeader>
          <CardTitle>Available Strategies</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-8 text-center text-muted-foreground">Loading strategies...</div>
          ) : strategies.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">No strategies found</div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {strategies.map((strategy) => (
                <div
                  key={strategy.id}
                  className="rounded-lg border border-border bg-secondary/50 p-4"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-semibold">{strategy.name}</div>
                    {strategy.isPreset && (
                      <Badge variant="secondary">Preset</Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">{strategy.description}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Runs */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Recent Backtest Runs
          </CardTitle>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">No backtest runs yet</div>
          ) : (
            <div className="space-y-4">
              {runs.map((run) => (
                <Link
                  key={run.id}
                  href={`/backtest/${run.id}`}
                  className="flex items-center justify-between rounded-lg bg-secondary/50 p-4 hover:bg-secondary transition-colors"
                >
                  <div>
                    <div className="font-semibold">{run.strategyName}</div>
                    <div className="text-sm text-muted-foreground">
                      {run.totalTrades} trades | {new Date(run.executedAt * 1000).toLocaleDateString()}
                    </div>
                  </div>

                  <div className="flex items-center gap-6">
                    <div className="text-center">
                      <div className={run.totalReturn >= 0 ? 'text-green-500' : 'text-red-500'}>
                        {formatPercent(run.totalReturn)}
                      </div>
                      <div className="text-xs text-muted-foreground">Return</div>
                    </div>

                    <div className="text-center">
                      <div>{run.winRate.toFixed(1)}%</div>
                      <div className="text-xs text-muted-foreground">Win Rate</div>
                    </div>

                    <div className="text-center">
                      <div className="text-red-500">{run.maxDrawdown.toFixed(1)}%</div>
                      <div className="text-xs text-muted-foreground">Max DD</div>
                    </div>

                    <div className="text-center">
                      <div>{run.sharpeRatio.toFixed(2)}</div>
                      <div className="text-xs text-muted-foreground">Sharpe</div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
