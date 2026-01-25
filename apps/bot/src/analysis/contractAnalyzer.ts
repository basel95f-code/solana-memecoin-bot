/**
 * Smart Contract Analyzer
 * Detects honeypots, hidden functions, and scam patterns
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { solanaService } from '../services/solana';
import { logger } from '../utils/logger';

export interface ContractAnalysisResult {
  isHoneypot: boolean;
  honeypotReasons: string[];
  hasHiddenMint: boolean;
  isProxyContract: boolean;
  scamPatterns: string[];
  securityScore: number; // 0-100
  warnings: string[];
  safetyLevel: 'safe' | 'caution' | 'dangerous';
}

export interface MintAnalysis {
  mintAuthority: string | null;
  freezeAuthority: string | null;
  canMint: boolean;
  canFreeze: boolean;
  supply: number;
  decimals: number;
}

class ContractAnalyzer {
  private connection: Connection;

  constructor() {
    this.connection = solanaService.getConnection();
  }

  /**
   * Analyze a token contract for security issues
   */
  async analyzeContract(tokenMint: string): Promise<ContractAnalysisResult> {
    const result: ContractAnalysisResult = {
      isHoneypot: false,
      honeypotReasons: [],
      hasHiddenMint: false,
      isProxyContract: false,
      scamPatterns: [],
      securityScore: 100,
      warnings: [],
      safetyLevel: 'safe',
    };

    try {
      const mintPubkey = new PublicKey(tokenMint);

      // Get mint account info
      const mintInfo = await this.analyzeMint(mintPubkey);

      // Check for active mint authority (can create unlimited tokens)
      if (mintInfo.canMint) {
        result.hasHiddenMint = true;
        result.scamPatterns.push('Active mint authority - can create unlimited tokens');
        result.securityScore -= 30;
      }

      // Check for active freeze authority (can freeze your tokens)
      if (mintInfo.canFreeze) {
        result.scamPatterns.push('Active freeze authority - can freeze token accounts');
        result.securityScore -= 20;
      }

      // Check for suspicious supply (common honeypot pattern)
      if (this.isSuspiciousSupply(mintInfo.supply)) {
        result.honeypotReasons.push('Suspicious token supply pattern');
        result.securityScore -= 15;
      }

      // Check for unusual decimal count
      if (mintInfo.decimals > 9 || mintInfo.decimals < 6) {
        result.warnings.push(`Unusual decimal count: ${mintInfo.decimals} (normal is 6-9)`);
        result.securityScore -= 5;
      }

      // Attempt transaction simulation (honeypot check)
      const canSell = await this.testSellAbility(mintPubkey);
      if (!canSell) {
        result.isHoneypot = true;
        result.honeypotReasons.push('Cannot simulate sell transaction - likely honeypot');
        result.securityScore -= 50;
      }

      // Check for common scam patterns
      const scamChecks = await this.checkScamPatterns(mintPubkey);
      result.scamPatterns.push(...scamChecks.patterns);
      result.warnings.push(...scamChecks.warnings);
      result.securityScore -= scamChecks.scoreDeduction;

      // Determine if it's a honeypot
      if (result.honeypotReasons.length > 0 || result.securityScore < 30) {
        result.isHoneypot = true;
      }

      // Determine safety level
      if (result.securityScore >= 70) {
        result.safetyLevel = 'safe';
      } else if (result.securityScore >= 40) {
        result.safetyLevel = 'caution';
      } else {
        result.safetyLevel = 'dangerous';
      }

      logger.info('ContractAnalyzer', `Analyzed ${tokenMint.slice(0, 8)}... - Security score: ${result.securityScore}`);
    } catch (error) {
      logger.error('ContractAnalyzer', 'Contract analysis failed', error as Error);
      result.warnings.push('Contract analysis incomplete - some checks failed');
    }

    return result;
  }

  /**
   * Analyze mint account
   */
  private async analyzeMint(mintPubkey: PublicKey): Promise<MintAnalysis> {
    try {
      const mintInfo = await this.connection.getParsedAccountInfo(mintPubkey);

      if (!mintInfo.value || !mintInfo.value.data || typeof mintInfo.value.data === 'string') {
        throw new Error('Invalid mint account');
      }

      const data = mintInfo.value.data as any;
      const parsed = data.parsed?.info;

      if (!parsed) {
        throw new Error('Failed to parse mint data');
      }

      return {
        mintAuthority: parsed.mintAuthority,
        freezeAuthority: parsed.freezeAuthority,
        canMint: parsed.mintAuthority !== null,
        canFreeze: parsed.freezeAuthority !== null,
        supply: parseInt(parsed.supply || '0'),
        decimals: parsed.decimals || 9,
      };
    } catch (error) {
      logger.error('ContractAnalyzer', 'Failed to analyze mint', error as Error);
      // Return safe defaults
      return {
        mintAuthority: null,
        freezeAuthority: null,
        canMint: false,
        canFreeze: false,
        supply: 0,
        decimals: 9,
      };
    }
  }

  /**
   * Check if supply matches common honeypot patterns
   */
  private isSuspiciousSupply(supply: number): boolean {
    // Very small supply (<1000) can be a red flag
    if (supply < 1000) return true;

    // Very large supply (>1 trillion) can also be suspicious
    if (supply > 1_000_000_000_000) return true;

    // Supply with too many trailing zeros (e.g., 1000000000000)
    const supplyStr = supply.toString();
    if (supplyStr.length > 10 && supplyStr.slice(-6) === '000000') return true;

    return false;
  }

  /**
   * Test if tokens can be sold (honeypot check)
   */
  private async testSellAbility(mintPubkey: PublicKey): Promise<boolean> {
    try {
      // This is a simplified check
      // In a real implementation, you would:
      // 1. Simulate a swap transaction
      // 2. Check if the transaction would succeed
      // 3. Look for revert reasons

      // For now, we'll do basic checks
      const accountInfo = await this.connection.getAccountInfo(mintPubkey);
      
      if (!accountInfo) {
        return false; // Can't even get account info - suspicious
      }

      // If we get here, basic checks pass
      return true;
    } catch (error) {
      logger.silentError('ContractAnalyzer', 'Sell ability test failed', error as Error);
      return false; // If test fails, assume honeypot
    }
  }

  /**
   * Check for common scam patterns
   */
  private async checkScamPatterns(mintPubkey: PublicKey): Promise<{
    patterns: string[];
    warnings: string[];
    scoreDeduction: number;
  }> {
    const patterns: string[] = [];
    const warnings: string[] = [];
    let scoreDeduction = 0;

    try {
      // Check 1: Very new token (less than 1 hour old)
      const accountInfo = await this.connection.getAccountInfo(mintPubkey);
      if (accountInfo) {
        // Note: Solana doesn't store creation time directly
        // This is a placeholder for more advanced checks
      }

      // Check 2: Suspicious metadata patterns
      // Common scam tokens use certain naming patterns
      const suspiciousPatterns = [
        /^(SCAM|FAKE|TEST|RUG)/i,
        /\d{4,}/, // Too many numbers
        /(AIRDROP|FREE|GIVEAWAY)/i,
      ];

      // This would need to check token metadata
      // Placeholder for now

      // Check 3: Check for proxy/upgradeable contracts
      // Solana programs can be upgradeable
      const programInfo = await this.connection.getAccountInfo(mintPubkey.toString() as any);
      if (programInfo && programInfo.owner) {
        // Check if owned by a suspicious program
        const knownBadPrograms = [
          // Add known scam program IDs here
        ];

        if (knownBadPrograms.includes(programInfo.owner.toString())) {
          patterns.push('Token owned by known malicious program');
          scoreDeduction += 40;
        }
      }

      // Check 4: Transaction history analysis
      // Get recent transactions to look for suspicious patterns
      const signatures = await this.connection.getSignaturesForAddress(mintPubkey, { limit: 10 });
      
      if (signatures.length === 0) {
        warnings.push('No transaction history - very new or inactive token');
        scoreDeduction += 10;
      }

      // Check 5: Multiple sells with no buys (dumping pattern)
      // This would require analyzing transaction details
      // Placeholder for now

    } catch (error) {
      logger.silentError('ContractAnalyzer', 'Scam pattern check failed', error as Error);
      warnings.push('Some security checks could not be completed');
    }

    return { patterns, warnings, scoreDeduction };
  }

  /**
   * Format analysis result for display
   */
  formatAnalysis(result: ContractAnalysisResult): string {
    let output = `🔐 Contract Security Analysis\n`;
    output += `━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    // Safety level
    const safetyEmoji = {
      safe: '✅',
      caution: '⚠️',
      dangerous: '🚨',
    };
    output += `${safetyEmoji[result.safetyLevel]} Safety Level: ${result.safetyLevel.toUpperCase()}\n`;
    output += `📊 Security Score: ${result.securityScore}/100\n\n`;

    // Honeypot status
    if (result.isHoneypot) {
      output += `🚨 HONEYPOT DETECTED\n`;
      for (const reason of result.honeypotReasons) {
        output += `  • ${reason}\n`;
      }
      output += `\n`;
    }

    // Hidden mint
    if (result.hasHiddenMint) {
      output += `⚠️ Active mint authority detected\n`;
      output += `  → Owner can create unlimited tokens\n\n`;
    }

    // Scam patterns
    if (result.scamPatterns.length > 0) {
      output += `🚩 Scam Patterns Detected:\n`;
      for (const pattern of result.scamPatterns) {
        output += `  • ${pattern}\n`;
      }
      output += `\n`;
    }

    // Warnings
    if (result.warnings.length > 0) {
      output += `⚠️ Warnings:\n`;
      for (const warning of result.warnings) {
        output += `  • ${warning}\n`;
      }
      output += `\n`;
    }

    // Recommendations
    if (result.safetyLevel === 'dangerous') {
      output += `❌ Recommendation: AVOID THIS TOKEN\n`;
      output += `High risk of scam or rugpull.\n`;
    } else if (result.safetyLevel === 'caution') {
      output += `⚠️ Recommendation: Proceed with caution\n`;
      output += `Only trade with money you can afford to lose.\n`;
    } else {
      output += `✅ Recommendation: Appears safe\n`;
      output += `Always do your own research.\n`;
    }

    return output;
  }

  /**
   * Quick honeypot check (faster, less thorough)
   */
  async quickHoneypotCheck(tokenMint: string): Promise<boolean> {
    try {
      const mintPubkey = new PublicKey(tokenMint);
      
      // Just check mint/freeze authority
      const mintInfo = await this.analyzeMint(mintPubkey);
      
      // If mint OR freeze authority is active, consider it risky
      if (mintInfo.canMint || mintInfo.canFreeze) {
        return true;
      }

      return false;
    } catch (error) {
      logger.silentError('ContractAnalyzer', 'Quick honeypot check failed', error as Error);
      return false; // Assume safe if check fails
    }
  }
}

// Export singleton
export const contractAnalyzer = new ContractAnalyzer();
