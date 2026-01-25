/**
 * Alert System Setup Example
 * Shows how to initialize and use the multi-channel alert delivery system
 */

import { Telegraf } from 'telegraf';
import { initializeAlertSystem } from '../AlertSystem';
import type { AlertRule, SimpleCondition } from '../RuleEngine';

async function setupAlertSystem() {
  // Initialize Telegram bot
  const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);

  // Initialize alert system with all channels
  const alertSystem = await initializeAlertSystem({
    // Deduplication settings
    enableDeduplication: true,
    dedupWindowMs: 5 * 60 * 1000, // 5 minutes

    // Batching settings
    enableBatching: true,
    batchWindowMs: 30 * 1000, // 30 seconds

    // Retry settings
    maxRetries: 3,
    initialRetryDelayMs: 1000,

    // Channel configurations
    telegram: {
      bot,
      defaultChatId: process.env.TELEGRAM_CHAT_ID,
    },

    discord: process.env.DISCORD_WEBHOOK_URL ? {
      webhookUrl: process.env.DISCORD_WEBHOOK_URL,
      username: process.env.DISCORD_WEBHOOK_USERNAME || 'Solana Bot',
      avatarUrl: process.env.DISCORD_WEBHOOK_AVATAR_URL,
    } : undefined,

    email: process.env.EMAIL_PROVIDER ? {
      provider: process.env.EMAIL_PROVIDER as 'sendgrid' | 'resend',
      apiKey: process.env.EMAIL_PROVIDER === 'sendgrid' 
        ? process.env.SENDGRID_API_KEY! 
        : process.env.RESEND_API_KEY!,
      fromEmail: process.env.EMAIL_PROVIDER === 'sendgrid'
        ? process.env.SENDGRID_FROM_EMAIL!
        : process.env.RESEND_FROM_EMAIL!,
      fromName: process.env.EMAIL_PROVIDER === 'sendgrid'
        ? process.env.SENDGRID_FROM_NAME
        : process.env.RESEND_FROM_NAME,
      toEmail: process.env.EMAIL_PROVIDER === 'sendgrid'
        ? process.env.SENDGRID_TO_EMAIL!
        : process.env.RESEND_TO_EMAIL!,
    } : undefined,

    websocket: process.env.WEBSOCKET_PORT ? {
      port: parseInt(process.env.WEBSOCKET_PORT, 10),
      path: process.env.WEBSOCKET_PATH || '/alerts',
    } : undefined,
  });

  console.log('✓ Alert system initialized');
  console.log('Channels:', alertSystem.getStats().channels);

  return alertSystem;
}

// ============================================
// Example: Create Alert Rules
// ============================================

async function createExampleRules(alertSystem: any, userId: string) {
  // Example 1: High liquidity new tokens
  const highLiquidityRule: Omit<AlertRule, 'id' | 'createdAt' | 'triggerCount'> = {
    name: 'High Liquidity New Token',
    description: 'Alert when a new token launches with >$50K liquidity',
    enabled: true,
    rootCondition: {
      id: 'root',
      type: 'simple',
      field: 'liquidity',
      operator: '>=',
      value: 50000,
    } as SimpleCondition,
    priority: 'high',
    channels: ['telegram-default', 'discord-default'],
    cooldownSeconds: 300, // 5 minutes per token
    maxAlertsPerHour: 10,
    createdBy: userId,
    tags: ['discovery', 'liquidity'],
    metadata: { category: 'discovery' },
  };

  const rule1 = alertSystem.createRule(highLiquidityRule);
  console.log('✓ Created rule:', rule1.name);

  // Example 2: Price spike alert
  const priceSpikeRule: Omit<AlertRule, 'id' | 'createdAt' | 'triggerCount'> = {
    name: 'Price Spike Alert',
    description: 'Alert when price increases >50% in 15 minutes',
    enabled: true,
    rootCondition: {
      id: 'root',
      type: 'percent',
      field: 'price',
      operator: 'percent_increase',
      threshold: 50,
      timeframe: '15m',
    },
    priority: 'high',
    channels: ['telegram-default'],
    cooldownSeconds: 600, // 10 minutes
    maxAlertsPerHour: 5,
    createdBy: userId,
    tags: ['price', 'opportunity'],
    metadata: { category: 'opportunity' },
  };

  const rule2 = alertSystem.createRule(priceSpikeRule);
  console.log('✓ Created rule:', rule2.name);

  // Example 3: Smart money activity
  const smartMoneyRule: Omit<AlertRule, 'id' | 'createdAt' | 'triggerCount'> = {
    name: 'Smart Money Buying',
    description: 'Alert when 3+ smart wallets buy the same token',
    enabled: true,
    rootCondition: {
      id: 'root',
      type: 'simple',
      field: 'smartMoneyBuying',
      operator: '>=',
      value: 3,
    } as SimpleCondition,
    priority: 'critical',
    channels: ['telegram-default', 'discord-default', 'email-default'],
    cooldownSeconds: 600,
    maxAlertsPerHour: 3,
    createdBy: userId,
    tags: ['smart_money', 'whale'],
    metadata: { category: 'whale' },
  };

  const rule3 = alertSystem.createRule(smartMoneyRule);
  console.log('✓ Created rule:', rule3.name);

  // Example 4: Liquidity drain warning
  const liquidityDrainRule: Omit<AlertRule, 'id' | 'createdAt' | 'triggerCount'> = {
    name: 'Liquidity Drain Warning',
    description: 'Alert when liquidity drops >30% suddenly',
    enabled: true,
    rootCondition: {
      id: 'root',
      type: 'percent',
      field: 'liquidity',
      operator: 'percent_decrease',
      threshold: 30,
      timeframe: '5m',
    },
    priority: 'critical',
    channels: ['telegram-default', 'discord-default', 'email-default'],
    cooldownSeconds: 60, // Urgent, only 1 min cooldown
    maxAlertsPerHour: 20,
    createdBy: userId,
    tags: ['risk', 'liquidity', 'rug'],
    metadata: { category: 'risk', alertType: 'liquidity_drain' },
  };

  const rule4 = alertSystem.createRule(liquidityDrainRule);
  console.log('✓ Created rule:', rule4.name);

  return [rule1, rule2, rule3, rule4];
}

// ============================================
// Example: Evaluate Token Against Rules
// ============================================

async function evaluateTokenExample(alertSystem: any) {
  // Simulate token data
  const tokenData = {
    tokenMint: 'ExampleToken123456789',
    symbol: 'EXAMPLE',
    currentData: {
      price: 0.001,
      liquidity: 75000, // Will trigger high liquidity rule
      volume24h: 50000,
      holders: 150,
      riskScore: 85,
    },
    timestamp: Date.now(),
  };

  // Evaluate
  const results = await alertSystem.evaluateToken(tokenData);

  console.log(`\n✓ Evaluated token ${tokenData.symbol}:`);
  console.log(`  - Matched ${results.length} rules`);

  for (const result of results) {
    console.log(`  - Rule: ${result.ruleName}`);
    console.log(`    Matched: ${result.matchedConditions.join(', ')}`);
  }
}

// ============================================
// Example: Test Rule Delivery
// ============================================

async function testRuleDeliveryExample(alertSystem: any, ruleId: string) {
  console.log(`\n Testing delivery for rule ${ruleId}...`);

  const result = await alertSystem.testRule(ruleId, {
    tokenMint: 'TestToken123',
    symbol: 'TEST',
    currentData: {
      price: 0.005,
      liquidity: 100000,
    },
  });

  console.log('✓ Test delivery result:');
  console.log(`  - Dispatched: ${result.dispatched}`);
  console.log(`  - Channels: ${result.channels.join(', ')}`);
  console.log(`  - Errors: ${result.errors.length}`);
}

// ============================================
// Example: Get Statistics
// ============================================

function getStatsExample(alertSystem: any) {
  const stats = alertSystem.getStats();

  console.log('\n📊 Alert System Statistics:');
  console.log('Rules:');
  console.log(`  - Total: ${stats.rules.total}`);
  console.log(`  - Enabled: ${stats.rules.enabled}`);
  console.log(`  - Disabled: ${stats.rules.disabled}`);

  console.log('\nDispatcher:');
  console.log(`  - Total dispatches: ${stats.dispatcher.totalDispatches}`);
  console.log(`  - Unique tokens: ${stats.dispatcher.uniqueTokens}`);
  console.log(`  - Unique rules: ${stats.dispatcher.uniqueRules}`);

  console.log('\nChannels:');
  for (const channel of stats.channels) {
    console.log(`  - ${channel.name} (${channel.type})`);
  }
}

// ============================================
// Main Example
// ============================================

async function main() {
  try {
    // 1. Setup
    const alertSystem = await setupAlertSystem();

    // 2. Create rules
    const userId = process.env.TELEGRAM_CHAT_ID!;
    const rules = await createExampleRules(alertSystem, userId);

    // 3. Evaluate a token
    await evaluateTokenExample(alertSystem);

    // 4. Test delivery
    await testRuleDeliveryExample(alertSystem, rules[0].id);

    // 5. Get stats
    getStatsExample(alertSystem);

    // 6. Export rules to file
    const exportedRules = alertSystem.exportRules();
    console.log(`\n✓ Exported ${exportedRules.length} rules`);

    // Cleanup
    await alertSystem.shutdown();
    console.log('\n✓ Alert system shut down');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

export { setupAlertSystem, createExampleRules };
