import { Context, Telegraf } from 'telegraf';
import { PublicKey } from '@solana/web3.js';
import { advancedMonitor, AdvancedAlert } from '../../services/advancedMonitor';
import { storageService } from '../../services/storage';
import { dexScreenerService } from '../../services/dexscreener';
import { formatNumber, truncateAddress } from '../formatters';

// Portfolio tracking (in-memory for now, can be persisted later)
interface PortfolioEntry {
  mint: string;
  symbol: string;
  name: string;
  entryPrice: number;
  amount: number;
  entryDate: number;
}

const userPortfolios: Map<string, PortfolioEntry[]> = new Map();

function isValidSolanaAddress(address: string): boolean {
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

export function registerAdvancedCommands(bot: Telegraf): void {
  // /monitor command - Add token to advanced monitoring
  bot.command('monitor', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      await ctx.replyWithHTML(
        `<b>Advanced Monitoring</b>\n\n` +
        `Usage: <code>/monitor [token_address]</code>\n\n` +
        `Get alerts for:\n` +
        `• Volume spikes (5x+ normal)\n` +
        `• Liquidity drains (30%+ removed)\n` +
        `• Authority changes\n` +
        `• Whale movements (3%+ supply)`
      );
      return;
    }

    const address = args[0];

    if (!isValidSolanaAddress(address)) {
      await ctx.replyWithHTML(`❌ Invalid Solana address.`);
      return;
    }

    advancedMonitor.watchToken(address);

    const dexData = await dexScreenerService.getTokenData(address);
    const symbol = dexData?.baseToken.symbol || truncateAddress(address, 4);

    await ctx.replyWithHTML(
      `✅ <b>Monitoring Enabled</b>\n\n` +
      `Token: <b>${symbol}</b>\n` +
      `Address: <code>${truncateAddress(address, 8)}</code>\n\n` +
      `You'll receive alerts for:\n` +
      `📊 Volume spikes\n` +
      `💧 Liquidity changes\n` +
      `🔐 Authority changes\n` +
      `🐋 Whale movements\n\n` +
      `Use <code>/unmonitor ${truncateAddress(address, 6)}</code> to stop.`
    );
  });

  // /unmonitor command - Remove token from advanced monitoring
  bot.command('unmonitor', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      await ctx.replyWithHTML(`Usage: <code>/unmonitor [token_address]</code>`);
      return;
    }

    const address = args[0];
    advancedMonitor.unwatchToken(address);

    await ctx.replyWithHTML(`✅ Stopped monitoring <code>${truncateAddress(address, 8)}</code>`);
  });

  // /monitored command - List all monitored tokens
  bot.command('monitored', async (ctx: Context) => {
    const tokens = advancedMonitor.getWatchedTokens();

    if (tokens.length === 0) {
      await ctx.replyWithHTML(
        `<b>Monitored Tokens</b>\n\n` +
        `No tokens currently monitored.\n\n` +
        `Use <code>/monitor [address]</code> to add one.`
      );
      return;
    }

    const lines = [
      `<b>Monitored Tokens (${tokens.length})</b>`,
      ``,
    ];

    for (const mint of tokens.slice(0, 10)) {
      const dexData = await dexScreenerService.getTokenData(mint);
      if (dexData) {
        lines.push(`• <b>${dexData.baseToken.symbol}</b> - $${dexData.priceUsd || 'N/A'}`);
        lines.push(`  <code>${truncateAddress(mint, 6)}</code>`);
      } else {
        lines.push(`• <code>${truncateAddress(mint, 8)}</code>`);
      }
    }

    if (tokens.length > 10) {
      lines.push(``, `...and ${tokens.length - 10} more`);
    }

    await ctx.replyWithHTML(lines.join('\n'));
  });

  // /diagnose command - Quick analysis for potential issues
  bot.command('diagnose', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      await ctx.replyWithHTML(
        `<b>Token Diagnosis</b>\n\n` +
        `Usage: <code>/diagnose [token_address]</code>\n\n` +
        `Quick check for red flags and concerns.`
      );
      return;
    }

    const address = args[0];

    if (!isValidSolanaAddress(address)) {
      await ctx.replyWithHTML(`❌ Invalid Solana address.`);
      return;
    }

    const loadingMsg = await ctx.replyWithHTML(`🔍 Diagnosing token...`);

    try {
      const alerts = await advancedMonitor.analyzeToken(address);
      const dexData = await dexScreenerService.getTokenData(address);

      const symbol = dexData?.baseToken.symbol || 'Unknown';
      const name = dexData?.baseToken.name || 'Unknown Token';

      const lines = [
        `🩺 <b>TOKEN DIAGNOSIS</b>`,
        ``,
        `<b>${name}</b> ($${symbol})`,
        `<code>${address}</code>`,
        ``,
      ];

      if (alerts.length === 0) {
        lines.push(`✅ <b>No immediate concerns detected!</b>`);
        lines.push(``);
        lines.push(`The token passes basic safety checks.`);
      } else {
        lines.push(`⚠️ <b>${alerts.length} Issue${alerts.length > 1 ? 's' : ''} Found:</b>`);
        lines.push(``);

        for (const alert of alerts) {
          const icon = alert.severity === 'critical' ? '🔴' : alert.severity === 'warning' ? '🟡' : '🔵';
          lines.push(`${icon} <b>${alert.message}</b>`);
        }
      }

      // Add current stats if available
      if (dexData) {
        lines.push(``);
        lines.push(`<b>Current Stats:</b>`);
        lines.push(`• Price: $${dexData.priceUsd || 'N/A'}`);
        lines.push(`• Liquidity: $${formatNumber(dexData.liquidity?.usd || 0)}`);
        lines.push(`• 24h Volume: $${formatNumber(dexData.volume?.h24 || 0)}`);
      }

      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        lines.join('\n'),
        { parse_mode: 'HTML' }
      );
    } catch (error) {
      console.error('Diagnose command error:', error);
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        `❌ Error diagnosing token.`,
        { parse_mode: 'HTML' }
      );
    }
  });

  // /portfolio command - View portfolio
  bot.command('portfolio', async (ctx: Context) => {
    const chatId = ctx.chat?.id?.toString() || '';
    const portfolio = userPortfolios.get(chatId) || [];

    if (portfolio.length === 0) {
      await ctx.replyWithHTML(
        `<b>Portfolio Tracker</b>\n\n` +
        `Your portfolio is empty.\n\n` +
        `Commands:\n` +
        `• <code>/buy [address] [amount] [price]</code> - Add position\n` +
        `• <code>/sell [address] [amount]</code> - Record sale\n` +
        `• <code>/pnl</code> - View profit/loss`
      );
      return;
    }

    const loadingMsg = await ctx.replyWithHTML(`📊 Loading portfolio...`);

    try {
      const lines = [
        `📊 <b>YOUR PORTFOLIO</b>`,
        ``,
      ];

      let totalValue = 0;
      let totalCost = 0;

      for (const entry of portfolio) {
        const dexData = await dexScreenerService.getTokenData(entry.mint);
        const currentPrice = parseFloat(dexData?.priceUsd || '0');
        const currentValue = currentPrice * entry.amount;
        const cost = entry.entryPrice * entry.amount;
        const pnl = currentValue - cost;
        const pnlPercent = cost > 0 ? ((currentValue - cost) / cost) * 100 : 0;

        totalValue += currentValue;
        totalCost += cost;

        const pnlEmoji = pnl >= 0 ? '🟢' : '🔴';
        const pnlSign = pnl >= 0 ? '+' : '';

        lines.push(`<b>${entry.symbol}</b>`);
        lines.push(`  Amount: ${formatNumber(entry.amount)}`);
        lines.push(`  Entry: $${entry.entryPrice.toFixed(8)}`);
        lines.push(`  Current: $${currentPrice.toFixed(8)}`);
        lines.push(`  ${pnlEmoji} P&L: ${pnlSign}$${formatNumber(pnl)} (${pnlSign}${pnlPercent.toFixed(1)}%)`);
        lines.push(``);
      }

      const totalPnl = totalValue - totalCost;
      const totalPnlPercent = totalCost > 0 ? ((totalValue - totalCost) / totalCost) * 100 : 0;
      const totalEmoji = totalPnl >= 0 ? '🟢' : '🔴';

      lines.push(`<b>═══════════════════</b>`);
      lines.push(`<b>Total Value:</b> $${formatNumber(totalValue)}`);
      lines.push(`<b>Total Cost:</b> $${formatNumber(totalCost)}`);
      lines.push(`${totalEmoji} <b>Total P&L:</b> ${totalPnl >= 0 ? '+' : ''}$${formatNumber(totalPnl)} (${totalPnl >= 0 ? '+' : ''}${totalPnlPercent.toFixed(1)}%)`);

      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        lines.join('\n'),
        { parse_mode: 'HTML' }
      );
    } catch (error) {
      console.error('Portfolio command error:', error);
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        `❌ Error loading portfolio.`,
        { parse_mode: 'HTML' }
      );
    }
  });

  // /buy command - Add position to portfolio
  bot.command('buy', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length < 2) {
      await ctx.replyWithHTML(
        `<b>Add Position</b>\n\n` +
        `Usage: <code>/buy [address] [amount] [price]</code>\n\n` +
        `Example: <code>/buy DezX...B263 1000000 0.00001234</code>\n\n` +
        `If price is omitted, current price will be used.`
      );
      return;
    }

    const [address, amountStr, priceStr] = args;

    if (!isValidSolanaAddress(address)) {
      await ctx.replyWithHTML(`❌ Invalid Solana address.`);
      return;
    }

    const amount = parseFloat(amountStr);
    if (isNaN(amount) || amount <= 0) {
      await ctx.replyWithHTML(`❌ Invalid amount.`);
      return;
    }

    let price: number;
    if (priceStr) {
      price = parseFloat(priceStr);
      if (isNaN(price) || price <= 0) {
        await ctx.replyWithHTML(`❌ Invalid price.`);
        return;
      }
    } else {
      const dexData = await dexScreenerService.getTokenData(address);
      price = parseFloat(dexData?.priceUsd || '0');
      if (price === 0) {
        await ctx.replyWithHTML(`❌ Could not get current price. Please specify manually.`);
        return;
      }
    }

    const dexData = await dexScreenerService.getTokenData(address);
    const symbol = dexData?.baseToken.symbol || 'UNKNOWN';
    const name = dexData?.baseToken.name || 'Unknown Token';

    const chatId = ctx.chat?.id?.toString() || '';
    const portfolio = userPortfolios.get(chatId) || [];

    // Check if position exists
    const existingIndex = portfolio.findIndex(p => p.mint === address);
    if (existingIndex >= 0) {
      // Average into existing position
      const existing = portfolio[existingIndex];
      const totalCost = (existing.entryPrice * existing.amount) + (price * amount);
      const totalAmount = existing.amount + amount;
      existing.entryPrice = totalCost / totalAmount;
      existing.amount = totalAmount;
    } else {
      // Add new position
      portfolio.push({
        mint: address,
        symbol,
        name,
        entryPrice: price,
        amount,
        entryDate: Date.now(),
      });
    }

    userPortfolios.set(chatId, portfolio);

    const value = price * amount;
    await ctx.replyWithHTML(
      `✅ <b>Position Added</b>\n\n` +
      `Token: <b>${symbol}</b>\n` +
      `Amount: ${formatNumber(amount)}\n` +
      `Entry Price: $${price.toFixed(10)}\n` +
      `Value: $${formatNumber(value)}\n\n` +
      `Use <code>/portfolio</code> to view all positions.`
    );
  });

  // /sell command - Record a sale
  bot.command('sell', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length < 2) {
      await ctx.replyWithHTML(
        `<b>Record Sale</b>\n\n` +
        `Usage: <code>/sell [address] [amount] [price]</code>\n\n` +
        `Example: <code>/sell DezX...B263 500000 0.00002</code>\n\n` +
        `Use "all" to sell entire position.`
      );
      return;
    }

    const [address, amountStr, priceStr] = args;

    if (!isValidSolanaAddress(address)) {
      await ctx.replyWithHTML(`❌ Invalid Solana address.`);
      return;
    }

    const chatId = ctx.chat?.id?.toString() || '';
    const portfolio = userPortfolios.get(chatId) || [];
    const positionIndex = portfolio.findIndex(p => p.mint === address);

    if (positionIndex < 0) {
      await ctx.replyWithHTML(`❌ No position found for this token.`);
      return;
    }

    const position = portfolio[positionIndex];
    const sellAll = amountStr.toLowerCase() === 'all';
    const amount = sellAll ? position.amount : parseFloat(amountStr);

    if (isNaN(amount) || amount <= 0) {
      await ctx.replyWithHTML(`❌ Invalid amount.`);
      return;
    }

    if (amount > position.amount) {
      await ctx.replyWithHTML(`❌ Amount exceeds position size (${formatNumber(position.amount)}).`);
      return;
    }

    let sellPrice: number;
    if (priceStr) {
      sellPrice = parseFloat(priceStr);
      if (isNaN(sellPrice) || sellPrice <= 0) {
        await ctx.replyWithHTML(`❌ Invalid price.`);
        return;
      }
    } else {
      const dexData = await dexScreenerService.getTokenData(address);
      sellPrice = parseFloat(dexData?.priceUsd || '0');
      if (sellPrice === 0) {
        await ctx.replyWithHTML(`❌ Could not get current price. Please specify manually.`);
        return;
      }
    }

    // Calculate P&L for this sale
    const cost = position.entryPrice * amount;
    const proceeds = sellPrice * amount;
    const pnl = proceeds - cost;
    const pnlPercent = cost > 0 ? ((proceeds - cost) / cost) * 100 : 0;

    // Update or remove position
    if (sellAll || amount >= position.amount) {
      portfolio.splice(positionIndex, 1);
    } else {
      position.amount -= amount;
    }

    userPortfolios.set(chatId, portfolio);

    const pnlEmoji = pnl >= 0 ? '🟢' : '🔴';
    const pnlSign = pnl >= 0 ? '+' : '';

    await ctx.replyWithHTML(
      `✅ <b>Sale Recorded</b>\n\n` +
      `Token: <b>${position.symbol}</b>\n` +
      `Amount Sold: ${formatNumber(amount)}\n` +
      `Sell Price: $${sellPrice.toFixed(10)}\n` +
      `Proceeds: $${formatNumber(proceeds)}\n\n` +
      `${pnlEmoji} <b>Realized P&L:</b> ${pnlSign}$${formatNumber(pnl)} (${pnlSign}${pnlPercent.toFixed(1)}%)\n\n` +
      (portfolio.length > 0 ? `Use <code>/portfolio</code> to view remaining positions.` : `Portfolio is now empty.`)
    );
  });

  // /pnl command - Quick P&L summary
  bot.command('pnl', async (ctx: Context) => {
    const chatId = ctx.chat?.id?.toString() || '';
    const portfolio = userPortfolios.get(chatId) || [];

    if (portfolio.length === 0) {
      await ctx.replyWithHTML(`No positions in portfolio. Use <code>/buy</code> to add one.`);
      return;
    }

    const loadingMsg = await ctx.replyWithHTML(`📊 Calculating P&L...`);

    try {
      let totalValue = 0;
      let totalCost = 0;
      let winners = 0;
      let losers = 0;

      for (const entry of portfolio) {
        const dexData = await dexScreenerService.getTokenData(entry.mint);
        const currentPrice = parseFloat(dexData?.priceUsd || '0');
        const currentValue = currentPrice * entry.amount;
        const cost = entry.entryPrice * entry.amount;

        totalValue += currentValue;
        totalCost += cost;

        if (currentValue >= cost) winners++;
        else losers++;
      }

      const totalPnl = totalValue - totalCost;
      const totalPnlPercent = totalCost > 0 ? ((totalValue - totalCost) / totalCost) * 100 : 0;
      const emoji = totalPnl >= 0 ? '🟢' : '🔴';
      const sign = totalPnl >= 0 ? '+' : '';

      const message = [
        `${emoji} <b>P&L SUMMARY</b>`,
        ``,
        `<b>Positions:</b> ${portfolio.length}`,
        `<b>Winners:</b> ${winners} | <b>Losers:</b> ${losers}`,
        ``,
        `<b>Total Cost:</b> $${formatNumber(totalCost)}`,
        `<b>Current Value:</b> $${formatNumber(totalValue)}`,
        ``,
        `${emoji} <b>Total P&L:</b> ${sign}$${formatNumber(totalPnl)}`,
        `${emoji} <b>Return:</b> ${sign}${totalPnlPercent.toFixed(2)}%`,
      ].join('\n');

      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        message,
        { parse_mode: 'HTML' }
      );
    } catch (error) {
      console.error('PNL command error:', error);
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        `❌ Error calculating P&L.`,
        { parse_mode: 'HTML' }
      );
    }
  });
}

/**
 * Format an advanced alert for Telegram
 */
export function formatAdvancedAlert(alert: AdvancedAlert): string {
  const severityEmoji = alert.severity === 'critical' ? '🚨' : alert.severity === 'warning' ? '⚠️' : 'ℹ️';
  const typeEmoji = {
    volume_spike: '📊',
    whale_movement: '🐋',
    liquidity_drain: '💧',
    authority_change: '🔐',
  }[alert.type];

  const lines = [
    `${severityEmoji} <b>ALERT: ${alert.type.replace('_', ' ').toUpperCase()}</b>`,
    ``,
    `${typeEmoji} <b>${alert.name}</b> ($${alert.symbol})`,
    ``,
    `<b>${alert.message}</b>`,
    ``,
  ];

  // Add relevant details
  if (alert.type === 'volume_spike') {
    lines.push(`Previous 1h Volume: $${formatNumber(alert.details.previousVolume1h)}`);
    lines.push(`Current 1h Volume: $${formatNumber(alert.details.currentVolume1h)}`);
    lines.push(`Increase: ${alert.details.multiplier.toFixed(1)}x`);
  } else if (alert.type === 'liquidity_drain') {
    lines.push(`Previous Liquidity: $${formatNumber(alert.details.previousLiquidity)}`);
    lines.push(`Current Liquidity: $${formatNumber(alert.details.currentLiquidity)}`);
    lines.push(`Removed: $${formatNumber(alert.details.amountRemoved)} (${alert.details.percentRemoved.toFixed(1)}%)`);
  } else if (alert.type === 'whale_movement') {
    lines.push(`Wallet: <code>${truncateAddress(alert.details.whaleAddress, 6)}</code>`);
    lines.push(`Change: ${alert.details.previousPercent.toFixed(1)}% → ${alert.details.currentPercent.toFixed(1)}%`);
  } else if (alert.type === 'authority_change') {
    const authType = alert.details.authorityType === 'mint' ? 'Mint' : 'Freeze';
    if (alert.details.wasRevoked) {
      lines.push(`✅ ${authType} authority was revoked`);
    } else if (alert.details.wasGranted) {
      lines.push(`⚠️ ${authType} authority was granted to:`);
      lines.push(`<code>${truncateAddress(alert.details.currentAuthority, 8)}</code>`);
    }
  }

  lines.push(``);
  lines.push(`<code>${alert.tokenMint}</code>`);

  return lines.join('\n');
}
