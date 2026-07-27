const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = "https://mlxkzuceamdekinwthyg.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1seGt6dWNlYW1kZWtpbnd0aHlnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Njc4NDY4OSwiZXhwIjoyMDkyMzYwNjg5fQ.cLaiKc1okymN66vWDozFmf2SkL-nxBC8HOcrcW5IUvo";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const PARKING_LOT_CENTER = {
  lat: 24.2251689,
  lng: 120.578790
};

// 指定 Demo 重點車位的精確座標
const specificCoordinates = {
  "A-05": { lat: 24.22516892163691, lng: 120.57879023907887 },
  "B-18": { lat: 24.225055793461078, lng: 120.5787533587048 },
  "E-15": { lat: 24.22511633233524, lng: 120.5786326592987 },
  "X-20": { lat: 24.225141403983894, lng: 120.57814650891393 },
  "C-04": { lat: 24.225080, lng: 120.578680 } // 👉 新增全新 C-04 精確座標，靠近走道
};

async function run() {
  console.log("1. 正在執行資料庫遷移：新增 latitude 與 longitude 欄位...");
  
  const sql = `
    ALTER TABLE parking_spots ADD COLUMN IF NOT EXISTS latitude double precision;
    ALTER TABLE parking_spots ADD COLUMN IF NOT EXISTS longitude double precision;
  `;
  
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`
    },
    body: JSON.stringify({ sql })
  });
  
  if (!res.ok) {
    console.error("❌ SQL 執行失敗:", res.status, await res.text());
    return;
  }
  console.log("✅ 成功在 parking_spots 中新增經緯度欄位！");

  console.log("2. 正在計算 552 個車位的規則分佈經緯度座標...");
  const spots = [];
  
  for (let r = 0; r < 24; r++) {
    const row_letter = String.fromCharCode(65 + r);
    for (let c = 0; c < 23; c++) {
      const col_number = String(c + 1).padStart(2, '0');
      const spotNumber = `${row_letter}-${col_number}`;
      
      let lat, lng;
      
      // 如果有特別指定的精確座標，就使用指定的
      if (specificCoordinates[spotNumber]) {
        lat = specificCoordinates[spotNumber].lat;
        lng = specificCoordinates[spotNumber].lng;
      } else {
        // 否則，依照行列規律，在停車場中心點周圍做微幅偏移排列，讓地圖非常整齊
        lat = PARKING_LOT_CENTER.lat + (r - 12) * 0.000018;
        lng = PARKING_LOT_CENTER.lng + (c - 11) * 0.000028;
      }
      
      spots.push({
        id: `S-${r}-${c}`,
        number: spotNumber,
        latitude: lat,
        longitude: lng
      });
    }
  }

  console.log("3. 正在將生成的經緯度座標批量 Upsert 寫入 Supabase 中...");
  for (let i = 0; i < spots.length; i += 100) {
    const batch = spots.slice(i, i + 100);
    const { error } = await supabase.from('parking_spots').upsert(batch);
    if (error) {
      console.error("❌ Upsert 批次失敗:", error);
      return;
    }
    console.log(`Inserted ${Math.min(i + 100, spots.length)} / ${spots.length}`);
  }
  
  console.log("🎉 座標去寫死化資料庫初始化完成！");
}

run();
