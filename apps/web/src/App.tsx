import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Navbar } from './components/Navbar';
import { Home } from './pages/Home';
import { TokenDetail } from './pages/TokenDetail';
import { SmartMoney } from './pages/SmartMoney';
import { Patterns } from './pages/Patterns';
import { Alerts } from './pages/Alerts';
import { Settings } from './pages/Settings';

// Create React Query client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 5000,
    },
  },
});

// 404 Page
const NotFound = () => (
  <div className="container mx-auto px-4 py-16 text-center">
    <h1 className="text-6xl font-bold text-white mb-4">404</h1>
    <p className="text-xl text-gray-400 mb-8">Page not found</p>
    <a href="/" className="px-6 py-3 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700">
      Go Home
    </a>
  </div>
);

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <div className="min-h-screen bg-gray-950 text-white">
          <Navbar />
          <main>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/token/:mint" element={<TokenDetail />} />
              <Route path="/smart-money" element={<SmartMoney />} />
              <Route path="/patterns" element={<Patterns />} />
              <Route path="/alerts" element={<Alerts />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/404" element={<NotFound />} />
              <Route path="*" element={<Navigate to="/404" replace />} />
            </Routes>
          </main>
        </div>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
