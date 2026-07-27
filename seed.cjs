const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL = "https://mlxkzuceamdekinwthyg.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1seGt6dWNlYW1kZWtpbnd0aHlnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Njc4NDY4OSwiZXhwIjoyMDkyMzYwNjg5fQ.cLaiKc1okymN66vWDozFmf2SkL-nxBC8HOcrcW5IUvo";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const spots = [];
for (let r = 0; r < 24; r++) {
    const row_letter = String.fromCharCode(65 + r);
    for (let c = 0; c < 23; c++) {
        const col_number = String(c + 1).padStart(2, '0');
        spots.push({
            id: `S-${r}-${c}`,
            number: `${row_letter}-${col_number}`,
            status: "available",
            occupied_by: null,
            occupied_at: null,
        });
    }
}

async function run() {
    for (let i = 0; i < spots.length; i += 100) {
        const batch = spots.slice(i, i + 100);
        const { error } = await supabase.from('parking_spots').upsert(batch);
        if (error) {
            console.error(error);
            return;
        }
        console.log(`Inserted ${Math.min(i + 100, spots.length)} / ${spots.length}`);
    }
    console.log("Done!");
}
run();
