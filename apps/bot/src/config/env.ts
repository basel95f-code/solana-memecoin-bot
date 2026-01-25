import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * Environment variable validation and configuration
 * Validates required variables on startup and provides clear error messages
 */

export interface EnvConfig {
  // Required
  telegram: {
    botToken: string;
  };

  // Optional with defaults
  solana: {
    rpcUrl: string;
  };

  api: {
    dexscreener?: string;
    gmgn?: string;
    rugcheck?: string;
  };

  database: {
    path: string;
  };

  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
  };

  nodeEnv: string;
}

/**
 * Get a required environment variable
 * @throws Error if the variable is not set
 */
function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `❌ Missing required environment variable: ${key}\n` +
      `Please set it in your .env file or environment.\n` +
      `See DEPLOYMENT.md for more information.`
    );
  }
  return value;
}

/**
 * Get an optional environment variable with a default value
 */
function getEnv(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

/**
 * Validate log level
 */
function validateLogLevel(level: string): 'debug' | 'info' | 'warn' | 'error' {
  const validLevels = ['debug', 'info', 'warn', 'error'];
  if (!validLevels.includes(level)) {
    console.warn(`⚠️  Invalid LOG_LEVEL "${level}", defaulting to "info"`);
    return 'info';
  }
  return level as 'debug' | 'info' | 'warn' | 'error';
}

/**
 * Load and validate environment configuration
 * @throws Error if required variables are missing
 */
export function loadEnvConfig(): EnvConfig {
  console.log('🔧 Loading environment configuration...');

  try {
    const config: EnvConfig = {
      telegram: {
        botToken: requireEnv('TELEGRAM_BOT_TOKEN'),
      },
      solana: {
        rpcUrl: getEnv('SOLANA_RPC_URL', 'https://api.mainnet-beta.solana.com'),
      },
      api: {
        dexscreener: process.env.DEXSCREENER_API_KEY,
        gmgn: process.env.GMGN_API_KEY,
        rugcheck: process.env.RUGCHECK_API_KEY,
      },
      database: {
        path: getEnv('DATABASE_PATH', './data/bot.db'),
      },
      logging: {
        level: validateLogLevel(getEnv('LOG_LEVEL', 'info')),
      },
      nodeEnv: getEnv('NODE_ENV', 'development'),
    };

    // Log configuration summary (without sensitive data)
    console.log('✅ Environment configuration loaded successfully:');
    console.log(`   - Node Environment: ${config.nodeEnv}`);
    console.log(`   - Log Level: ${config.logging.level}`);
    console.log(`   - Telegram Bot: ${config.telegram.botToken ? '✓ Configured' : '✗ Missing'}`);
    console.log(`   - Solana RPC: ${config.solana.rpcUrl}`);
    console.log(`   - Database Path: ${config.database.path}`);
    console.log(`   - DexScreener API: ${config.api.dexscreener ? '✓ Configured' : '○ Optional'}`);
    console.log(`   - GMGN API: ${config.api.gmgn ? '✓ Configured' : '○ Optional'}`);
    console.log(`   - RugCheck API: ${config.api.rugcheck ? '✓ Configured' : '○ Optional'}`);

    return config;
  } catch (error) {
    console.error('\n❌ Environment Configuration Error:\n');
    console.error((error as Error).message);
    console.error('\n📖 Required Environment Variables:');
    console.error('   - TELEGRAM_BOT_TOKEN (required)');
    console.error('\n📖 Optional Environment Variables (with defaults):');
    console.error('   - SOLANA_RPC_URL (default: https://api.mainnet-beta.solana.com)');
    console.error('   - DEXSCREENER_API_KEY (optional)');
    console.error('   - GMGN_API_KEY (optional)');
    console.error('   - RUGCHECK_API_KEY (optional)');
    console.error('   - DATABASE_PATH (default: ./data/bot.db)');
    console.error('   - LOG_LEVEL (default: info)');
    console.error('\n💡 Tip: Copy .env.example to .env and fill in your values\n');
    
    // Re-throw to stop application startup
    throw error;
  }
}

/**
 * Singleton instance of the environment configuration
 */
let envConfigInstance: EnvConfig | null = null;

/**
 * Get the current environment configuration
 * Loads and validates on first call
 */
export function getEnvConfig(): EnvConfig {
  if (!envConfigInstance) {
    envConfigInstance = loadEnvConfig();
  }
  return envConfigInstance;
}

// Export for convenience
export const envConfig = getEnvConfig();
