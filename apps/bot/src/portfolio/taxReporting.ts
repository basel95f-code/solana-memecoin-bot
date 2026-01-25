/**
 * Tax Reporting
 * Generate tax reports with FIFO cost basis, short/long-term gains, IRS Form 8949 compatible
 */

import { getSupabaseClient } from '../database/supabase';
import { logger } from '../utils/logger';
import { parse } from 'json2csv';

export interface TaxReport {
  year: number;
  userId: string;
  
  // Summary
  totalGains: number;
  totalLosses: number;
  netGainLoss: number;
  
  // Breakdown
  shortTermGains: number;
  shortTermLosses: number;
  longTermGains: number;
  longTermLosses: number;
  
  // Counts
  totalTrades: number;
  shortTermTrades: number;
  longTermTrades: number;
  
  // Trade details
  trades: TaxTrade[];
  
  generatedAt: Date;
}

export interface TaxTrade {
  // Asset info
  symbol: string;
  tokenMint: string;
  
  // Acquisition
  dateAcquired: Date;
  costBasis: number;
  
  // Disposition
  dateSold: Date;
  saleProceeds: number;
  
  // Amounts
  amount: number;
  
  // Gain/Loss
  gainLoss: number;
  gainLossPercent: number;
  
  // Classification
  holdingPeriodDays: number;
  isShortTerm: boolean;
  
  // Transaction details
  txSignature?: string;
}

export interface Form8949Entry {
  description: string;  // "100 BONK"
  dateAcquired: string;
  dateSold: string;
  proceeds: string;
  costBasis: string;
  adjustmentCode: string;
  adjustmentAmount: string;
  gainLoss: string;
}

export class TaxReporting {
  private supabase = getSupabaseClient();
  
  /**
   * Generate tax report for a year
   */
  async generateTaxReport(
    userId: string = 'default',
    year?: number
  ): Promise<TaxReport> {
    const reportYear = year || new Date().getFullYear();
    const startDate = new Date(reportYear, 0, 1);
    const endDate = new Date(reportYear, 11, 31, 23, 59, 59);
    
    logger.info('TaxReporting', `Generating tax report for ${reportYear}`);
    
    // Get all sell trades in the year
    const { data: trades } = await this.supabase
      .from('portfolio_trades')
      .select('*')
      .eq('user_id', userId)
      .in('action', ['sell', 'partial_sell'])
      .gte('timestamp', startDate.toISOString())
      .lte('timestamp', endDate.toISOString())
      .order('timestamp', { ascending: true });
    
    if (!trades || trades.length === 0) {
      return this.getEmptyReport(userId, reportYear);
    }
    
    // Get corresponding purchase info from tax lots
    const taxTrades: TaxTrade[] = [];
    
    for (const trade of trades) {
      // Get tax lots used for this sale
      const { data: lots } = await this.supabase
        .from('portfolio_tax_lots')
        .select('*')
        .eq('position_id', trade.position_id)
        .not('sale_date', 'is', null)
        .order('purchase_date', { ascending: true });
      
      if (!lots || lots.length === 0) {
        // Fallback to trade data
        taxTrades.push({
          symbol: trade.symbol,
          tokenMint: trade.token_mint,
          dateAcquired: new Date(trade.timestamp), // Use same date as fallback
          costBasis: parseFloat(trade.cost_basis) || 0,
          dateSold: new Date(trade.timestamp),
          saleProceeds: parseFloat(trade.value),
          amount: parseFloat(trade.amount),
          gainLoss: parseFloat(trade.realized_pnl) || 0,
          gainLossPercent: parseFloat(trade.realized_pnl_percent) || 0,
          holdingPeriodDays: trade.holding_period_days || 0,
          isShortTerm: trade.is_short_term !== false,
          txSignature: trade.tx_signature,
        });
      } else {
        // Use tax lot data for accurate cost basis
        for (const lot of lots) {
          if (!lot.sale_date) continue;
          
          const saleDate = new Date(lot.sale_date);
          if (saleDate.getFullYear() !== reportYear) continue;
          
          const holdingDays = Math.floor(
            (saleDate.getTime() - new Date(lot.purchase_date).getTime()) / (1000 * 60 * 60 * 24)
          );
          
          taxTrades.push({
            symbol: lot.symbol,
            tokenMint: lot.token_mint,
            dateAcquired: new Date(lot.purchase_date),
            costBasis: parseFloat(lot.cost_basis),
            dateSold: saleDate,
            saleProceeds: parseFloat(lot.sale_value) || 0,
            amount: parseFloat(lot.sale_amount) || 0,
            gainLoss: parseFloat(lot.realized_gain_loss) || 0,
            gainLossPercent: lot.cost_basis > 0
              ? ((parseFloat(lot.realized_gain_loss) || 0) / parseFloat(lot.cost_basis)) * 100
              : 0,
            holdingPeriodDays: holdingDays,
            isShortTerm: holdingDays < 365,
            txSignature: trade.tx_signature,
          });
        }
      }
    }
    
    // Calculate totals
    const shortTermTrades = taxTrades.filter(t => t.isShortTerm);
    const longTermTrades = taxTrades.filter(t => !t.isShortTerm);
    
    const shortTermGains = shortTermTrades
      .filter(t => t.gainLoss > 0)
      .reduce((sum, t) => sum + t.gainLoss, 0);
    
    const shortTermLosses = Math.abs(
      shortTermTrades
        .filter(t => t.gainLoss < 0)
        .reduce((sum, t) => sum + t.gainLoss, 0)
    );
    
    const longTermGains = longTermTrades
      .filter(t => t.gainLoss > 0)
      .reduce((sum, t) => sum + t.gainLoss, 0);
    
    const longTermLosses = Math.abs(
      longTermTrades
        .filter(t => t.gainLoss < 0)
        .reduce((sum, t) => sum + t.gainLoss, 0)
    );
    
    const totalGains = shortTermGains + longTermGains;
    const totalLosses = shortTermLosses + longTermLosses;
    const netGainLoss = totalGains - totalLosses;
    
    logger.info('TaxReporting', `Report generated: ${taxTrades.length} trades, net ${netGainLoss >= 0 ? 'gain' : 'loss'}: $${Math.abs(netGainLoss).toFixed(2)}`);
    
    return {
      year: reportYear,
      userId,
      totalGains,
      totalLosses,
      netGainLoss,
      shortTermGains,
      shortTermLosses,
      longTermGains,
      longTermLosses,
      totalTrades: taxTrades.length,
      shortTermTrades: shortTermTrades.length,
      longTermTrades: longTermTrades.length,
      trades: taxTrades,
      generatedAt: new Date(),
    };
  }
  
  /**
   * Generate IRS Form 8949 entries
   */
  async generateForm8949(
    userId: string = 'default',
    year?: number
  ): Promise<{ shortTerm: Form8949Entry[]; longTerm: Form8949Entry[] }> {
    const report = await this.generateTaxReport(userId, year);
    
    const shortTerm: Form8949Entry[] = [];
    const longTerm: Form8949Entry[] = [];
    
    for (const trade of report.trades) {
      const entry: Form8949Entry = {
        description: `${trade.amount.toFixed(2)} ${trade.symbol}`,
        dateAcquired: trade.dateAcquired.toLocaleDateString('en-US'),
        dateSold: trade.dateSold.toLocaleDateString('en-US'),
        proceeds: trade.saleProceeds.toFixed(2),
        costBasis: trade.costBasis.toFixed(2),
        adjustmentCode: '',
        adjustmentAmount: '0.00',
        gainLoss: trade.gainLoss.toFixed(2),
      };
      
      if (trade.isShortTerm) {
        shortTerm.push(entry);
      } else {
        longTerm.push(entry);
      }
    }
    
    return { shortTerm, longTerm };
  }
  
  /**
   * Export tax report as CSV
   */
  async exportCSV(
    userId: string = 'default',
    year?: number
  ): Promise<string> {
    const report = await this.generateTaxReport(userId, year);
    
    const data = report.trades.map(trade => ({
      Symbol: trade.symbol,
      'Token Mint': trade.tokenMint,
      'Date Acquired': trade.dateAcquired.toLocaleDateString('en-US'),
      'Date Sold': trade.dateSold.toLocaleDateString('en-US'),
      'Amount': trade.amount.toFixed(4),
      'Cost Basis': `$${trade.costBasis.toFixed(2)}`,
      'Sale Proceeds': `$${trade.saleProceeds.toFixed(2)}`,
      'Gain/Loss': `$${trade.gainLoss.toFixed(2)}`,
      'Holding Period (Days)': trade.holdingPeriodDays,
      'Term': trade.isShortTerm ? 'Short-Term' : 'Long-Term',
      'TX Signature': trade.txSignature || '',
    }));
    
    try {
      const csv = parse(data);
      return csv;
    } catch (error) {
      logger.error('TaxReporting', 'Failed to generate CSV', error as Error);
      throw error;
    }
  }
  
  /**
   * Export Form 8949 as CSV
   */
  async exportForm8949CSV(
    userId: string = 'default',
    year?: number
  ): Promise<{ shortTermCSV: string; longTermCSV: string }> {
    const { shortTerm, longTerm } = await this.generateForm8949(userId, year);
    
    try {
      const shortTermCSV = parse(shortTerm);
      const longTermCSV = parse(longTerm);
      
      return { shortTermCSV, longTermCSV };
    } catch (error) {
      logger.error('TaxReporting', 'Failed to generate Form 8949 CSV', error as Error);
      throw error;
    }
  }
  
  /**
   * Get trade history for export
   */
  async getTradeHistory(
    userId: string = 'default',
    startDate?: Date,
    endDate?: Date
  ): Promise<any[]> {
    let query = this.supabase
      .from('portfolio_trades')
      .select('*')
      .eq('user_id', userId)
      .order('timestamp', { ascending: false });
    
    if (startDate) {
      query = query.gte('timestamp', startDate.toISOString());
    }
    
    if (endDate) {
      query = query.lte('timestamp', endDate.toISOString());
    }
    
    const { data: trades } = await query;
    
    return trades || [];
  }
  
  /**
   * Format tax report for display
   */
  formatTaxReport(report: TaxReport): string {
    let output = `📊 Tax Report ${report.year}\n`;
    output += `━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    
    output += `💰 Summary:\n`;
    output += `  Total Gains: $${report.totalGains.toFixed(2)}\n`;
    output += `  Total Losses: $${report.totalLosses.toFixed(2)}\n`;
    output += `  Net Gain/Loss: ${report.netGainLoss >= 0 ? '+' : ''}$${report.netGainLoss.toFixed(2)}\n\n`;
    
    output += `📅 Short-Term (< 1 year):\n`;
    output += `  Trades: ${report.shortTermTrades}\n`;
    output += `  Gains: $${report.shortTermGains.toFixed(2)}\n`;
    output += `  Losses: $${report.shortTermLosses.toFixed(2)}\n`;
    output += `  Net: ${(report.shortTermGains - report.shortTermLosses) >= 0 ? '+' : ''}$${(report.shortTermGains - report.shortTermLosses).toFixed(2)}\n\n`;
    
    output += `📅 Long-Term (≥ 1 year):\n`;
    output += `  Trades: ${report.longTermTrades}\n`;
    output += `  Gains: $${report.longTermGains.toFixed(2)}\n`;
    output += `  Losses: $${report.longTermLosses.toFixed(2)}\n`;
    output += `  Net: ${(report.longTermGains - report.longTermLosses) >= 0 ? '+' : ''}$${(report.longTermGains - report.longTermLosses).toFixed(2)}\n\n`;
    
    output += `📝 Total Transactions: ${report.totalTrades}\n`;
    output += `📆 Generated: ${report.generatedAt.toLocaleString()}\n`;
    
    return output;
  }
  
  /**
   * Get empty report
   */
  private getEmptyReport(userId: string, year: number): TaxReport {
    return {
      year,
      userId,
      totalGains: 0,
      totalLosses: 0,
      netGainLoss: 0,
      shortTermGains: 0,
      shortTermLosses: 0,
      longTermGains: 0,
      longTermLosses: 0,
      totalTrades: 0,
      shortTermTrades: 0,
      longTermTrades: 0,
      trades: [],
      generatedAt: new Date(),
    };
  }
}

export const taxReporting = new TaxReporting();
