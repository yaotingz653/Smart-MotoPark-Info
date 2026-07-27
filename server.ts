import express from 'express';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

const app = express();

// 自訂 CORS 中間件 (允許前端部署網站跨域存取)
app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json());

// 初始化 Supabase 客戶端 (優先讀取後端部署環境變數 SUPABASE_URL 與 SUPABASE_SERVICE_ROLE_KEY)
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn("⚠️ 警告: 缺少 Supabase 連線設定，後端將使用虛擬模式運行！");
}

const supabaseAdmin = createClient(SUPABASE_URL || 'https://dummy.supabase.co', SUPABASE_SERVICE_ROLE_KEY || 'dummy', {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false
  }
});

// --- API 1: QR Code 掃碼接收與驗證 API ---
app.post('/api/qrcode/scan', async (req: express.Request, res: express.Response) => {
  const { spotId, qrcodeData, userId } = req.body;

  console.log(`[後端 API] 收到掃碼請求 - 車位 ID: ${spotId}, 掃碼資料: ${qrcodeData}, 使用者 ID: ${userId}`);

  // 1. 基本欄位防呆
  if (!spotId || !qrcodeData || !userId) {
    return res.status(400).json({
      success: false,
      message: "請求欄位不完整，請提供 spotId、qrcodeData 與 userId"
    });
  }

  // 2. 驗證 QR Code 的合法性（本作業規定的驗證邏輯骨架）
  // 假設合法的 QR Code 資料必須以 "MOTO_PARK_" 開頭，或是特定模擬資料 "MOTO_PARK_MOCK_DATA"
  const isValidQRCode = qrcodeData.startsWith("MOTO_PARK_") || qrcodeData.startsWith("CAR_PARK_");
  if (!isValidQRCode) {
    console.warn(`[後端 API] 掃碼驗證失敗 - 無效的 QR Code 資料: ${qrcodeData}`);
    return res.status(400).json({
      success: false,
      message: "無效的 QR Code 條碼格式，驗證失敗！"
    });
  }

  try {
    const isCar = spotId.startsWith("CAR-");
    const targetTable = isCar ? 'car_parking_spots' : 'parking_spots';

    // 3. 與 Supabase 資料庫串接，更新車位狀態 (比照前端原 reserveSpot 邏輯)
    console.log(`[後端 API] 正在向 Supabase 查詢車位資訊: ${spotId} (${targetTable})`);
    const { data: spotData, error: spotError } = await supabaseAdmin
      .from(targetTable)
      .select('number, status')
      .eq('id', spotId)
      .single();

    if (spotError || !spotData) {
      throw new Error(`找不到該車位資訊: ${spotError?.message || ''}`);
    }

    if (spotData.status === 'disabled') {
      return res.status(400).json({
        success: false,
        message: "該車位已被管理員停用，無法停車！"
      });
    }

    const now = new Date().toISOString();

    // 3.5 確保使用者在 users 資料表中存在，防範外鍵約束報錯
    try {
      await supabaseAdmin.from('users').upsert({
        id: userId,
        name: userId === 'guest-user' ? 'Lin Shang Chung' : 'User',
        role: 'student'
      }, { onConflict: 'id' });
    } catch (e) {
      console.warn('[後端 API] users upsert 警告:', e);
    }

    // 4. 更新 parking_spots 或 car_parking_spots
    console.log(`[後端 API] 正在更新車位 ${spotData.number} 狀態為 occupied...`);
    const { error: updateError } = await supabaseAdmin
      .from(targetTable)
      .update({
        status: 'occupied',
        occupied_by: userId,
        occupied_at: now
      })
      .eq('id', spotId);

    if (updateError) {
      console.warn(`[後端 API] 依 ID 更新失敗，嘗試依 number 更新...`, updateError.message);
      await supabaseAdmin
        .from(targetTable)
        .update({
          status: 'occupied',
          occupied_by: userId,
          occupied_at: now
        })
        .eq('number', spotData.number);
    }

    // 5. 寫入歷史紀錄 parking_history
    console.log(`[後端 API] 正在寫入停車歷史紀錄...`);
    try {
      await supabaseAdmin
        .from('parking_history')
        .insert({
          user_id: userId,
          spot_id: spotId,
          spot_number: spotData.number,
          action: 'reserve',
          start_time: now
        });
    } catch (historyError: any) {
      console.warn(`[後端 API] 寫入歷史紀錄警告:`, historyError.message);
    }

    console.log(`[後端 API] 車位 ${spotData.number} 掃碼預約成功！`);
    return res.json({
      success: true,
      message: `掃碼驗證成功！已成功停入車位 ${spotData.number}`,
      spot: {
        id: spotId,
        number: spotData.number,
        status: 'occupied',
        occupied_by: userId,
        occupied_at: now
      }
    });

  } catch (error: any) {
    console.error("[後端 API] 資料庫操作出錯:", error.message);
    return res.status(500).json({
      success: false,
      message: `伺服器資料庫更新失敗: ${error.message}`
    });
  }
});

// --- API 2: 大樓距離推薦 API (採用靜態映射對照表) ---
const RECOMMENDED_MAP: Record<string, { recommendedLot: string; distance: string; reason: string }> = {
  "綜合教學大樓": { recommendedLot: "C區", distance: "50公尺", reason: "靠近綜合教學大樓西側出口，步行僅需 1 分鐘" },
  "圖書館": { recommendedLot: "A區", distance: "120公尺", reason: "靠近圖書館正門旁機車停放區，安全且有遮雨棚" },
  "行政大樓": { recommendedLot: "B區", distance: "80公尺", reason: "行政大樓後方專屬格位，格位寬敞" },
  "體育館": { recommendedLot: "E區", distance: "150公尺", reason: "體育館側門旁，車位充足且不易擁擠" },
  "主顧樓": { recommendedLot: "主顧樓地下停車場", distance: "10公尺", reason: "主顧樓 B1 地下室專屬停車場，直達電梯，步行僅需 10 公尺" },
  "方濟樓": { recommendedLot: "主顧樓地下停車場", distance: "30公尺", reason: "鄰近主顧樓地下室入口，方便停放" }
};

app.post('/api/recommend-parking', (req: express.Request, res: express.Response) => {
  const { buildingName } = req.body;

  console.log(`[後端 API] 收到大樓距離推薦請求 - 大樓名稱: ${buildingName}`);

  if (!buildingName) {
    return res.status(400).json({
      success: false,
      message: "大樓名稱不可為空"
    });
  }

  // 比對名稱，若無對應大樓，回傳預設推薦 X 區
  const recommendation = RECOMMENDED_MAP[buildingName] || {
    recommendedLot: "X區",
    distance: "200公尺",
    reason: "校園北側外圍停車格，適合所有大樓的備用停車區"
  };

  return res.json({
    success: true,
    buildingName,
    ...recommendation
  });
});

const GUEST_UUID = 'c811008c-077b-4ebc-8db7-2cd18129d584';
function sanitizeUserId(id?: string): string {
  if (!id || id === 'guest-user' || id === 'guest') return GUEST_UUID;
  return id;
}

// --- API 3: 車位預約 API (後端高權限安全寫入) ---
app.post('/api/spots/reserve', async (req: express.Request, res: express.Response) => {
  const rawUserId = req.body.userId;
  const userId = sanitizeUserId(rawUserId);
  const spotId = req.body.spotId;
  const isCar = spotId.startsWith('CAR-');
  const targetTable = isCar ? 'car_parking_spots' : 'parking_spots';
  const now = new Date().toISOString();

  console.log(`[API /api/spots/reserve] 收到預約請求 | userId: ${userId} | spotId: ${spotId} | targetTable: ${targetTable}`);

  let updateError: any = null;
  let historyError: any = null;

  try {
    // 1. 確保 users 資料表中包含該用戶 ID (避免外鍵約束 23503 報錯)
    const { error: userError } = await supabaseAdmin.from('users').upsert({
      id: userId,
      name: userId === GUEST_UUID ? 'Lin Shang Chung' : 'User',
      role: 'student'
    }, { onConflict: 'id' });

    if (userError) {
      console.error('[server.ts] users upsert 失敗:', userError);
    } else {
      console.log(`[server.ts] users upsert 成功 | userId: ${userId}`);
    }

    let spotNumber = spotId.replace('CAR-', '');

    // 1.5 原子性防搶車位檢查: 確保該車位不是他人佔用中
    const { data: currentSpot } = await supabaseAdmin.from(targetTable).select('status, occupied_by, number').eq('id', spotId).single();
    if (currentSpot) {
      if (currentSpot.number) spotNumber = currentSpot.number;
      if (currentSpot.status === 'occupied' && currentSpot.occupied_by && currentSpot.occupied_by !== userId) {
        return res.status(400).json({
          success: false,
          message: `預約失敗：車位 ${spotNumber} 目前已由其他使用者停放中！`
        });
      }
    }

    // 2. 更新車位狀態為 occupied
    const { error: err1 } = await supabaseAdmin.from(targetTable).upsert({
      id: spotId,
      number: spotNumber,
      status: 'occupied',
      occupied_by: userId,
      occupied_at: now
    }, { onConflict: 'id' });

    if (err1) {
      updateError = err1;
      console.error(`[API /api/spots/reserve] updateError:`, updateError);
      return res.status(500).json({ success: false, message: "更新車位狀態失敗", debug: { updateError } });
    } else {
      console.log(`[API /api/spots/reserve] UPDATE 成功 | spotId: ${spotId} | occupied_by: ${userId}`);
    }

    // 3. 寫入歷史紀錄 parking_history
    const vehicleType = isCar ? 'car' : 'moto';
    let { error: err2 } = await supabaseAdmin.from('parking_history').insert({
      user_id: userId,
      spot_id: spotId,
      spot_number: spotNumber,
      vehicle_type: vehicleType,
      action: 'reserve',
      start_time: now
    });

    // 若汽車 ID (CAR-F-03) 觸發 parking_history_spot_id_fkey 外鍵約束，自動以 spotNumber 相容寫入
    if (err2 && (err2.code === '23503' || err2.message.includes('foreign key constraint'))) {
      console.warn(`[API /api/spots/reserve] 汽車 spot_id 外鍵約束，自動降級以 ${spotNumber} 寫入...`);
      const { error: fallbackErr } = await supabaseAdmin.from('parking_history').insert({
        user_id: userId,
        spot_id: spotNumber,
        spot_number: spotNumber,
        action: 'reserve',
        start_time: now
      });
      err2 = fallbackErr;
    }

    if (err2) {
      historyError = err2;
      console.warn(`[API /api/spots/reserve] historyError:`, historyError);
    } else {
      console.log(`[API /api/spots/reserve] INSERT parking_history 成功 | spot_number: ${spotNumber}`);
    }

    return res.json({
      success: true,
      message: `成功預約車位 ${spotNumber}`,
      spot: {
        id: spotId,
        number: spotNumber,
        status: 'occupied',
        occupied_by: userId,
        occupied_at: now
      },
      debug: { userId, spotId, updateError, historyError }
    });
  } catch (error: any) {
    console.error(`[API /api/spots/reserve] 致命失敗:`, error);
    return res.status(500).json({ success: false, message: error.message, debug: { userId, spotId, updateError: error } });
  }
});

// --- API 4: 車位釋放 API ---
app.post('/api/spots/release', async (req: express.Request, res: express.Response) => {
  const userId = sanitizeUserId(req.body.userId);
  const spotId = req.body.spotId;
  const isCar = spotId.startsWith('CAR-');
  const targetTable = isCar ? 'car_parking_spots' : 'parking_spots';
  const now = new Date().toISOString();

  console.log(`[API /api/spots/release] 收到釋放請求 | userId: ${userId} | spotId: ${spotId}`);

  let updateError: any = null;
  let historyError: any = null;

  try {
    let spotNumber = spotId.replace('CAR-', '');
    const { data: spotData } = await supabaseAdmin.from(targetTable).select('number').eq('id', spotId).single();
    if (spotData && spotData.number) spotNumber = spotData.number;

    // 1. 重置車位狀態為 available
    const { error: err1 } = await supabaseAdmin.from(targetTable).upsert({
      id: spotId,
      number: spotNumber,
      status: 'available',
      occupied_by: null,
      occupied_at: null
    }, { onConflict: 'id' });

    if (err1) updateError = err1;

    // 2. 更新歷史紀錄 end_time (相容 spot_id 與 spot_number)
    const { error: err2 } = await supabaseAdmin.from('parking_history').update({
      end_time: now,
      action: 'release'
    }).eq('user_id', userId).or(`spot_id.eq.${spotId},spot_number.eq.${spotNumber}`).is('end_time', null);

    if (err2) historyError = err2;

    console.log(`[API /api/spots/release] 釋放完成 | userId: ${userId} | spotId: ${spotId}`);
    return res.json({ success: true, message: '成功釋放車位', debug: { userId, spotId, updateError, historyError } });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// --- API 5: 車位列表查詢 API ---
app.get('/api/spots/list', async (req: express.Request, res: express.Response) => {
  const vehicleType = (req.query.vehicleType as string) === 'car' ? 'car' : 'moto';
  const userId = sanitizeUserId(req.query.userId as string);
  const targetTable = vehicleType === 'car' ? 'car_parking_spots' : 'parking_spots';

  let getSpotsError: any = null;

  const { data, error } = await supabaseAdmin.from(targetTable).select('*');
  if (error) {
    getSpotsError = error;
    console.error(`[API /api/spots/list] getSpotsError:`, getSpotsError);
    return res.status(500).json({ error });
  }

  // 過濾停用中的停車場並限定標準 ID 前綴 (機車: S-, 汽車: CAR-)
  const expectedPrefix = vehicleType === 'car' ? 'CAR-' : 'S-';
  const activeSpots = (data || []).filter((s: any) =>
    s.status !== 'disabled' && s.is_active !== false && s.id.startsWith(expectedPrefix)
  );

  const mapped = activeSpots.map((spot: any) => {
    const isMine = (spot.status === 'occupied' || spot.status === 'mine') && spot.occupied_by === userId;
    return {
      ...spot,
      status: isMine ? 'mine' : (spot.status === 'mine' ? 'occupied' : spot.status)
    };
  });

  return res.json(mapped);
});

// 啟動 Express 伺服器，監聽在 8000 端口
const PORT = 8000;
app.listen(PORT, '127.0.0.1', () => {
  console.log(`🚀 後端 Express 伺服器已啟動於 http://127.0.0.1:${PORT}`);
  console.log(`👉 已註冊 API: POST /api/qrcode/scan`);
  console.log(`👉 已註冊 API: POST /api/spots/reserve`);
  console.log(`👉 已註冊 API: POST /api/spots/release`);
  console.log(`👉 已註冊 API: GET  /api/spots/list`);
  console.log(`👉 已註冊 API: POST /api/recommend-parking`);
});
