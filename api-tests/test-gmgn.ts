/**
 * GMGN API Test Script
 * Run with: npx ts-node api-tests/test-gmgn.ts
 */

import axios from 'axios';

const BASE_URL = 'https://gmgn.ai/defi/quotation/v1';

const headers = {
  'Accept': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Origin': 'https://gmgn.ai',
  'Referer': 'https://gmgn.ai/',
};

interface GMGNToken {
  address: string;
  symbol: string;
  name: string;
  price: number;
  price_change_24h?: number;
  volume_24h?: number;
  liquidity?: number;
  holder_count?: number;
  smart_buy_24h?: number;
  smart_sell_24h?: number;
  is_honeypot?: boolean;
  is_verified?: boolean;
  is_renounced?: boolean;
}

interface GMGNResponse {
  code: number;
  msg: string;
  data: {
    rank: GMGNToken[];
  };
}

async function testEndpoint(name: string, url: string): Promise<void> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing: ${name}`);
  console.log(`URL: ${url}`);
  console.log('='.repeat(60));

  try {
    const response = await axios.get<GMGNResponse>(url, { headers, timeout: 15000 });

    if (response.data.code !== 0) {
      console.log(`❌ API Error: ${response.data.msg}`);
      return;
    }

    const tokens = response.data.data?.rank || [];
    console.log(`✅ Success! Found ${tokens.length} tokens\n`);

    // Display first 5 tokens
    tokens.slice(0, 5).forEach((token, i) => {
      const smartNet = (token.smart_buy_24h || 0) - (token.smart_sell_24h || 0);
      const smartEmoji = smartNet > 0 ? '🐋' : smartNet < 0 ? '🚨' : '⚪';

      console.log(`${i + 1}. ${token.symbol} (${token.name})`);
      console.log(`   💰 Price: $${token.price?.toFixed(8) || 'N/A'}`);
      console.log(`   📊 24h Change: ${token.price_change_24h?.toFixed(2) || 'N/A'}%`);
      console.log(`   💧 Liquidity: $${token.liquidity?.toLocaleString() || 'N/A'}`);
      console.log(`   👥 Holders: ${token.holder_count?.toLocaleString() || 'N/A'}`);
      console.log(`   ${smartEmoji} Smart Money: +${token.smart_buy_24h || 0} buys / -${token.smart_sell_24h || 0} sells (net: ${smartNet})`);
      console.log(`   🛡️ Safe: ${!token.is_honeypot ? '✅' : '❌'} | Verified: ${token.is_verified ? '✅' : '❌'} | Renounced: ${token.is_renounced ? '✅' : '❌'}`);
      console.log(`   📍 ${token.address}`);
      console.log('');
    });

  } catch (error: any) {
    if (error.response?.status === 403) {
      console.log(`❌ Cloudflare blocked (403 Forbidden)`);
      console.log(`   Try again in a few seconds or use a different IP`);
    } else if (error.code === 'ECONNABORTED') {
      console.log(`❌ Request timeout`);
    } else {
      console.log(`❌ Error: ${error.message}`);
    }
  }
}

async function main(): Promise<void> {
  console.log('🚀 GMGN API Test Suite');
  console.log('Testing Solana endpoints...\n');

  // Test 1: Trending by Volume
  await testEndpoint(
    'Trending by Volume (1h)',
    `${BASE_URL}/rank/sol/swaps/1h?orderby=volume&direction=desc&filters[]=not_honeypot`
  );

  // Wait a bit to avoid rate limiting
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Test 2: Smart Money Activity
  await testEndpoint(
    'Smart Money Activity (6h)',
    `${BASE_URL}/rank/sol/swaps/6h?orderby=smartmoney&direction=desc&filters[]=not_honeypot`
  );

  await new Promise(resolve => setTimeout(resolve, 2000));

  // Test 3: New Tokens
  await testEndpoint(
    'Newest Tokens (1h)',
    `${BASE_URL}/rank/sol/swaps/1h?orderby=open_timestamp&direction=desc&filters[]=not_honeypot`
  );

  await new Promise(resolve => setTimeout(resolve, 2000));

  // Test 4: Holder Growth
  await testEndpoint(
    'Growing Holder Count (6h)',
    `${BASE_URL}/rank/sol/swaps/6h?orderby=holder_count&direction=desc&filters[]=not_honeypot`
  );

  await new Promise(resolve => setTimeout(resolve, 2000));

  // Test 5: Safe Smart Money Picks
  await testEndpoint(
    'Safe Smart Money (Verified + Renounced)',
    `${BASE_URL}/rank/sol/swaps/6h?orderby=smartmoney&direction=desc&filters[]=not_honeypot&filters[]=verified&filters[]=renounced`
  );

  console.log('\n' + '='.repeat(60));
  console.log('✅ Test suite completed!');
  console.log('='.repeat(60));
}

main().catch(console.error);
