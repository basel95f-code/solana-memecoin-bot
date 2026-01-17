'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Search, Filter, RefreshCw, ExternalLink, Plus, Zap } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { botApi } from '@/lib/api';
import { getSupabase, subscribeToDiscoveries } from '@/lib/supabase';
import {
  formatCurrency,
  formatNumber,
  formatTimeAgo,
  getRiskColor,
  getRiskBgColor,
  shortenAddress,
} from '@/lib/utils';

interface Discovery {
  mint: string;
  symbol: string;
  name: string;
  source: string;
  riskScore: number;
  riskLevel: string;
  liquidity?: number;
  holders?: number;
  priceUsd?: number;
  timestamp: number;
  timeAgo: string;
}

export default function DiscoveriesPage() {
  const [discoveries, setDiscoveries] = useState<Discovery[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const fetchDiscoveries = async () => {
      try {
        const data = await botApi.getDiscoveries();
        setDiscoveries(data.discoveries || []);
      } catch (error) {
        console.error('Failed to fetch discoveries:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchDiscoveries();

    // Subscribe to real-time updates
    const channel = subscribeToDiscoveries((payload) => {
      const newDiscovery = payload.new as any;
      setDiscoveries(prev => [{
        mint: newDiscovery.token_mint,
        symbol: newDiscovery.symbol || 'NEW',
        name: newDiscovery.name || 'New Token',
        source: newDiscovery.source,
        riskScore: 0,
        riskLevel: 'UNKNOWN',
        liquidity: newDiscovery.initial_liquidity_usd,
        timestamp: new Date(newDiscovery.discovered_at).getTime(),
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

  const filteredDiscoveries = discoveries.filter(d => {
    if (filter !== 'all' && d.source !== filter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return d.symbol.toLowerCase().includes(q) ||
             d.name.toLowerCase().includes(q) ||
             d.mint.toLowerCase().includes(q);
    }
    return true;
  });

  const handleAddToWatchlist = async (discovery: Discovery) => {
    try {
      await botApi.addToWatchlist(
        discovery.mint,
        discovery.symbol,
        discovery.name,
        discovery.priceUsd
      );
    } catch (error) {
      console.error('Failed to add to watchlist:', error);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Discoveries</h1>
          <p className="text-muted-foreground">Real-time token discovery feed</p>
        </div>
        <Button onClick={() => window.location.reload()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap gap-4">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search by symbol, name, or address..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-10 w-full rounded-lg bg-secondary pl-10 pr-4 text-sm outline-none"
              />
            </div>

            <div className="flex gap-2">
              {['all', 'raydium', 'pumpfun', 'pumpswap', 'jupiter'].map((source) => (
                <Button
                  key={source}
                  variant={filter === source ? 'default' : 'secondary'}
                  size="sm"
                  onClick={() => setFilter(source)}
                >
                  {source === 'all' ? 'All Sources' : source.charAt(0).toUpperCase() + source.slice(1)}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Live indicator */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
        <span>Live updates enabled</span>
        <span className="text-xs">({filteredDiscoveries.length} discoveries)</span>
      </div>

      {/* Discoveries List */}
      <div className="space-y-3">
        {loading ? (
          <Card>
            <CardContent className="py-8 text-center">
              <div className="flex items-center justify-center gap-2">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                <span>Loading discoveries...</span>
              </div>
            </CardContent>
          </Card>
        ) : filteredDiscoveries.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center">
              <p className="text-muted-foreground">No discoveries found</p>
            </CardContent>
          </Card>
        ) : (
          filteredDiscoveries.map((discovery, i) => (
            <Card key={`${discovery.mint}-${i}`} className="animate-slide-up">
              <CardContent className="py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/20 text-primary">
                      <Zap className="h-6 w-6" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/discoveries/${discovery.mint}`}
                          className="font-semibold hover:text-primary"
                        >
                          {discovery.symbol}
                        </Link>
                        <Badge variant="outline" className="text-xs">
                          {discovery.source}
                        </Badge>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {discovery.name}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {shortenAddress(discovery.mint)}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-6">
                    {discovery.liquidity && (
                      <div className="text-right">
                        <div className="text-sm font-medium">
                          {formatCurrency(discovery.liquidity)}
                        </div>
                        <div className="text-xs text-muted-foreground">Liquidity</div>
                      </div>
                    )}

                    <div className="text-right">
                      <Badge className={getRiskBgColor(discovery.riskLevel)}>
                        Score: {discovery.riskScore}
                      </Badge>
                      <div className="text-xs text-muted-foreground mt-1">
                        {discovery.riskLevel}
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="text-sm text-muted-foreground">
                        {discovery.timeAgo}
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleAddToWatchlist(discovery)}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" asChild>
                        <a
                          href={`https://solscan.io/token/${discovery.mint}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
