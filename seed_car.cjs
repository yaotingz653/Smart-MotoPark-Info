const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL = "https://mlxkzuceamdekinwthyg.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1seGt6dWNlYW1kZWtpbnd0aHlnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Njc4NDY4OSwiZXhwIjoyMDkyMzYwNjg5fQ.cLaiKc1okymN66vWDozFmf2SkL-nxBC8HOcrcW5IUvo";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const carSpots = [];
// 建立一個 8 x 8 的汽車停車場網格
for (let r = 0; r < 8; r++) {
    const row_letter = String.fromCharCode(65 + r); // A to H
    for (let c = 0; c < 8; c++) {
        const col_number = String(c + 1).padStart(2, '0'); // 01 to 08
        carSpots.push({
            id: `CAR-${r}-${c}`,
            number: `CAR-${row_letter}-${col_number}`,
            status: "available",
            occupied_by: null,
            occupied_at: null,
        });
    }
}

async function run() {
    console.log("正在為 car_parking_spots 資料表寫入 64 個汽車停車位...");
    const { data, error } = await supabase.from('car_parking_spots').upsert(carSpots);
    if (error) {
        console.error("寫入失敗:", error);
        return;
    }
    console.log("🎉 汽車車位寫入成功，共 64 個位子！");
}
run();
