'use client';

import { useEffect, useState } from 'react';
import { Coins, TrendingUp, TrendingDown, Trash2, ExternalLink, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { botApi } from '@/lib/api';
import {
  formatCurrency,
  formatPercent,
  formatPrice,
  formatTimeAgo,
  shortenAddress,
  getPriceChangeColor,
} from '@/lib/utils';

interface WatchedToken {
  mint: string;
  symbol: string;
  name: string;
  price: number;
  priceChange: number;
  addedAt: number;
  addedPrice: number;
}

export default function WatchlistPage() {
  const [tokens, setTokens] = useState<WatchedToken[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchWatchlist = async () => {
    try {
      const data = await botApi.getWatchlist();
      setTokens(data.tokens || []);
    } catch (error) {
      console.error('Failed to fetch watchlist:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWatchlist();
    const interval = setInterval(fetchWatchlist, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleRemove = async (mint: string) => {
    try {
      await botApi.removeFromWatchlist(mint);
      setTokens(prev => prev.filter(t => t.mint !== mint));
    } catch (error) {
      console.error('Failed to remove from watchlist:', error);
    }
  };

  const winners = tokens.filter(t => t.priceChange > 0);
  const losers = tokens.filter(t => t.priceChange < 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Watchlist</h1>
          <p className="text-muted-foreground">Track your favorite tokens</p>
        </div>
        <Button onClick={fetchWatchlist}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Tokens</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{tokens.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-green-500 flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Winners
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-500">{winners.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-red-500 flex items-center gap-2">
              <TrendingDown className="h-4 w-4" />
              Losers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-500">{losers.length}</div>
          </CardContent>
        </Card>
      </div>

      {/* Token List */}
      <Card>
        <CardHeader>
          <CardTitle>Your Tokens</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-8 text-center">
              <div className="flex items-center justify-center gap-2">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                <span>Loading watchlist...</span>
              </div>
            </div>
          ) : tokens.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              <Coins className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No tokens in your watchlist</p>
              <p className="text-sm">Add tokens from the Discoveries page</p>
            </div>
          ) : (
            <div className="space-y-4">
              {tokens.map((token) => (
                <div
                  key={token.mint}
                  className="flex items-center justify-between rounded-lg bg-secondary/50 p-4"
                >
                  <div className="flex items-center gap-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/20">
                      <Coins className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <div className="font-semibold">{token.symbol}</div>
                      <div className="text-sm text-muted-foreground">{token.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {shortenAddress(token.mint)}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-8">
                    <div className="text-right">
                      <div className="font-medium">{formatPrice(token.price)}</div>
                      <div className={`text-sm ${getPriceChangeColor(token.priceChange)}`}>
                        {formatPercent(token.priceChange)}
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="text-sm text-muted-foreground">Entry</div>
                      <div className="text-sm">{formatPrice(token.addedPrice)}</div>
                    </div>

                    <div className="text-right">
                      <div className="text-sm text-muted-foreground">Added</div>
                      <div className="text-sm">{formatTimeAgo(token.addedAt)}</div>
                    </div>

                    <div className="flex gap-2">
                      <Button variant="ghost" size="icon" asChild>
                        <a
                          href={`https://dexscreener.com/solana/${token.mint}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRemove(token.mint)}
                        className="text-red-500 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
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
