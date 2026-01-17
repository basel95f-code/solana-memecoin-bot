'use client';

import { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, Flame, Clock, Search, ExternalLink, BarChart3, Zap, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DexPair,
  BoostedToken,
  getTopSolanaPairs,
  getBoostedTokens,
  searchTokens,
  getChartEmbedUrl,
  getDexScreenerUrl,
  formatVolume,
  formatPrice,
  formatChange,
} from '@/lib/dexscreener';

type TabType = 'trending' | 'gainers' | 'volume' | 'new';

export default function MarketPage() {
  const [pairs, setPairs] = useState<DexPair[]>([]);
  const [boosted, setBoosted] = useState<BoostedToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabType>('trending');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<DexPair[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedPair, setSelectedPair] = useState<DexPair | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [pairsData, boostedData] = await Promise.all([
        getTopSolanaPairs(),
        getBoostedTokens(),
      ]);
      setPairs(pairsData);
      setBoosted(boostedData);
      if (pairsData.length > 0 && !selectedPair) {
        setSelectedPair(pairsData[0]);
      }
    } catch (error) {
      console.error('Failed to fetch market data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const results = await searchTokens(searchQuery);
      setSearchResults(results);
    } catch (error) {
      console.error('Search failed:', error);
    } finally {
      setSearching(false);
    }
  };

  const getFilteredPairs = () => {
    if (searchResults.length > 0) return searchResults;

    switch (activeTab) {
      case 'trending':
        // Sort by combination of volume and price change
        return [...pairs].sort((a, b) => {
          const scoreA = (a.volume?.h24 || 0) * Math.abs(a.priceChange?.h24 || 0);
          const scoreB = (b.volume?.h24 || 0) * Math.abs(b.priceChange?.h24 || 0);
          return scoreB - scoreA;
        });
      case 'gainers':
        return [...pairs].sort((a, b) => (b.priceChange?.h24 || 0) - (a.priceChange?.h24 || 0));
      case 'volume':
        return [...pairs].sort((a, b) => (b.volume?.h24 || 0) - (a.volume?.h24 || 0));
      case 'new':
        return [...pairs].sort((a, b) => (b.pairCreatedAt || 0) - (a.pairCreatedAt || 0));
      default:
        return pairs;
    }
  };

  const filteredPairs = getFilteredPairs();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Market</h1>
          <p className="text-muted-foreground">Live Solana token data from DexScreener</p>
        </div>
        <Button onClick={fetchData} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Boosted/Trending Banner */}
      {boosted.length > 0 && (
        <Card className="bg-gradient-to-r from-orange-500/10 to-yellow-500/10 border-orange-500/20">
          <CardContent className="py-4">
            <div className="flex items-center gap-2 mb-3">
              <Flame className="h-5 w-5 text-orange-500" />
              <span className="font-semibold text-orange-500">Hot Tokens</span>
            </div>
            <div className="flex gap-3 overflow-x-auto pb-2">
              {boosted.slice(0, 10).map((token, i) => (
                <a
                  key={i}
                  href={token.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-3 py-2 rounded-lg bg-background/50 hover:bg-background transition-colors shrink-0"
                >
                  {token.icon && (
                    <img src={token.icon} alt="" className="h-6 w-6 rounded-full" />
                  )}
                  <span className="font-medium">{token.symbol || 'Unknown'}</span>
                </a>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Search */}
      <Card>
        <CardContent className="py-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search tokens by name, symbol, or address..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  if (!e.target.value) setSearchResults([]);
                }}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                className="h-10 w-full rounded-lg bg-secondary pl-10 pr-4 text-sm outline-none"
              />
            </div>
            <Button onClick={handleSearch} disabled={searching}>
              {searching ? 'Searching...' : 'Search'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Token List */}
        <div className="lg:col-span-1 space-y-4">
          {/* Tabs */}
          <div className="flex gap-2 flex-wrap">
            {[
              { id: 'trending', label: 'Trending', icon: Flame },
              { id: 'gainers', label: 'Gainers', icon: TrendingUp },
              { id: 'volume', label: 'Volume', icon: BarChart3 },
              { id: 'new', label: 'New', icon: Clock },
            ].map(({ id, label, icon: Icon }) => (
              <Button
                key={id}
                variant={activeTab === id && searchResults.length === 0 ? 'default' : 'secondary'}
                size="sm"
                onClick={() => {
                  setActiveTab(id as TabType);
                  setSearchResults([]);
                }}
              >
                <Icon className="h-4 w-4 mr-1" />
                {label}
              </Button>
            ))}
          </div>

          {/* Token List */}
          <Card>
            <CardContent className="p-0 max-h-[600px] overflow-y-auto">
              {loading ? (
                <div className="p-8 text-center text-muted-foreground">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent mx-auto mb-2" />
                  Loading market data...
                </div>
              ) : filteredPairs.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  No tokens found
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {filteredPairs.slice(0, 30).map((pair, i) => (
                    <div
                      key={pair.pairAddress}
                      className={`p-3 cursor-pointer hover:bg-secondary/50 transition-colors ${
                        selectedPair?.pairAddress === pair.pairAddress ? 'bg-secondary' : ''
                      }`}
                      onClick={() => setSelectedPair(pair)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="text-xs text-muted-foreground w-5">{i + 1}</span>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold truncate">
                                {pair.baseToken.symbol}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                /{pair.quoteToken.symbol}
                              </span>
                            </div>
                            <div className="text-xs text-muted-foreground truncate">
                              {pair.baseToken.name}
                            </div>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-medium">
                            {formatPrice(pair.priceUsd)}
                          </div>
                          <div className={`text-xs ${
                            (pair.priceChange?.h24 || 0) >= 0
                              ? 'text-green-500'
                              : 'text-red-500'
                          }`}>
                            {formatChange(pair.priceChange?.h24 || 0)}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                        <span>Vol: {formatVolume(pair.volume?.h24 || 0)}</span>
                        <span>Liq: {formatVolume(pair.liquidity?.usd || 0)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Chart and Details */}
        <div className="lg:col-span-2 space-y-4">
          {selectedPair ? (
            <>
              {/* Token Header */}
              <Card>
                <CardContent className="py-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-3">
                        <h2 className="text-xl font-bold">{selectedPair.baseToken.symbol}</h2>
                        <Badge variant="outline">{selectedPair.dexId}</Badge>
                      </div>
                      <p className="text-muted-foreground">{selectedPair.baseToken.name}</p>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold">
                        {formatPrice(selectedPair.priceUsd)}
                      </div>
                      <div className={`text-lg ${
                        (selectedPair.priceChange?.h24 || 0) >= 0
                          ? 'text-green-500'
                          : 'text-red-500'
                      }`}>
                        {(selectedPair.priceChange?.h24 || 0) >= 0 ? (
                          <TrendingUp className="inline h-4 w-4 mr-1" />
                        ) : (
                          <TrendingDown className="inline h-4 w-4 mr-1" />
                        )}
                        {formatChange(selectedPair.priceChange?.h24 || 0)}
                      </div>
                    </div>
                  </div>

                  {/* Stats Grid */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
                    <div className="bg-secondary/50 rounded-lg p-3">
                      <div className="text-xs text-muted-foreground">24h Volume</div>
                      <div className="font-semibold">{formatVolume(selectedPair.volume?.h24 || 0)}</div>
                    </div>
                    <div className="bg-secondary/50 rounded-lg p-3">
                      <div className="text-xs text-muted-foreground">Liquidity</div>
                      <div className="font-semibold">{formatVolume(selectedPair.liquidity?.usd || 0)}</div>
                    </div>
                    <div className="bg-secondary/50 rounded-lg p-3">
                      <div className="text-xs text-muted-foreground">Market Cap</div>
                      <div className="font-semibold">{formatVolume(selectedPair.marketCap || selectedPair.fdv || 0)}</div>
                    </div>
                    <div className="bg-secondary/50 rounded-lg p-3">
                      <div className="text-xs text-muted-foreground">24h Txns</div>
                      <div className="font-semibold">
                        <span className="text-green-500">{selectedPair.txns?.h24?.buys || 0}</span>
                        {' / '}
                        <span className="text-red-500">{selectedPair.txns?.h24?.sells || 0}</span>
                      </div>
                    </div>
                  </div>

                  {/* Price Changes */}
                  <div className="flex gap-4 mt-4">
                    {[
                      { label: '5m', value: selectedPair.priceChange?.m5 },
                      { label: '1h', value: selectedPair.priceChange?.h1 },
                      { label: '6h', value: selectedPair.priceChange?.h6 },
                      { label: '24h', value: selectedPair.priceChange?.h24 },
                    ].map(({ label, value }) => (
                      <div key={label} className="text-center">
                        <div className="text-xs text-muted-foreground">{label}</div>
                        <div className={`text-sm font-medium ${
                          (value || 0) >= 0 ? 'text-green-500' : 'text-red-500'
                        }`}>
                          {formatChange(value || 0)}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 mt-4">
                    <Button asChild>
                      <a
                        href={getDexScreenerUrl(selectedPair.pairAddress)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <ExternalLink className="h-4 w-4 mr-2" />
                        View on DexScreener
                      </a>
                    </Button>
                    <Button variant="secondary" asChild>
                      <a
                        href={`https://solscan.io/token/${selectedPair.baseToken.address}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Solscan
                      </a>
                    </Button>
                    <Button variant="secondary" asChild>
                      <a
                        href={`https://birdeye.so/token/${selectedPair.baseToken.address}?chain=solana`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Birdeye
                      </a>
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Chart */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <BarChart3 className="h-5 w-5" />
                    Price Chart
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <iframe
                    src={getChartEmbedUrl(selectedPair.pairAddress)}
                    className="w-full h-[400px] border-0 rounded-b-lg"
                    title="DexScreener Chart"
                  />
                </CardContent>
              </Card>
            </>
          ) : (
            <Card>
              <CardContent className="py-16 text-center text-muted-foreground">
                <Zap className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Select a token to view chart and details</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
