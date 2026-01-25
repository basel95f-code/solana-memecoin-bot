import { useMemo } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Line,
  LineChart,
} from 'recharts';
import { formatPrice, formatDate } from '@/utils/format';

interface PriceDataPoint {
  timestamp: number;
  price: number;
  volume: number;
}

interface PriceChartProps {
  data: PriceDataPoint[];
  type?: 'area' | 'line';
  showVolume?: boolean;
  height?: number;
}

export const PriceChart = ({ data, type = 'area', showVolume = false, height = 300 }: PriceChartProps) => {
  const chartData = useMemo(() => {
    return data.map((d) => ({
      ...d,
      time: formatDate(d.timestamp),
    }));
  }, [data]);

  const priceColor = useMemo(() => {
    if (data.length < 2) return '#3b82f6';
    const firstPrice = data[0].price;
    const lastPrice = data[data.length - 1].price;
    return lastPrice >= firstPrice ? '#10b981' : '#ef4444';
  }, [data]);

  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[300px] text-gray-500">
        No price data available
      </div>
    );
  }

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;

    return (
      <div className="rounded-lg border border-gray-700 bg-gray-900 p-3 shadow-lg">
        <p className="text-xs text-gray-400 mb-1">{payload[0].payload.time}</p>
        <p className="text-sm font-bold text-white">
          {formatPrice(payload[0].value)}
        </p>
        {showVolume && payload[1] && (
          <p className="text-xs text-gray-400 mt-1">
            Vol: ${payload[1].value.toFixed(0)}
          </p>
        )}
      </div>
    );
  };

  if (type === 'area') {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={chartData}>
          <defs>
            <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={priceColor} stopOpacity={0.3} />
              <stop offset="95%" stopColor={priceColor} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis
            dataKey="time"
            stroke="#6b7280"
            style={{ fontSize: '12px' }}
            tickMargin={10}
          />
          <YAxis
            stroke="#6b7280"
            style={{ fontSize: '12px' }}
            tickFormatter={(value) => formatPrice(value)}
            width={80}
          />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone"
            dataKey="price"
            stroke={priceColor}
            strokeWidth={2}
            fill="url(#priceGradient)"
          />
        </AreaChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
        <XAxis
          dataKey="time"
          stroke="#6b7280"
          style={{ fontSize: '12px' }}
          tickMargin={10}
        />
        <YAxis
          stroke="#6b7280"
          style={{ fontSize: '12px' }}
          tickFormatter={(value) => formatPrice(value)}
          width={80}
        />
        <Tooltip content={<CustomTooltip />} />
        <Line
          type="monotone"
          dataKey="price"
          stroke={priceColor}
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
};
