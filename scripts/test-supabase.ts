/**
 * Supabase Connection Test
 * Verifies Supabase setup and basic operations
 */

import dotenv from 'dotenv';
import { getSupabaseClient, testConnection, healthCheck } from '../apps/bot/src/database/supabase';
import { supabaseDb } from '../apps/bot/src/database/supabase-db';

dotenv.config();

async function main() {
  console.log('🧪 Supabase Connection Test\n');
  console.log('='.repeat(60));

  // Test 1: Environment variables
  console.log('\n1️⃣  Checking environment variables...');
  const hasUrl = !!process.env.SUPABASE_URL;
  const hasKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (hasUrl) {
    console.log(`   ✅ SUPABASE_URL: ${process.env.SUPABASE_URL?.substring(0, 30)}...`);
  } else {
    console.log('   ❌ SUPABASE_URL not set');
  }

  if (hasKey) {
    console.log(`   ✅ SUPABASE_SERVICE_ROLE_KEY: ${process.env.SUPABASE_SERVICE_ROLE_KEY?.substring(0, 20)}...`);
  } else {
    console.log('   ❌ SUPABASE_SERVICE_ROLE_KEY not set');
  }

  if (!hasUrl || !hasKey) {
    console.log('\n❌ Missing required environment variables');
    console.log('   Please check your .env file');
    process.exit(1);
  }

  // Test 2: Basic connection
  console.log('\n2️⃣  Testing basic connection...');
  try {
    const connected = await testConnection();
    if (connected) {
      console.log('   ✅ Connection successful');
    } else {
      console.log('   ❌ Connection failed');
      process.exit(1);
    }
  } catch (error) {
    console.log('   ❌ Connection error:', (error as Error).message);
    process.exit(1);
  }

  // Test 3: Health check
  console.log('\n3️⃣  Running health check...');
  try {
    const health = await healthCheck();
    if (health.healthy) {
      console.log(`   ✅ Health check passed (latency: ${health.latencyMs}ms)`);
    } else {
      console.log(`   ⚠️  Health check warning: ${health.error}`);
    }
  } catch (error) {
    console.log('   ❌ Health check error:', (error as Error).message);
  }

  // Test 4: Initialize database service
  console.log('\n4️⃣  Initializing database service...');
  try {
    await supabaseDb.initialize();
    console.log('   ✅ Database service initialized');
  } catch (error) {
    console.log('   ❌ Initialization error:', (error as Error).message);
    process.exit(1);
  }

  // Test 5: Query sync_metadata table
  console.log('\n5️⃣  Querying sync_metadata...');
  try {
    const client = getSupabaseClient();
    if (!client) throw new Error('Client not initialized');
    const { data, error } = await client.from('sync_metadata').select('table_name, sync_status').limit(5);

    if (error) {
      console.log('   ❌ Query error:', error.message);
    } else {
      console.log(`   ✅ Retrieved ${data?.length || 0} records:`);
      data?.forEach((row: any) => {
        console.log(`      - ${row.table_name}: ${row.sync_status}`);
      });
    }
  } catch (error) {
    console.log('   ❌ Query error:', (error as Error).message);
  }

  // Test 6: Count records in main tables
  console.log('\n6️⃣  Checking table record counts...');
  const tables = ['token_analysis', 'alert_history', 'pool_discovery', 'token_outcomes'];

  for (const table of tables) {
    try {
      const client = getSupabaseClient();
      if (!client) throw new Error('Client not initialized');
      const { count, error } = await client
        .from(table)
        .select('*', { count: 'exact', head: true });

      if (error) {
        console.log(`   ⚠️  ${table}: error (${error.message})`);
      } else {
        console.log(`   ✅ ${table.padEnd(20)}: ${count?.toString().padStart(6)} records`);
      }
    } catch (error) {
      console.log(`   ❌ ${table}: ${(error as Error).message}`);
    }
  }

  // Test 7: Test write operation
  console.log('\n7️⃣  Testing write operation...');
  try {
    const client = getSupabaseClient();
    if (!client) throw new Error('Client not initialized');
    const testMint = `test-${Date.now()}`;

    const { error: insertError } = await client.from('token_analysis').insert({
      mint: testMint,
      symbol: 'TEST',
      name: 'Test Token',
      risk_score: 50,
      risk_level: 'MEDIUM',
      liquidity_usd: 1000,
      total_holders: 100,
      analyzed_at: new Date().toISOString(),
    });

    if (insertError) {
      console.log('   ❌ Insert failed:', insertError.message);
    } else {
      console.log('   ✅ Insert successful');

      // Clean up test record
      await client.from('token_analysis').delete().eq('mint', testMint);
      console.log('   ✅ Cleanup successful');
    }
  } catch (error) {
    console.log('   ❌ Write test error:', (error as Error).message);
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('✅ All tests completed!\n');
  console.log('Your Supabase setup is ready to use.');
  console.log('Next steps:');
  console.log('  1. Run migrations: npm run db:push (from root)');
  console.log('  2. Migrate data: npm run migrate:data');
  console.log('  3. Update .env: DATABASE_TYPE=supabase');
  console.log('  4. Start bot: npm run dev:bot\n');

  process.exit(0);
}

main().catch((error) => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});
