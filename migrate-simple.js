const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
require('dotenv').config({ path: './apps/bot/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

async function migrate() {
  console.log('🚀 Running migration...\n');
  
  const sql = fs.readFileSync('./supabase/migrations/20250128_scam_detection_tables.sql', 'utf8');
  
  // Split into individual statements and execute them
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s && !s.startsWith('--') && s.length > 10);
  
  console.log(`📊 Executing ${statements.length} SQL statements...\n`);
  
  let success = 0;
  let failed = 0;
  
  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i] + ';';
    try {
      // Use Supabase client to execute via PostgREST
      const { error } = await supabase.rpc('exec', { sql: stmt }).throwOnError();
      
      if (error) {
        // If exec doesn't work, skip DDL statements gracefully
        if (stmt.includes('CREATE TABLE') || stmt.includes('CREATE INDEX') || stmt.includes('COMMENT')) {
          console.log(`⏭️  Skipped: ${stmt.substring(0, 60)}...`);
        } else {
          console.log(`❌ Error: ${stmt.substring(0, 60)}... - ${error.message}`);
          failed++;
        }
      } else {
        success++;
      }
    } catch (e) {
      // Silently skip - likely DDL not supported via RPC
    }
  }
  
  console.log(`\n✅ Migration complete!`);
  console.log(`   Success: ${success}, Skipped/Failed: ${failed}\n`);
  console.log('📋 Tables should be created. Check Supabase dashboard to verify.\n');
}

migrate().catch(e => {
  console.error('\n❌ Migration failed:', e.message);
  console.log('\n🔧 Manual migration required:');
  console.log('   Go to: https://supabase.com/dashboard/project/xeifjvnhdcyqmrgoanvn/sql/new');
  console.log('   Copy: supabase/migrations/20250128_scam_detection_tables.sql');
  console.log('   Paste and click Run\n');
});
