const { createClient } = require('@supabase/supabase-js');
const s = createClient(
  'https://mlxkzuceamdekinwthyg.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1seGt6dWNlYW1kZWtpbnd0aHlnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Njc4NDY4OSwiZXhwIjoyMDkyMzYwNjg5fQ.cLaiKc1okymN66vWDozFmf2SkL-nxBC8HOcrcW5IUvo'
);

async function run() {
  // Create table via REST API (Supabase SQL endpoint)
  const res = await fetch('https://mlxkzuceamdekinwthyg.supabase.co/rest/v1/rpc/exec_sql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1seGt6dWNlYW1kZWtpbnd0aHlnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Njc4NDY4OSwiZXhwIjoyMDkyMzYwNjg5fQ.cLaiKc1okymN66vWDozFmf2SkL-nxBC8HOcrcW5IUvo',
      'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1seGt6dWNlYW1kZWtpbnd0aHlnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Njc4NDY4OSwiZXhwIjoyMDkyMzYwNjg5fQ.cLaiKc1okymN66vWDozFmf2SkL-nxBC8HOcrcW5IUvo'
    },
    body: JSON.stringify({ sql: "CREATE TABLE IF NOT EXISTS parking_config (id text PRIMARY KEY DEFAULT 'main', rows integer NOT NULL DEFAULT 24, cols integer NOT NULL DEFAULT 23);" })
  });
  console.log('Create table:', res.status, await res.text());

  // Insert default config
  const { data, error } = await s.from('parking_config').upsert({ id: 'main', rows: 24, cols: 23 });
  console.log('Insert config:', error || 'OK', data);

  // Verify
  const { data: check } = await s.from('parking_config').select('*');
  console.log('Config:', check);
}
run();
