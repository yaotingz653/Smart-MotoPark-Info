const SUPABASE_URL = "https://mlxkzuceamdekinwthyg.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1seGt6dWNlYW1kZWtpbnd0aHlnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Njc4NDY4OSwiZXhwIjoyMDkyMzYwNjg5fQ.cLaiKc1okymN66vWDozFmf2SkL-nxBC8HOcrcW5IUvo";

async function run() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/`, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`
    }
  });
  if (!res.ok) {
    console.error("Failed:", res.status, await res.text());
    return;
  }
  const swagger = await res.json();
  const def = swagger.definitions.car_parking_spots;
  console.log("car_parking_spots definition properties:", def ? def.properties : "NOT FOUND");
}
run();
