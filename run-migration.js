/**
 * Run Scam Detection Tables Migration
 * Executes the SQL migration directly on Supabase
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config({ path: './apps/bot/.env' });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing Supabase credentials in .env file');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function runMigration() {
  console.log('🚀 Running scam detection tables migration...\n');

  // Read the migration SQL file
  const migrationPath = path.join(__dirname, 'supabase', 'migrations', '20250128_scam_detection_tables.sql');
  
  if (!fs.existsSync(migrationPath)) {
    console.error(`❌ Migration file not found: ${migrationPath}`);
    process.exit(1);
  }

  const sql = fs.readFileSync(migrationPath, 'utf8');

  console.log(`📄 Loaded migration file: ${migrationPath}`);
  console.log(`📊 SQL length: ${sql.length} characters\n`);

  try {
    // Execute the SQL via Supabase RPC
    // Note: This uses the Postgres REST API to execute raw SQL
    const { data, error } = await supabase.rpc('exec_sql', { sql_query: sql });

    if (error) {
      // If exec_sql doesn't exist, try alternative method
      if (error.message.includes('function') && error.message.includes('does not exist')) {
        console.log('⚠️  exec_sql function not available');
        console.log('\n📋 MANUAL MIGRATION REQUIRED:\n');
        console.log('1. Go to https://supabase.com/dashboard/project/xeifjvnhdcyqmrgoanvn/editor');
        console.log('2. Click "SQL Editor" in the left sidebar');
        console.log('3. Click "New Query"');
        console.log(`4. Copy the SQL from: ${migrationPath}`);
        console.log('5. Paste and click "Run"\n');
        console.log('Or run this SQL directly:\n');
        console.log('─'.repeat(80));
        console.log(sql.substring(0, 500) + '...');
        console.log('─'.repeat(80));
        return;
      }

      console.error('❌ Migration failed:', error.message);
      process.exit(1);
    }

    console.log('✅ Migration completed successfully!\n');
    console.log('Created tables:');
    console.log('  - bundle_flags');
    console.log('  - funding_traces');
    console.log('  - known_dev_wallets');
    console.log('  - twitter_token_history');
    console.log('  - token_images');
    console.log('\n✅ All scam detection features are now ready!');

  } catch (error) {
    console.error('❌ Error running migration:', error.message);
    process.exit(1);
  }
}

runMigration().catch(console.error);
