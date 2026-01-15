import {
  RiskClassification,
  RiskLevel,
  RiskFactor,
  LiquidityAnalysis,
  HolderAnalysis,
  ContractAnalysis,
  SocialAnalysis,
  RugCheckResult,
} from '../types';

interface AnalysisInputs {
  liquidity: LiquidityAnalysis;
  holders: HolderAnalysis;
  contract: ContractAnalysis;
  social: SocialAnalysis;
  rugcheck?: RugCheckResult;
  tokenAge?: number; // seconds since creation
}

/*
 * NEW RISK SCORING SYSTEM (0-100 points)
 *
 * Liquidity Score (25 points max):
 *   $50K+ = 25pts, $20K+ = 20pts, $10K+ = 15pts, $5K+ = 10pts, $1K+ = 5pts
 *
 * LP Security (20 points max):
 *   90%+ burned = 20pts, 50%+ burned = 15pts
 *   50%+ locked = 12pts, any locked = 8pts
 *
 * Holder Distribution (20 points max):
 *   Top 10 <30% = 20pts, <50% = 15pts, <70% = 10pts, <90% = 5pts
 *
 * Contract Safety (20 points max):
 *   Mint revoked = 10pts
 *   Freeze revoked = 10pts
 *   Honeypot = -15pts penalty
 *
 * Token Maturity (15 points max):
 *   >24h = 15pts, >6h = 12pts, >1h = 8pts, >10min = 4pts
 *
 * Risk Levels:
 *   80-100 = LOW (green)
 *   60-79 = MEDIUM (yellow)
 *   40-59 = HIGH (orange)
 *   20-39 = VERY HIGH (red)
 *   0-19 = EXTREME (skull)
 */

export function classifyRisk(inputs: AnalysisInputs): RiskClassification {
  const factors: RiskFactor[] = [];
  let totalScore = 0;

  // Liquidity Score (25 points max)
  const liquidityResult = assessLiquidity(inputs.liquidity);
  factors.push(...liquidityResult.factors);
  totalScore += liquidityResult.score;

  // LP Security (20 points max)
  const lpResult = assessLPSecurity(inputs.liquidity);
  factors.push(...lpResult.factors);
  totalScore += lpResult.score;

  // Holder Distribution (20 points max)
  const holderResult = assessHolders(inputs.holders);
  factors.push(...holderResult.factors);
  totalScore += holderResult.score;

  // Contract Safety (20 points max)
  const contractResult = assessContract(inputs.contract);
  factors.push(...contractResult.factors);
  totalScore += contractResult.score;

  // Token Maturity (15 points max)
  const maturityResult = assessMaturity(inputs.tokenAge);
  factors.push(...maturityResult.factors);
  totalScore += maturityResult.score;

  // Honeypot is an instant failure - no partial score
  if (inputs.contract.isHoneypot) {
    return {
      score: 0,
      level: 'EXTREME',
      factors: [
        ...factors,
        {
          name: 'HONEYPOT DETECTED',
          impact: 100,
          description: inputs.contract.honeypotReason || 'Token appears to be a honeypot - cannot sell',
          passed: false,
        },
      ],
    };
  }

  const finalScore = Math.round(Math.max(0, Math.min(100, totalScore)));
  const level = scoreToLevel(finalScore);

  return {
    score: finalScore,
    level,
    factors,
  };
}

function assessLiquidity(liquidity: LiquidityAnalysis): {
  score: number;
  factors: RiskFactor[];
} {
  const factors: RiskFactor[] = [];
  let score = 0;
  const usd = liquidity.totalLiquidityUsd;

  // Score based on liquidity tiers
  if (usd >= 50000) {
    score = 25;
  } else if (usd >= 20000) {
    score = 20;
  } else if (usd >= 10000) {
    score = 15;
  } else if (usd >= 5000) {
    score = 10;
  } else if (usd >= 1000) {
    score = 5;
  }

  const tier = usd >= 50000 ? 'Excellent' : usd >= 20000 ? 'Good' : usd >= 10000 ? 'Moderate' : usd >= 5000 ? 'Low' : 'Very Low';

  factors.push({
    name: 'Liquidity',
    impact: 25,
    description: `$${formatNum(usd)} liquidity (${tier})`,
    passed: usd >= 10000,
  });

  return { score, factors };
}

function assessLPSecurity(liquidity: LiquidityAnalysis): {
  score: number;
  factors: RiskFactor[];
} {
  const factors: RiskFactor[] = [];
  let score = 0;

  const burnedPct = liquidity.lpBurnedPercent;
  const lockedPct = liquidity.lpLockedPercent;

  // Burned LP is best - permanent and irreversible
  if (burnedPct >= 90) {
    score = 20;
    factors.push({
      name: 'LP Security',
      impact: 20,
      description: `${burnedPct.toFixed(0)}% LP burned (permanent)`,
      passed: true,
    });
  } else if (burnedPct >= 50) {
    score = 15;
    factors.push({
      name: 'LP Security',
      impact: 20,
      description: `${burnedPct.toFixed(0)}% LP burned (partial)`,
      passed: true,
    });
  } else if (lockedPct >= 50) {
    // Locked LP - score depends on lock duration if available
    const lockScore = getLockDurationScore(liquidity.lpLockDuration);
    score = Math.min(16, 8 + lockScore); // Max 16 for locked (burned is better)

    const lockDesc = formatLockDuration(liquidity.lpLockDuration);
    factors.push({
      name: 'LP Security',
      impact: 20,
      description: `${lockedPct.toFixed(0)}% LP locked${lockDesc}`,
      passed: lockScore >= 4,
    });
  } else if (lockedPct > 0 || burnedPct > 0) {
    score = 5;
    factors.push({
      name: 'LP Security',
      impact: 20,
      description: `${burnedPct.toFixed(0)}% burned, ${lockedPct.toFixed(0)}% locked (insufficient)`,
      passed: false,
    });
  } else {
    score = 0;
    factors.push({
      name: 'LP Security',
      impact: 20,
      description: 'LP not burned or locked - high rug risk',
      passed: false,
    });
  }

  return { score, factors };
}

// Score based on lock duration (0-8 points)
function getLockDurationScore(lockDuration?: number): number {
  if (!lockDuration) return 4; // Unknown duration - give partial credit

  const days = lockDuration / (24 * 60 * 60);

  if (days >= 365) return 8;      // 1+ year lock
  if (days >= 180) return 7;      // 6+ months
  if (days >= 90) return 6;       // 3+ months
  if (days >= 30) return 5;       // 1+ month
  if (days >= 7) return 3;        // 1+ week
  if (days >= 1) return 1;        // 1+ day (very short)
  return 0;                       // Less than 1 day (dangerous)
}

function formatLockDuration(lockDuration?: number): string {
  if (!lockDuration) return '';

  const days = lockDuration / (24 * 60 * 60);

  if (days >= 365) return ` (${Math.floor(days / 365)}+ years)`;
  if (days >= 30) return ` (${Math.floor(days / 30)}+ months)`;
  if (days >= 7) return ` (${Math.floor(days / 7)} weeks)`;
  if (days >= 1) return ` (${Math.floor(days)} days - short!)`;
  return ' (<1 day - danger!)';
}

function assessHolders(holders: HolderAnalysis): {
  score: number;
  factors: RiskFactor[];
} {
  const factors: RiskFactor[] = [];
  let score = 0;
  const top10 = holders.top10HoldersPercent;

  // Non-linear scoring: extreme concentration gets exponentially worse
  if (top10 < 30) {
    score = 20;
  } else if (top10 < 50) {
    score = 15;
  } else if (top10 < 70) {
    score = 10;
  } else if (top10 < 85) {
    score = 5;
  } else if (top10 < 95) {
    // Severe concentration penalty
    score = 2;
  } else {
    // Extreme concentration (95%+) - almost certainly a rug
    score = 0;
  }

  const status = top10 < 30 ? 'Excellent' :
                 top10 < 50 ? 'Good' :
                 top10 < 70 ? 'Moderate' :
                 top10 < 85 ? 'Concentrated' :
                 top10 < 95 ? 'Severe' : 'Extreme';

  factors.push({
    name: 'Holder Distribution',
    impact: 20,
    description: `Top 10 hold ${top10.toFixed(1)}% (${status})`,
    passed: top10 < 50,
  });

  // Add whale warning if needed
  if (holders.whaleAddresses.length > 3) {
    factors.push({
      name: 'Whale Alert',
      impact: 5,
      description: `${holders.whaleAddresses.length} wallets with >5%`,
      passed: false,
    });
  }

  // Add holder count factor - non-linear scoring
  if (holders.totalHolders < 10) {
    // Extremely low holders - very risky
    factors.push({
      name: 'Very Low Holders',
      impact: 10,
      description: `Only ${holders.totalHolders} holders - extremely risky`,
      passed: false,
    });
    score = Math.max(0, score - 5); // Additional penalty
  } else if (holders.totalHolders < 25) {
    factors.push({
      name: 'Low Holders',
      impact: 5,
      description: `Only ${holders.totalHolders} holders`,
      passed: false,
    });
  }

  // Single wallet dominance check
  const largestHolder = holders.topHolders[0];
  if (largestHolder && largestHolder.percentage > 50) {
    factors.push({
      name: 'Single Wallet Dominance',
      impact: 15,
      description: `One wallet holds ${largestHolder.percentage.toFixed(1)}%`,
      passed: false,
    });
    score = Math.max(0, score - 8); // Severe penalty for 50%+ single holder
  }

  return { score, factors };
}

function assessContract(contract: ContractAnalysis): {
  score: number;
  factors: RiskFactor[];
} {
  const factors: RiskFactor[] = [];
  let score = 0;

  // Mint authority (10 points)
  if (contract.mintAuthorityRevoked) {
    score += 10;
  }
  factors.push({
    name: 'Mint Authority',
    impact: 10,
    description: contract.mintAuthorityRevoked ? 'Revoked' : 'Active - can mint unlimited tokens',
    passed: contract.mintAuthorityRevoked,
  });

  // Freeze authority (10 points)
  if (contract.freezeAuthorityRevoked) {
    score += 10;
  }
  factors.push({
    name: 'Freeze Authority',
    impact: 10,
    description: contract.freezeAuthorityRevoked ? 'Revoked' : 'Active - can freeze your tokens',
    passed: contract.freezeAuthorityRevoked,
  });

  // Honeypot check
  if (contract.isHoneypot) {
    factors.push({
      name: 'Honeypot',
      impact: 15,
      description: contract.honeypotReason || 'Honeypot detected',
      passed: false,
    });
  }

  // Transfer fee
  if (contract.hasTransferFee && contract.transferFeePercent && contract.transferFeePercent > 5) {
    factors.push({
      name: 'High Transfer Fee',
      impact: 5,
      description: `${contract.transferFeePercent}% transfer fee`,
      passed: false,
    });
  }

  return { score, factors };
}

function assessMaturity(tokenAge?: number): {
  score: number;
  factors: RiskFactor[];
} {
  const factors: RiskFactor[] = [];
  let score = 0;

  if (!tokenAge || tokenAge <= 0) {
    // Unknown age - give partial credit
    score = 4;
    factors.push({
      name: 'Token Age',
      impact: 15,
      description: 'Age unknown',
      passed: false,
    });
    return { score, factors };
  }

  const hours = tokenAge / 3600;
  const minutes = tokenAge / 60;

  if (hours >= 24) {
    score = 15;
    factors.push({
      name: 'Token Age',
      impact: 15,
      description: `${Math.floor(hours / 24)}d ${Math.floor(hours % 24)}h old`,
      passed: true,
    });
  } else if (hours >= 6) {
    score = 12;
    factors.push({
      name: 'Token Age',
      impact: 15,
      description: `${Math.floor(hours)}h old`,
      passed: true,
    });
  } else if (hours >= 1) {
    score = 8;
    factors.push({
      name: 'Token Age',
      impact: 15,
      description: `${Math.floor(hours)}h ${Math.floor(minutes % 60)}m old`,
      passed: false,
    });
  } else if (minutes >= 10) {
    score = 4;
    factors.push({
      name: 'Token Age',
      impact: 15,
      description: `${Math.floor(minutes)}m old (very new)`,
      passed: false,
    });
  } else {
    score = 0;
    factors.push({
      name: 'Token Age',
      impact: 15,
      description: `${Math.floor(minutes)}m old (extremely new)`,
      passed: false,
    });
  }

  return { score, factors };
}

function scoreToLevel(score: number): RiskLevel {
  if (score >= 80) return 'LOW';
  if (score >= 60) return 'MEDIUM';
  if (score >= 40) return 'HIGH';
  if (score >= 20) return 'VERY_HIGH';
  return 'EXTREME';
}

function formatNum(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(2) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toFixed(0);
}

export function getRiskEmoji(level: RiskLevel): string {
  switch (level) {
    case 'LOW': return '🟢';
    case 'MEDIUM': return '🟡';
    case 'HIGH': return '🟠';
    case 'VERY_HIGH': return '🔴';
    case 'EXTREME': return '💀';
  }
}

export function getRiskDescription(level: RiskLevel): string {
  switch (level) {
    case 'LOW':
      return 'Low risk - Most safety checks passed';
    case 'MEDIUM':
      return 'Medium risk - Some concerns but potentially tradeable';
    case 'HIGH':
      return 'High risk - Multiple red flags detected';
    case 'VERY_HIGH':
      return 'Very high risk - Significant danger, proceed with extreme caution';
    case 'EXTREME':
      return 'Extreme risk - Likely scam or rug pull';
  }
}
