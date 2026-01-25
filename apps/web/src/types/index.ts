// Token types
export interface Token {
  mint: string;
  symbol: string;
  name: string;
  priceUsd: number;
  priceChange24h: number;
  volume24h: number;
  marketCap: number;
  liquidity: number;
  holders: number;
  riskScore: number;
  rugProbability: number;
  discoveredAt: number;
}

export interface TokenAnalysis {
  token: {
    mint: string;
    symbol: string;
    name: string;
  };
  liquidity: {
    totalLiquidityUsd: number;
    lpBurned: boolean;
    lpLocked: boolean;
    lpBurnedPercent: number;
    lpLockedPercent: number;
  };
  holders: {
    totalHolders: number;
    top10HoldersPercent: number;
    largestHolderPercent: number;
    devWalletPercent: number;
  };
  contract: {
    mintAuthorityRevoked: boolean;
    freezeAuthorityRevoked: boolean;
    isHoneypot: boolean;
  };
  social: {
    hasTwitter: boolean;
    hasTelegram: boolean;
    hasWebsite: boolean;
    twitterFollowers?: number;
    telegramMembers?: number;
  };
  risk: {
    level: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH' | 'EXTREME';
    score: number;
    factors: Array<{
      name: string;
      passed: boolean;
      severity: string;
    }>;
  };
  smartMoney?: {
    smartBuys24h: number;
    smartSells24h: number;
    netSmartMoney: number;
  };
}

// Pattern types
export interface Pattern {
  id: number;
  patternName: string;
  patternType: 'success' | 'rug' | 'neutral';
  successRate: number;
  averagePeakMultiplier: number;
  matchScore?: number;
  matchedCriteria?: string[];
}

// Smart Money types
export interface SmartMoneyWallet {
  wallet_address: string;
  total_trades: number;
  winning_trades: number;
  win_rate: number;
  total_profit_sol: number;
  average_profit_percent: number;
  reputation_score: number;
  trading_style?: 'scalper' | 'swing' | 'holder';
  last_trade_at?: number;
}

export interface SmartMoneyTrade {
  id: number;
  wallet_address: string;
  token_mint: string;
  token_symbol?: string;
  entry_price: number;
  entry_time: number;
  exit_price?: number;
  exit_time?: number;
  profit_percent?: number;
  hold_time_hours?: number;
  status: 'open' | 'closed';
}

// Alert types
export interface Alert {
  id: number;
  type: 'new_token' | 'smart_money' | 'pattern_match' | 'price_change';
  severity: 'info' | 'warning' | 'critical';
  token_mint: string;
  token_symbol: string;
  message: string;
  data: any;
  created_at: number;
  read: boolean;
}

// Stats types
export interface DashboardStats {
  tokensAnalyzed: number;
  activeAlerts: number;
  smartMoneyWallets: number;
  avgRiskScore: number;
  totalVolume24h: number;
}

// WebSocket types
export interface WSMessage {
  type: 'token_update' | 'smart_money_activity' | 'pattern_detected' | 'alert';
  data: any;
  timestamp: number;
}
