/**
 * Debug script to test holder fetching
 */
import { Connection, PublicKey } from '@solana/web3.js';

const BONK_MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const RPC_URL = 'https://mainnet.helius-rpc.com/?api-key=ee4906af-c5cf-4919-b17c-fcac06e07be5';

async function testHolders() {
  const connection = new Connection(RPC_URL, 'confirmed');
  const mintPubkey = new PublicKey(BONK_MINT);

  console.log('Testing holder fetch methods for BONK...\n');

  // Method 1: getTokenLargestAccounts
  console.log('Method 1: getTokenLargestAccounts');
  try {
    const response = await connection.getTokenLargestAccounts(mintPubkey);
    console.log(`  Found ${response.value.length} accounts`);
    if (response.value.length > 0) {
      console.log('  Top 5 holders:');
      response.value.slice(0, 5).forEach((acc, i) => {
        console.log(`    ${i + 1}. ${acc.address.toBase58().slice(0, 20)}... - ${acc.uiAmountString}`);
      });
    }
  } catch (error) {
    console.log(`  ❌ Failed: ${(error as Error).message}`);
  }

  console.log('');

  // Method 2: getTokenSupply (to get total supply info)
  console.log('Method 2: getTokenSupply');
  try {
    const supply = await connection.getTokenSupply(mintPubkey);
    console.log(`  Total Supply: ${supply.value.uiAmountString}`);
    console.log(`  Decimals: ${supply.value.decimals}`);
  } catch (error) {
    console.log(`  ❌ Failed: ${(error as Error).message}`);
  }

  process.exit(0);
}

testHolders();
