/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        dark: {
          50: '#f7f7f8',
          100: '#e3e3e6',
          200: '#c6c7cd',
          300: '#a2a3ad',
          400: '#7e808c',
          500: '#636571',
          600: '#4e505a',
          700: '#1e2230',
          800: '#141824',
          900: '#0d1117',
          950: '#080b10',
        },
        accent: {
          light: '#93c5fd',
          DEFAULT: '#3b82f6',
          dark: '#2563eb',
        },
        profit: {
          light: '#4ade80',
          DEFAULT: '#22c55e',
          dark: '#16a34a',
        },
        loss: {
          light: '#f87171',
          DEFAULT: '#ef4444',
          dark: '#dc2626',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Monaco', 'Consolas', 'monospace'],
      },
      boxShadow: {
        'glow-blue': '0 0 40px rgba(59, 130, 246, 0.15)',
        'glass': '0 8px 32px rgba(0, 0, 0, 0.3)',
      },
      animation: {
        'pulse-slow': 'pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.5s ease-out forwards',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};
