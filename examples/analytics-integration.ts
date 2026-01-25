/**
 * Analytics Integration Example
 * Shows how to use analytics in your trading bot
 */

import { analyticsAPI } from '../apps/bot/src/analytics';
import { patternDetector } from '../apps/bot/src/services/patternDetector';
import type { TokenData } from '../apps/bot/src/services/patternDetector';

// ============================================
// Example 1: Enhanced Token Analysis with Analytics
// ============================================

async function analyzeTokenWithInsights(tokenData: TokenData) {
  console.log(`\n📊 Analyzing ${tokenData.symbol}...`);

  // Step 1: Match patterns
  const patterns = await patternDetector.matchToken(tokenData);
  console.log(`Found ${patterns.length} pattern matches`);

  if (patterns.length === 0) {
    console.log('❌ No patterns matched');
    return { action: 'skip', reason: 'No patterns matched' };
  }

  // Step 2: Get pattern performance analytics
  const topPattern = patterns[0];
  const performance = await analyticsAPI.getPatternPerformance(topPattern.patternName);

  if (!performance || !Array.isArray(performance)) {
    console.log('⚠️ No historical data for this pattern');
    return { action: 'low_confidence', reason: 'Insufficient data' };
  }

  const patternPerf = Array.isArray(performance) ? performance[0] : performance;

  console.log(`\n🎯 Pattern: ${patternPerf.patternName}`);
  console.log(`   Win Rate: ${patternPerf.winRate.toFixed(1)}%`);
  console.log(`   Avg Return: ${patternPerf.averageReturnPercent.toFixed(1)}%`);
  console.log(`   Sample Size: ${patternPerf.sampleSize}`);

  // Step 3: Check timing
  const timeInsights = await analyticsAPI.getTimeBasedInsights();
  const currentHour = new Date().getUTCHours();
  const hourPerf = timeInsights.hourly.find(h => h.hour === currentHour);

  console.log(`\n⏰ Current Time: ${currentHour}:00 UTC`);
  console.log(`   Hour Win Rate: ${hourPerf?.winRate.toFixed(1)}%`);

  const bestHours = timeInsights.bestTimes.map(h => h.hour);
  const isGoodTime = bestHours.includes(currentHour);

  console.log(`   Good Time: ${isGoodTime ? '✅' : '❌'} ${isGoodTime ? '(Top 5 hour)' : ''}`);

  // Step 4: Check risk score accuracy
  const riskData = await analyticsAPI.getRiskScoreAccuracy();
  const riskLevel = tokenData.riskScore >= 70 ? 'LOW' :
                   tokenData.riskScore >= 50 ? 'MEDIUM' :
                   tokenData.riskScore >= 30 ? 'HIGH' : 'CRITICAL';

  const riskAccuracy = riskData.byLevel.find(r => r.riskLevel === riskLevel);

  console.log(`\n🛡️ Risk Score: ${tokenData.riskScore} (${riskLevel})`);
  console.log(`   Historical Accuracy: ${riskAccuracy?.actualSuccessRate.toFixed(1)}%`);

  // Step 5: Make decision
  const decision = {
    action: 'skip' as 'buy' | 'watch' | 'skip',
    confidence: 0,
    reasoning: [] as string[],
  };

  // Calculate confidence score
  let confidenceScore = 0;

  if (patternPerf.winRate > 70) {
    confidenceScore += 30;
    decision.reasoning.push(`✅ Strong pattern (${patternPerf.winRate.toFixed(0)}% win rate)`);
  } else if (patternPerf.winRate > 55) {
    confidenceScore += 15;
    decision.reasoning.push(`⚠️ Moderate pattern (${patternPerf.winRate.toFixed(0)}% win rate)`);
  } else {
    decision.reasoning.push(`❌ Weak pattern (${patternPerf.winRate.toFixed(0)}% win rate)`);
  }

  if (isGoodTime) {
    confidenceScore += 20;
    decision.reasoning.push(`✅ Optimal entry time (${currentHour}:00 UTC)`);
  } else {
    decision.reasoning.push(`⚠️ Non-optimal time (best: ${bestHours.join(', ')})`);
  }

  if (patternPerf.sampleSize >= 20) {
    confidenceScore += 10;
    decision.reasoning.push(`✅ Good sample size (${patternPerf.sampleSize})`);
  } else {
    confidenceScore -= 10;
    decision.reasoning.push(`⚠️ Low sample size (${patternPerf.sampleSize})`);
  }

  if (riskAccuracy && riskAccuracy.actualSuccessRate > 60) {
    confidenceScore += 20;
    decision.reasoning.push(`✅ Risk level historically reliable (${riskAccuracy.actualSuccessRate.toFixed(0)}%)`);
  }

  if (patternPerf.averageReturnPercent > 50) {
    confidenceScore += 20;
    decision.reasoning.push(`✅ High avg return (${patternPerf.averageReturnPercent.toFixed(0)}%)`);
  }

  decision.confidence = confidenceScore;

  // Final action
  if (confidenceScore >= 70) {
    decision.action = 'buy';
  } else if (confidenceScore >= 40) {
    decision.action = 'watch';
  } else {
    decision.action = 'skip';
  }

  console.log(`\n📈 DECISION: ${decision.action.toUpperCase()}`);
  console.log(`   Confidence: ${decision.confidence}%`);
  console.log('\n   Reasoning:');
  decision.reasoning.forEach(r => console.log(`   ${r}`));

  return decision;
}

// ============================================
// Example 2: Daily Performance Review
// ============================================

async function dailyPerformanceReview() {
  console.log('\n📊 DAILY PERFORMANCE REVIEW\n');

  const summary = await analyticsAPI.getAnalyticsSummary();

  console.log('='.repeat(50));
  console.log('OVERALL PERFORMANCE');
  console.log('='.repeat(50));

  console.log(`\n🎯 Patterns`);
  console.log(`   Total: ${summary.patterns.totalPatterns}`);
  console.log(`   Avg Win Rate: ${summary.patterns.avgWinRate.toFixed(1)}%`);
  console.log(`   Best: ${summary.patterns.bestPattern}`);

  console.log(`\n⏰ Timing`);
  console.log(`   Best Hour: ${summary.time.bestEntryHour}:00 UTC`);
  console.log(`   Best Day: ${summary.time.bestEntryDay}`);
  console.log(`   Preferred: ${summary.time.weekdayVsWeekend.preferred}`);

  console.log(`\n📈 Lifecycle`);
  console.log(`   Avg Time to Peak: ${summary.lifecycle.avgTimeToPeak.toFixed(1)}h`);
  console.log(`   Success Rate: ${summary.lifecycle.successRate.toFixed(1)}%`);
  console.log(`   Avg Peak: ${summary.lifecycle.avgPeakMultiplier.toFixed(1)}x`);
  console.log(`   24h Survival: ${summary.lifecycle.survivalRate24h.toFixed(1)}%`);

  console.log(`\n🛡️ Risk`);
  console.log(`   Overall Accuracy: ${summary.risk.overallAccuracy.toFixed(1)}%`);
  console.log(`   Optimal Threshold: ${summary.risk.optimalThreshold}`);

  // Get top signals
  console.log('\n='.repeat(50));
  console.log('TOP PERFORMING SIGNALS');
  console.log('='.repeat(50));

  const topSignals = await analyticsAPI.getTopPerformingSignals(5);

  console.log('\n🎯 Best Patterns:');
  topSignals.patterns.slice(0, 5).forEach((p, i) => {
    console.log(`   ${i + 1}. ${p.patternName} - ${p.winRate.toFixed(1)}% (${p.totalMatches} matches)`);
  });

  console.log('\n⏰ Best Entry Times:');
  topSignals.entryTimes.forEach((t, i) => {
    console.log(`   ${i + 1}. ${t.hour}:00 UTC - ${t.winRate.toFixed(1)}% (${t.totalTrades} trades)`);
  });

  console.log('\n🔗 Best Combinations:');
  topSignals.combinations.slice(0, 3).forEach((c, i) => {
    console.log(`   ${i + 1}. ${c.patterns.join(' + ')}`);
    console.log(`      Win Rate: ${c.winRate.toFixed(1)}% (${c.matchCount} matches)`);
  });
}

// ============================================
// Example 3: Pattern Performance Monitoring
// ============================================

async function monitorPatternPerformance(patternName: string) {
  console.log(`\n🔍 Monitoring Pattern: ${patternName}\n`);

  const performance = await analyticsAPI.getPatternPerformance(patternName);

  if (!performance) {
    console.log('❌ Pattern not found');
    return;
  }

  const perf = Array.isArray(performance) ? performance.find(p => p.patternName === patternName) : performance;

  if (!perf) {
    console.log('❌ Pattern not found');
    return;
  }

  console.log('📊 Performance Metrics');
  console.log(`   Type: ${perf.patternType}`);
  console.log(`   Win Rate: ${perf.winRate.toFixed(1)}%`);
  console.log(`   Total Matches: ${perf.totalMatches}`);
  console.log(`   Successful: ${perf.successfulMatches}`);
  console.log(`   Failed: ${perf.failedMatches}`);

  console.log('\n🎯 Accuracy');
  console.log(`   Overall: ${perf.accuracy.toFixed(1)}%`);
  console.log(`   Precision: ${perf.precision.toFixed(1)}%`);
  console.log(`   Recall: ${perf.recall.toFixed(1)}%`);
  console.log(`   F1 Score: ${perf.f1Score.toFixed(1)}`);

  console.log('\n💰 Returns');
  console.log(`   Average: ${perf.averageReturnPercent > 0 ? '+' : ''}${perf.averageReturnPercent.toFixed(1)}%`);
  console.log(`   Median: ${perf.medianReturnPercent > 0 ? '+' : ''}${perf.medianReturnPercent.toFixed(1)}%`);
  console.log(`   Best: +${perf.bestReturnPercent.toFixed(1)}%`);
  console.log(`   Worst: ${perf.worstReturnPercent.toFixed(1)}%`);

  console.log('\n⏱️ Timing');
  console.log(`   Avg Hold Time: ${perf.averageHoldTime.toFixed(1)}h`);
  console.log(`   Avg Time to Peak: ${perf.averageTimeToPeak.toFixed(1)}h`);

  console.log('\n📈 Confidence');
  console.log(`   Score: ${(perf.confidenceScore * 100).toFixed(0)}%`);
  console.log(`   Sample Size: ${perf.sampleSize}`);

  // Recommendation
  console.log('\n💡 Recommendation:');
  if (perf.winRate > 70 && perf.sampleSize >= 20) {
    console.log('   ✅ STRONG - Use with high confidence');
  } else if (perf.winRate > 55 && perf.sampleSize >= 10) {
    console.log('   ⚠️ MODERATE - Use with caution');
  } else if (perf.sampleSize < 10) {
    console.log('   ⏳ INSUFFICIENT DATA - Need more samples');
  } else {
    console.log('   ❌ WEAK - Avoid or review pattern criteria');
  }
}

// ============================================
// Example 4: Risk Score Validation
// ============================================

async function validateRiskScoring() {
  console.log('\n🛡️ RISK SCORE VALIDATION\n');

  const riskData = await analyticsAPI.getRiskScoreAccuracy();

  console.log('='.repeat(50));
  console.log('OVERALL ACCURACY');
  console.log('='.repeat(50));

  console.log(`\nOverall Accuracy: ${riskData.summary.overallAccuracy.toFixed(1)}%`);
  console.log(`Avg Calibration Error: ${riskData.summary.avgCalibrationError.toFixed(1)}%`);
  console.log(`Optimal Threshold: ${riskData.summary.optimalThreshold}`);
  console.log(`Total Samples: ${riskData.summary.totalSamples}`);

  console.log('\n='.repeat(50));
  console.log('BY RISK LEVEL');
  console.log('='.repeat(50));

  for (const level of riskData.byLevel) {
    if (level.totalTokens === 0) continue;

    console.log(`\n${level.riskLevel} (${level.scoreRange.min}-${level.scoreRange.max})`);
    console.log(`   Samples: ${level.totalTokens}`);
    console.log(`   Expected Success: ${level.expectedSuccessRate.toFixed(1)}%`);
    console.log(`   Actual Success: ${level.actualSuccessRate.toFixed(1)}%`);
    console.log(`   Calibration Error: ${level.calibrationError.toFixed(1)}%`);
    console.log(`   Avg Return: ${level.avgReturn > 0 ? '+' : ''}${level.avgReturn.toFixed(1)}%`);

    const status = level.calibrationError < 10 ? '✅ Well calibrated' :
                   level.calibrationError < 20 ? '⚠️ Needs adjustment' :
                   '❌ Poorly calibrated';
    console.log(`   Status: ${status}`);
  }

  console.log('\n='.repeat(50));
  console.log('FEATURE IMPORTANCE');
  console.log('='.repeat(50));

  console.log('\nTop 10 Features:');
  riskData.featureImportance.slice(0, 10).forEach((f, i) => {
    console.log(`   ${i + 1}. ${f.feature.padEnd(20)} ${f.importance.toFixed(1)} (${f.correlation > 0 ? '+' : ''}${f.correlation.toFixed(2)})`);
  });
}

// ============================================
// Run Examples
// ============================================

async function main() {
  console.log('\n🚀 Analytics Integration Examples\n');

  // Example 1: Analyze a sample token
  console.log('\n' + '='.repeat(50));
  console.log('EXAMPLE 1: Enhanced Token Analysis');
  console.log('='.repeat(50));

  await analyzeTokenWithInsights({
    mint: 'sample_mint',
    symbol: 'SAMPLE',
    liquidityUsd: 50000,
    lpBurnedPercent: 85,
    totalHolders: 250,
    top10Percent: 25,
    mintRevoked: true,
    freezeRevoked: true,
    riskScore: 75,
  });

  // Example 2: Daily review
  console.log('\n' + '='.repeat(50));
  console.log('EXAMPLE 2: Daily Performance Review');
  console.log('='.repeat(50));

  await dailyPerformanceReview();

  // Example 3: Monitor specific pattern
  console.log('\n' + '='.repeat(50));
  console.log('EXAMPLE 3: Pattern Performance Monitoring');
  console.log('='.repeat(50));

  await monitorPatternPerformance('Triple Safe Moon');

  // Example 4: Risk validation
  console.log('\n' + '='.repeat(50));
  console.log('EXAMPLE 4: Risk Score Validation');
  console.log('='.repeat(50));

  await validateRiskScoring();

  console.log('\n✅ Examples completed!\n');
}

// Export for use in other files
export {
  analyzeTokenWithInsights,
  dailyPerformanceReview,
  monitorPatternPerformance,
  validateRiskScoring,
};

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}
