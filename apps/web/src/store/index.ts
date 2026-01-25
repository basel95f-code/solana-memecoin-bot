import { create } from 'zustand';
import { Token, Alert, SmartMoneyWallet, DashboardStats } from '@/types';

interface AppState {
  // Data
  tokens: Token[];
  alerts: Alert[];
  smartMoneyWallets: SmartMoneyWallet[];
  stats: DashboardStats | null;

  // UI State
  selectedToken: Token | null;
  sidebarOpen: boolean;
  filterRiskLevel: string[];
  sortBy: string;

  // Actions
  setTokens: (tokens: Token[]) => void;
  addToken: (token: Token) => void;
  updateToken: (mint: string, updates: Partial<Token>) => void;
  
  setAlerts: (alerts: Alert[]) => void;
  addAlert: (alert: Alert) => void;
  markAlertRead: (id: number) => void;
  
  setSmartMoneyWallets: (wallets: SmartMoneyWallet[]) => void;
  setStats: (stats: DashboardStats) => void;
  
  setSelectedToken: (token: Token | null) => void;
  setSidebarOpen: (open: boolean) => void;
  setFilterRiskLevel: (levels: string[]) => void;
  setSortBy: (sortBy: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  // Initial state
  tokens: [],
  alerts: [],
  smartMoneyWallets: [],
  stats: null,
  selectedToken: null,
  sidebarOpen: true,
  filterRiskLevel: [],
  sortBy: 'discovered_at',

  // Actions
  setTokens: (tokens) => set({ tokens }),
  
  addToken: (token) => set((state) => ({
    tokens: [token, ...state.tokens].slice(0, 100), // Keep only 100 most recent
  })),
  
  updateToken: (mint, updates) => set((state) => ({
    tokens: state.tokens.map((t) =>
      t.mint === mint ? { ...t, ...updates } : t
    ),
  })),
  
  setAlerts: (alerts) => set({ alerts }),
  
  addAlert: (alert) => set((state) => ({
    alerts: [alert, ...state.alerts].slice(0, 50),
  })),
  
  markAlertRead: (id) => set((state) => ({
    alerts: state.alerts.map((a) =>
      a.id === id ? { ...a, read: true } : a
    ),
  })),
  
  setSmartMoneyWallets: (wallets) => set({ smartMoneyWallets: wallets }),
  setStats: (stats) => set({ stats }),
  setSelectedToken: (token) => set({ selectedToken: token }),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setFilterRiskLevel: (levels) => set({ filterRiskLevel: levels }),
  setSortBy: (sortBy) => set({ sortBy }),
}));
