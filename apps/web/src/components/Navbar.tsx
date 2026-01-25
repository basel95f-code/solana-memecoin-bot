import { Link, useLocation } from 'react-router-dom';
import { 
  Home, 
  TrendingUp, 
  Brain, 
  Bell, 
  Wallet, 
  Settings,
  Activity
} from 'lucide-react';
import { cn } from '@/utils/cn';
import { useAlerts } from '@/hooks/useAlerts';

export const Navbar = () => {
  const location = useLocation();
  const { data: alerts } = useAlerts(100, true);

  const unreadCount = alerts?.filter(a => !a.read).length || 0;

  const navItems = [
    { path: '/', label: 'Home', icon: Home },
    { path: '/smart-money', label: 'Smart Money', icon: Wallet },
    { path: '/patterns', label: 'Patterns', icon: Brain },
    { path: '/alerts', label: 'Alerts', icon: Bell, badge: unreadCount },
    { path: '/settings', label: 'Settings', icon: Settings },
  ];

  return (
    <nav className="border-b border-gray-800 bg-gray-900/50 backdrop-blur-sm sticky top-0 z-50">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2 text-xl font-bold">
            <Activity className="h-6 w-6 text-blue-500" />
            <span className="bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
              Solana Memecoin Bot
            </span>
          </Link>

          {/* Navigation Links */}
          <div className="flex items-center gap-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path;

              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={cn(
                    'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors relative',
                    isActive
                      ? 'bg-blue-500/20 text-blue-400'
                      : 'text-gray-400 hover:text-gray-300 hover:bg-gray-800/50'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span className="hidden sm:inline">{item.label}</span>
                  
                  {item.badge !== undefined && item.badge > 0 && (
                    <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs text-white">
                      {item.badge > 9 ? '9+' : item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>

          {/* Connection Status */}
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
            <span className="hidden md:inline">Live</span>
          </div>
        </div>
      </div>
    </nav>
  );
};
