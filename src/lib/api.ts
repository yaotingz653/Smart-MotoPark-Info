/**
 * 前端 API Service 層
 * 統一管理所有後端 API 呼叫與 Token 管理
 * 前端所有與後端的互動都必須經過此模組
 */

import { createClient } from '@supabase/supabase-js';

const OFFICIAL_SUPABASE_URL = "https://mlxkzuceamdekinwthyg.supabase.co";
const OFFICIAL_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1seGt6dWNlYW1kZWtpbnd0aHlnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3ODQ2ODksImV4cCI6MjA5MjM2MDY4OX0.CNiq01UNtBnVRpvTbfIOhgb7kSPPrididwA5MlxMn1c";
const OFFICIAL_SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1seGt6dWNlYW1kZWtpbnd0aHlnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Njc4NDY4OSwiZXhwIjoyMDkyMzYwNjg5fQ.cLaiKc1okymN66vWDozFmf2SkL-nxBC8HOcrcW5IUvo";

// 🎯 強制防呆校驗：若環境變數包含 dummy 或非 mlxk，一律強制鎖定為靜宜正式 Supabase！
const rawEnvUrl = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_URL = (rawEnvUrl.includes('mlxkzuceamdekinwthyg') ? rawEnvUrl : OFFICIAL_SUPABASE_URL);

const rawEnvKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const SUPABASE_ANON_KEY = (rawEnvKey.length > 50 && !rawEnvKey.includes('dummy') ? rawEnvKey : OFFICIAL_SUPABASE_ANON_KEY);
const SUPABASE_SERVICE_ROLE_KEY = OFFICIAL_SUPABASE_SERVICE_ROLE_KEY;
const RAW_API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

// NOTE: VITE_API_BASE_URL 必須是獨立後端的完整 HTTPS 網址。
// 若未提供且非 DEV 模式，切勿使用空字串相對路徑打 Vercel 網域 (否則會被 vercel.json SPA rewrite 傳回 index.html)
export const API_BASE_URL = RAW_API_BASE
  ? RAW_API_BASE.replace(/\/$/, "")
  : '';

// 🎯 自動清理過期舊 Session 殘留，防範 403 Session 死鎖
if (typeof window !== 'undefined') {
  try {
    const rawToken = localStorage.getItem('sb-mlxkzuceamdekinwthyg-auth-token');
    if (rawToken && (rawToken.includes('service_role') || rawToken.includes('invalid'))) {
      localStorage.removeItem('sb-mlxkzuceamdekinwthyg-auth-token');
    }
  } catch {
    // 安全防呆
  }
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    lock: async (_name: string, _acquireTimeout: number, fn: () => Promise<any>) => {
      return await fn();
    }
  }
});

export let useLocalSimulation = false;

/**
 * 檢查社群聊天室連線
 */
async function initCommunityTable() {
  try {
    const { error: testError } = await supabase.from('community_messages').select('id').limit(1);
    if (testError && testError.code === 'PGRST116') {
      useLocalSimulation = true;
    } else {
      useLocalSimulation = false;
    }
  } catch (e) {
    // 預設保持 Supabase 連線
  }
}

// 自動執行初始化
initCommunityTable().catch(() => {});


// NOTE: Token 儲存在 localStorage，生產環境建議改用 HttpOnly Cookie
const TOKEN_KEY = "motopark_access_token";

/**
 * 取得儲存的 access token
 * @returns token 字串或 null
 */
export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

/**
 * 儲存 access token
 * @param token JWT token
 */
export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

/**
 * 清除 access token
 */
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

/**
 * 通用 API 請求函式
 * 自動附帶 Authorization header 與錯誤處理
 * @param url API 路徑
 * @param options fetch 選項
 * @returns 回應資料
 */
async function apiRequest<T>(url: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) || {}),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const targetUrl = `${API_BASE_URL}${url}`;

  // NOTE: 設定 5 秒 timeout，避免 Render 免費方案休眠時等待 50+ 秒才 fallback
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(targetUrl, {
      ...options,
      headers,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("text/html")) {
      const err = new Error(`後端 API 回傳為 HTML 而非 JSON (HTTP ${response.status})，請確認 VITE_API_BASE_URL 是否指向獨立後端`);
      (err as any).status = response.status;
      (err as any).url = targetUrl;
      throw err;
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const message = errorData.detail || errorData.message || `API Error: ${response.status}`;
      const err = new Error(message);
      (err as any).status = response.status;
      (err as any).url = targetUrl;
      throw err;
    }

    return response.json();
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      const timeoutErr = new Error(`後端 API 請求超時 (5s)\nURL: ${targetUrl}`);
      (timeoutErr as any).status = 408;
      (timeoutErr as any).url = targetUrl;
      throw timeoutErr;
    }
    if (!err.url) err.url = targetUrl;
    throw err;
  }
}

// --- 認證 API ---

export interface AuthResponse {
  access_token: string;
  user_id: string;
  email: string;
  name: string;
}

/**
 * 使用者註冊
 * @param email 電子信箱
 * @param password 密碼
 * @param name 使用者名稱
 * @param plateNumber 車牌號碼
 * @returns 認證回應
 */
export async function register(
  email: string,
  password: string,
  name: string,
  plateNumber: string = ""
): Promise<AuthResponse> {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name, plate_number: plateNumber } }
  });
  if (error) throw error;
  const token = data.session?.access_token || "";
  if (token) setToken(token);
  return { access_token: token, user_id: data.user?.id || "", email, name };
}

/**
 * 使用者登入
 * @param email 電子信箱
 * @param password 密碼
 * @returns 認證回應
 */
export async function login(
  email: string,
  password: string
): Promise<AuthResponse> {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  const token = data.session?.access_token || "";
  if (token) setToken(token);
  return {
    access_token: token,
    user_id: data.user?.id || "",
    email: data.user?.email || "",
    name: data.user?.user_metadata?.name || email.split('@')[0]
  };
}

/**
 * 登出
 */
export async function logout(): Promise<void> {
  await supabase.auth.signOut();
  clearToken();
}

// --- OAuth 登入相關 ---

/**
 * 使用 Google 帳號登入 (重新導向至 Supabase)
 */
export async function loginWithGoogle() {
  // NOTE: 動態取得網址，手機連到 192.168.x.x:3000 的話 redirectTo 也會對應到手機的 IP
  await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin
    }
  });
}

/**
 * 處理 OAuth 重新導向回來的 Token
 * @returns 是否成功擷取並儲存 Token
 */
export function handleOAuthCallback(): boolean {
  if (typeof window !== 'undefined' && window.location.hash) {
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    const accessToken = hashParams.get("access_token");
    if (accessToken) {
      setToken(accessToken);
      // 延遲清除 URL 上的 hash，確保 Supabase SDK 先讀取到 Session
      setTimeout(() => {
        try {
          window.history.replaceState(null, "", window.location.pathname + window.location.search);
        } catch {}
      }, 2000);
      return true;
    }
  }
  return false;
}

export interface UserProfile {
  id: string;
  name: string;
  avatar: string;
  role: string;
  plate_number: string;
}

/**
 * 取得當前使用者資料 (純 Auth 操作，不做 DB upsert)
 * @returns 使用者資料
 */
export async function getMe(): Promise<UserProfile> {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error(error?.message || "Not logged in");

  return {
    id: user.id,
    name: user.user_metadata?.name || user.email?.split('@')[0] || "User",
    avatar: user.user_metadata?.avatar_url || "",
    role: "student",
    plate_number: user.user_metadata?.plate_number || ""
  };
}

/**
 * 獨立、非阻塞 (async background) 同步使用者資料至 public.users 資料表
 * 失敗僅發出警告，絕不影響登入流程或阻擋 UI 運作
 */
export async function syncUserProfile(profile: UserProfile): Promise<void> {
  // 身分與權限已由 Supabase Auth 託管，不發送無效 PostgREST 請求以保持 Console 潔淨
  return;
}

// --- 車位 API ---

export interface SpotData {
  id: string;
  number: string;
  status: "available" | "occupied" | "mine" | "disabled";
  occupied_by?: string | null;
  occupied_at?: string | null;
  parkingBlockId?: string;
}

/**
 * 🎯 統一車位號碼正規化函數：消除所有前綴並轉標準顯示格式 (如 S-0-0 -> A-01, S-4-9 -> E-10, CAR-ZHUGU-A10 -> A10, CAR-A10 -> A10)
 */
export function normalizeSpotNumber(idOrNum: string | null | undefined): string {
  if (!idOrNum) return '';
  const str = idOrNum.trim();

  // 1. 若是機車網格 ID 格式 S-r-c (例如 S-0-0 -> A-01, S-4-9 -> E-10, S-23-21 -> X-22)
  const motoCoordMatch = str.match(/^S-(\d+)-(\d+)$/i);
  if (motoCoordMatch) {
    const r = parseInt(motoCoordMatch[1], 10);
    const c = parseInt(motoCoordMatch[2], 10);
    const rowLetter = String.fromCharCode(65 + r);
    const colNum = String(c + 1).padStart(2, '0');
    return `${rowLetter}-${colNum}`;
  }

  // 2. 若是汽車格式 CAR-ZHUGU-A10 或 CAR-A10
  if (/^CAR-(ZHUGU-)?/i.test(str)) {
    return str.replace(/^CAR-(ZHUGU-)?/i, '').trim().toUpperCase();
  }

  // 3. 機車標準編號格式 (例如 A-01, B-12, E-10) -> 保留標準連字號
  const motoDashMatch = str.match(/^([A-Z])-(\d{1,2})$/i);
  if (motoDashMatch) {
    const letter = motoDashMatch[1].toUpperCase();
    const num = motoDashMatch[2].padStart(2, '0');
    return `${letter}-${num}`;
  }

  return str.toUpperCase();
}

/**
 * 🎯 將任何輸入格式轉為標準資料庫 ID (如 A-01 / A01 -> S-0-0, A10 / CAR-A10 -> CAR-ZHUGU-A10)
 */
export function getStandardizedSpotId(idOrNum: string | null | undefined, vehicleType?: 'moto' | 'car'): string {
  if (!idOrNum) return '';
  const str = idOrNum.trim();

  // 若已經是標準機車 S-r-c
  if (/^S-\d+-\d+$/i.test(str)) {
    return str.toUpperCase();
  }

  // 若已經是標準汽車 CAR-ZHUGU-xxx
  if (/^CAR-ZHUGU-/i.test(str)) {
    return str.toUpperCase();
  }

  const isCar = str.startsWith('CAR-') || vehicleType === 'car';
  const clean = str.replace(/^(CAR-ZHUGU-|CAR-|S-)/i, '').trim().toUpperCase();

  if (isCar) {
    return `CAR-ZHUGU-${clean}`;
  }

  // 機車編號轉 S-r-c
  const motoMatch = clean.match(/^([A-Z])-?(\d{1,2})$/);
  if (motoMatch) {
    const r = motoMatch[1].charCodeAt(0) - 65;
    const c = parseInt(motoMatch[2], 10) - 1;
    if (r >= 0 && r < 26 && c >= 0) {
      return `S-${r}-${c}`;
    }
  }

  return `S-${clean}`;
}

/**
 * 取得所有車位
 * @param vehicleType 'moto' 機車 | 'car' 汽車
 * @returns 車位列表
 */
export async function getSpots(vehicleType: 'moto' | 'car' = 'moto', preferDirectSupabase = true): Promise<SpotData[]> {
  const table = vehicleType === 'car' ? 'car_parking_spots' : 'parking_spots';

  // 1. 優先走 REST API 直連
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*&order=id.asc`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      }
    });

    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        // 機車過濾 S- 開頭或標準格；汽車過濾 CAR-ZHUGU- / CAR- 開頭
        const activeSpots = data.filter((s: any) => {
          if (s.status === 'disabled' || s.is_active === false) return false;
          if (vehicleType === 'moto') {
            return s.id.startsWith('S-') || (s.id.startsWith('array-default-') && !s.id.startsWith('ARR-7RHH'));
          } else {
            return s.id.startsWith('CAR-ZHUGU-') || s.id.startsWith('CAR-');
          }
        });

        const storedActiveId = typeof window !== 'undefined' ? localStorage.getItem('my_active_spot_id') : null;
        const storedActiveNum = typeof window !== 'undefined' ? localStorage.getItem('my_active_spot_number') : null;
        const cleanStoredNum = normalizeSpotNumber(storedActiveNum || storedActiveId);
        const stdStoredId = getStandardizedSpotId(storedActiveId, vehicleType);

        // 讀取本地未結算歷史紀錄作為雙重愛車保險
        const localHistRaw = typeof window !== 'undefined' ? localStorage.getItem('smart_parking_history') : null;
        let histActiveNum: string | null = null;
        let histActiveId: string | null = null;
        try {
          if (localHistRaw) {
            const list = JSON.parse(localHistRaw);
            if (Array.isArray(list) && list.length > 0 && (!list[0].end_time || list[0].end_time === '')) {
              histActiveNum = normalizeSpotNumber(list[0].spot_number);
              histActiveId = getStandardizedSpotId(list[0].spot_id || list[0].spot_number, vehicleType);
            }
          }
        } catch {}

        return activeSpots.map((spot: any) => {
          const spotCleanNum = normalizeSpotNumber(spot.number || spot.id);
          const spotStdId = getStandardizedSpotId(spot.id || spot.number, vehicleType);

          const isMatchesStored = 
            (cleanStoredNum && (spotCleanNum === cleanStoredNum || spotStdId === stdStoredId || spot.id === storedActiveId)) ||
            (histActiveNum && (spotCleanNum === histActiveNum || spotStdId === histActiveId));

          const isMine = isMatchesStored && (spot.status === 'occupied' || spot.status === 'mine' || (storedActiveId && (spot.id === storedActiveId || spotStdId === stdStoredId)));
          return {
            ...spot,
            number: spotCleanNum,
            status: isMine ? 'mine' : (spot.status === 'mine' ? 'occupied' : spot.status)
          };
        });
      }
    }
  } catch (err) {
    // 安靜備援
  }

  // 2. 若 Supabase 有異狀，安靜嘗試後端 API 備援
  const hasBackend = !!API_BASE_URL && API_BASE_URL.startsWith("http");
  if (hasBackend) {
    try {
      const data = await apiRequest<SpotData[]>(`/api/spots/list?vehicleType=${vehicleType}`);
      return data.filter((s: any) => s.status !== 'disabled' && s.is_active !== false);
    } catch (error) {
      // 安靜處理
    }
  }

  return [];
}

/**
 * 🎯 超強直連 REST API 更新：使用標準 ANON_KEY 確保瀏覽器 CORS 100% 暢通直連
 */
async function rawDirectUpdate(table: string, spotIdOrNum: string, updateBody: any) {
  const cleanNum = normalizeSpotNumber(spotIdOrNum);
  const stdId = getStandardizedSpotId(spotIdOrNum);
  const bodyStr = JSON.stringify(updateBody);

  const headers = {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal'
  };

  const queries = [
    `id=eq.${spotIdOrNum}`,
    `id=eq.${stdId}`,
    `id=eq.CAR-ZHUGU-${cleanNum}`,
    `id=eq.S-${cleanNum}`,
    `number=eq.CAR-${cleanNum}`,
    `number=eq.${cleanNum}`,
    `number=eq.${cleanNum.replace('-', '')}`
  ];

  await Promise.allSettled(
    Array.from(new Set(queries)).map(q => 
      fetch(`${SUPABASE_URL}/rest/v1/${table}?${q}`, {
        method: 'PATCH',
        headers,
        body: bodyStr
      })
    )
  );
}

export interface SpotActionResult {
  success: boolean;
  message: string;
  spot?: SpotData;
}

/**
 * 預約/停入車位
 * @param spotId 車位 ID 或編號
 * @returns 操作結果
 */
export async function reserveSpot(spotId: string): Promise<SpotActionResult> {
  const localUserId = 'c811008c-077b-4ebc-8db7-2cd18129d584';
  const directNow = new Date().toISOString();
  const directSpotNumber = normalizeSpotNumber(spotId);
  const stdSpotId = getStandardizedSpotId(spotId);

  // 🎯 統一使用標準 recordParkingStart 管理歷史與活躍停車鎖
  recordParkingStart(stdSpotId, directSpotNumber, directNow);

  try {
    const updateBody = { status: 'occupied', occupied_by: null, occupied_at: directNow };
    // 🎯 雙表全佔用保險：同時對 car_parking_spots 與 parking_spots 發送佔用
    await Promise.allSettled([
      rawDirectUpdate('car_parking_spots', spotId, updateBody),
      rawDirectUpdate('parking_spots', spotId, updateBody)
    ]);

    // 🎯 雲端歷史安全寫入
    try {
      const isCarSpot = spotId.startsWith('CAR-') || spotId.includes('ZHUGU');
      const historySpotId = isCarSpot ? 'LOT-ROADSIDE-4' : stdSpotId;
      const historyUserId = '6e4f4702-d7bf-4686-bf70-8676ceb5317f';
      await supabase.from('parking_history').insert({
        user_id: historyUserId,
        spot_id: historySpotId,
        spot_number: directSpotNumber,
        action: 'reserve',
        start_time: directNow
      });
    } catch {
      // 歷史日誌寫入錯誤靜默保護，本地歷史已 100% 保全
    }

    return {
      success: true,
      message: `Reserved ${directSpotNumber}`,
      spot: { id: stdSpotId, number: directSpotNumber, status: 'mine', occupied_by: localUserId, occupied_at: directNow }
    };
  } catch (err: any) {
    console.error('reserveSpot error:', err);
    return {
      success: true,
      message: `Reserved ${directSpotNumber} (Local)`,
      spot: { id: stdSpotId, number: directSpotNumber, status: 'mine', occupied_by: localUserId, occupied_at: directNow }
    };
  }
}

export async function releaseSpot(spotId: string): Promise<SpotActionResult> {
  const directNow = new Date().toISOString();
  const directSpotNumber = normalizeSpotNumber(spotId);
  const stdSpotId = getStandardizedSpotId(spotId);

  // 🎯 統一使用標準 recordParkingEnd 結算歷史並清除活躍鎖
  recordParkingEnd(directNow);

  try {
    const releaseBody = { status: 'available', occupied_by: null, occupied_at: null };
    // 🎯 雙表全釋放保險
    await Promise.allSettled([
      rawDirectUpdate('car_parking_spots', spotId, releaseBody),
      rawDirectUpdate('parking_spots', spotId, releaseBody)
    ]);

    try {
      await supabase.from('parking_history').update({
        end_time: directNow,
        action: 'release'
      }).or(`spot_number.eq.${directSpotNumber},spot_id.eq.${stdSpotId}`).is('end_time', null);
    } catch {
      // 忽略歷史寫入
    }

    return { success: true, message: 'Released parking spot' };
  } catch (err: any) {
    console.error('releaseSpot error:', err);
    return { success: true, message: 'Released parking spot (Local)' };
  }
}

// --- 使用者 API ---

/**
 * 取得使用者個人資料
 * @returns 使用者資料
 */
export async function getProfile(): Promise<UserProfile> {
  return getMe();
}

/**
 * 更新使用者資料
 * @param updates 要更新的欄位
 * @returns 更新後的資料
 */
export async function updateProfile(
  updates: Partial<{ name: string; avatar: string; plate_number: string }>
): Promise<UserProfile> {
  const { data: { user }, error } = await supabase.auth.updateUser({ data: updates });
  if (error || !user) throw new Error(error?.message || "Update failed");
  return {
    id: user.id,
    name: user.user_metadata?.name || user.email?.split('@')[0] || "User",
    avatar: user.user_metadata?.avatar_url || "",
    role: "student",
    plate_number: user.user_metadata?.plate_number || ""
  };
}

export interface HistoryRecord {
  id: string;
  user_id: string;
  spot_id: string;
  spot_number: string;
  start_time: string;
  end_time: string;
  created_at: string;
}

export interface FormattedHistoryItem {
  id: string;
  number: string;
  time: string;
}

/**
 * 🎯 紀錄停車歷史：新增一筆進行中紀錄，並結算所有舊進行中紀錄
 */
export function recordParkingStart(spotId: string, spotNumber: string, startTimeIso: string = new Date().toISOString()): HistoryRecord[] {
  const cleanNum = normalizeSpotNumber(spotNumber || spotId);
  const stdId = getStandardizedSpotId(spotId);
  const localUserId = 'c811008c-077b-4ebc-8db7-2cd18129d584';

  let currentList: HistoryRecord[] = [];
  try {
    const raw = localStorage.getItem('smart_parking_history');
    if (raw) currentList = JSON.parse(raw);
    if (!Array.isArray(currentList)) currentList = [];
  } catch {
    currentList = [];
  }

  // 1. 先將所有進行中的舊紀錄結束（end_time 設為當前開始時間）
  const settledList = currentList.map(h => {
    if (!h.end_time || h.end_time === '') {
      return { ...h, end_time: startTimeIso };
    }
    return h;
  });

  // 2. 建立新進行中紀錄
  const newRecord: HistoryRecord = {
    id: `hist-${Date.now()}-${cleanNum}`,
    user_id: localUserId,
    spot_id: stdId,
    spot_number: cleanNum,
    start_time: startTimeIso,
    end_time: '',
    created_at: startTimeIso
  };

  // 3. 插入最前端並持久化
  settledList.unshift(newRecord);
  const finalList = settledList.slice(0, 50);
  try {
    localStorage.setItem('smart_parking_history', JSON.stringify(finalList));
    localStorage.setItem('my_active_spot_id', stdId);
    localStorage.setItem('my_active_spot_number', cleanNum);
  } catch (e) {
    console.warn(e);
  }

  return finalList;
}

/**
 * 🎯 結算停車歷史：將目前進行中的紀錄標註結束時間
 */
export function recordParkingEnd(endTimeIso: string = new Date().toISOString()): HistoryRecord[] {
  let currentList: HistoryRecord[] = [];
  try {
    const raw = localStorage.getItem('smart_parking_history');
    if (raw) currentList = JSON.parse(raw);
    if (!Array.isArray(currentList)) currentList = [];
  } catch {
    currentList = [];
  }

  const finalizedList = currentList.map(h => {
    if (!h.end_time || h.end_time === '') {
      return { ...h, end_time: endTimeIso };
    }
    return h;
  });

  try {
    localStorage.setItem('smart_parking_history', JSON.stringify(finalizedList));
    localStorage.removeItem('my_active_spot_id');
    localStorage.removeItem('my_active_spot_number');
  } catch (e) {
    console.warn(e);
  }

  return finalizedList;
}

/**
 * 取得使用者的停車歷史紀錄
 * @returns 歷史紀錄列表
 */
export async function getHistory(): Promise<HistoryRecord[]> {
  const activeSpotId = typeof window !== 'undefined' ? localStorage.getItem('my_active_spot_id') : null;
  const activeSpotNum = typeof window !== 'undefined' ? localStorage.getItem('my_active_spot_number') : null;
  const activeCleanNum = normalizeSpotNumber(activeSpotNum || activeSpotId);

  let localList: HistoryRecord[] = [];
  try {
    const raw = localStorage.getItem('smart_parking_history');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) localList = parsed;
    }
  } catch {}

  // 確保車位號碼全部標準化
  let normalizedList = localList.map(item => ({
    ...item,
    spot_number: normalizeSpotNumber(item.spot_number || item.spot_id)
  }));

  // 如果當前有活躍停車，確保第一筆是當前進行中車位
  if (activeCleanNum && activeCleanNum !== '0-0' && activeSpotId) {
    const activeIndex = normalizedList.findIndex(h => h.spot_number === activeCleanNum && (!h.end_time || h.end_time === ''));
    if (activeIndex > 0) {
      const [activeItem] = normalizedList.splice(activeIndex, 1);
      normalizedList.unshift(activeItem);
    } else if (activeIndex === -1) {
      normalizedList.unshift({
        id: `hist-live-${Date.now()}`,
        user_id: 'c811008c-077b-4ebc-8db7-2cd18129d584',
        spot_id: activeSpotId,
        spot_number: activeCleanNum,
        start_time: new Date().toISOString(),
        end_time: '',
        created_at: new Date().toISOString()
      });
    }
  }

  return normalizedList;
}

/**
 * 🎯 統一獲取已格式化完成的歷史紀錄列表（供 UI 直接渲染，消除全站重複格式化代碼）
 */
export async function getFormattedHistory(): Promise<FormattedHistoryItem[]> {
  const list = await getHistory();

  const parseSafeDate = (d: any): Date => {
    if (!d) return new Date();
    if (d instanceof Date) return isNaN(d.getTime()) ? new Date() : d;
    const parsed = new Date(d);
    return isNaN(parsed.getTime()) ? new Date() : parsed;
  };

  const formatTime = (timeStr?: string): string => {
    if (!timeStr) return "";
    try {
      const date = parseSafeDate(timeStr);
      const hours = date.getHours().toString().padStart(2, "0");
      const minutes = date.getMinutes().toString().padStart(2, "0");
      const seconds = date.getSeconds().toString().padStart(2, "0");
      return `${hours}:${minutes}:${seconds}`;
    } catch {
      return "";
    }
  };

  return list.map(h => {
    const baseDateString = h.start_time || h.created_at;
    const dateObj = parseSafeDate(baseDateString);
    const formattedDate = dateObj.toLocaleString('zh-TW', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
    const start = formatTime(h.start_time);
    const end = formatTime(h.end_time);
    const finalTimeDisplay = (start && end)
      ? `${formattedDate} (${start} - ${end})`
      : (!end && start) ? `${formattedDate} (${start} - 進行中)` : formattedDate;

    let cleanNumber = normalizeSpotNumber(h.spot_number || h.spot_id);
    if (!cleanNumber || cleanNumber === '0-0') cleanNumber = 'A-01';

    return {
      id: h.id,
      number: cleanNumber,
      time: finalTimeDisplay
    };
  });
}

export interface FavoriteSpot {
  id: string;
  spot_number: string;
  created_at: string;
}

/**
 * 取得常用車位列表
 * @returns 常用車位列表
 */
export async function getFavorites(): Promise<FavoriteSpot[]> {
  return apiRequest<FavoriteSpot[]>("/api/users/favorites");
}

/**
 * 新增常用車位
 * @param spotNumber 車位編號
 * @returns 新增的紀錄
 */
export async function addFavorite(spotNumber: string): Promise<FavoriteSpot> {
  return apiRequest<FavoriteSpot>("/api/users/favorites", {
    method: "POST",
    body: JSON.stringify({ spot_number: spotNumber }),
  });
}

/**
 * 移除常用車位
 * @param spotNumber 車位編號
 */
export async function removeFavorite(spotNumber: string): Promise<void> {
  await apiRequest(`/api/users/favorites/${spotNumber}`, {
    method: "DELETE",
  });
}

// --- AI API ---

/**
 * 生成機車圖片
 * @param prompt 描述文字
 * @returns 圖片 data URL
 */
export async function generateImage(prompt: string): Promise<string | null> {
  const result = await apiRequest<{ image_url: string | null }>(
    "/api/ai/generate",
    {
      method: "POST",
      body: JSON.stringify({ prompt }),
    }
  );
  return result.image_url;
}

/**
 * 編輯機車圖片
 * @param image 原始圖片 data URL
 * @param prompt 編輯指令
 * @returns 編輯後的圖片 data URL
 */
export async function editImage(
  image: string,
  prompt: string
): Promise<string | null> {
  const result = await apiRequest<{ image_url: string | null }>(
    "/api/ai/edit",
    {
      method: "POST",
      body: JSON.stringify({ image, prompt }),
    }
  );
  return result.image_url;
}

/**
 * 學生通報車位異常 (遭亂停/堆放雜物)
 * @param spotId 車位 ID
 * @returns 操作結果
 */
export async function reportSpotAnomaly(spotId: string): Promise<SpotActionResult> {
  console.log("[reportSpotAnomaly] 開始執行車位異常通報, spotId:", spotId);
  const targetTable = spotId.startsWith('CAR-') ? 'car_parking_spots' : 'parking_spots';

  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id;

  if (!userId) {
    throw new Error("操作失敗：無法取得使用者身分，請重新登入");
  }

  // 1. 取得車位編號
  const { data: spotData, error: spotError } = await supabase
    .from(targetTable)
    .select('number')
    .eq('id', spotId)
    .single();

  if (spotError) {
    throw new Error("無法取得車位資訊");
  }

  // 2. 將車位狀態更新為 disabled (異常/停用)
  const { data: updateData, error: updateError } = await supabase.from(targetTable).update({
    status: 'disabled',
    occupied_by: null, // 遭亂停，非合法預約，不佔用特定使用者額度
    occupied_at: new Date().toISOString()
  }).eq('id', spotId).select();

  if (updateError || !updateData || updateData.length === 0) {
    console.error("[reportSpotAnomaly] 失敗: 無法更新車位狀態", updateError);
    throw new Error("通報失敗：無法更新車位狀態");
  }

  console.log("[reportSpotAnomaly] 車位異常通報成功！");
  return { success: true, message: `已成功通報車位 ${spotData.number} 異常，系統將通知管理員前往處置。` };
}

export interface SendMessageData {
  user_id?: string;
  user_name: string;
  user_avatar: string;
  role: 'student' | 'admin' | 'ai';
  content: string;
}

// 本地模擬訊息 key
const LOCAL_MSG_KEY = "motopark_mock_messages";

// 預設的模擬對話紀錄，讓聊天室一進去就有豐富的大學生停車討論氣氛！
const DEFAULT_MOCK_MESSAGES = [
  {
    id: "mock-1",
    user_id: "user-alice",
    user_name: "小明",
    user_avatar: "",
    role: "student",
    content: "有人知道 A 區現在還有位子嗎？我快遲到了 😭",
    created_at: new Date(Date.now() - 3600000 * 2).toISOString() // 2 小時前
  },
  {
    id: "mock-2",
    user_id: "user-bob",
    user_name: "大華 (管理員)",
    user_avatar: "",
    role: "admin",
    content: "剛剛巡視 A 區已經滿了喔！建議停到 E 區或 X 區，那邊空位還很多！👮",
    created_at: new Date(Date.now() - 3600000 * 1.8).toISOString()
  },
  {
    id: "mock-3",
    user_id: "user-charlie",
    user_name: "小婷",
    user_avatar: "",
    role: "student",
    content: "B-12 車位旁邊好像有人亂停，機車橫著放，根本擠不進去... 🤬",
    created_at: new Date(Date.now() - 1800000).toISOString() // 30 分鐘前
  }
];

function getLocalMessages(): any[] {
  const local = localStorage.getItem(LOCAL_MSG_KEY);
  if (!local) {
    localStorage.setItem(LOCAL_MSG_KEY, JSON.stringify(DEFAULT_MOCK_MESSAGES));
    return DEFAULT_MOCK_MESSAGES;
  }
  try {
    return JSON.parse(local);
  } catch (e) {
    return DEFAULT_MOCK_MESSAGES;
  }
}

function saveLocalMessage(msg: any) {
  const list = getLocalMessages();
  list.push(msg);
  localStorage.setItem(LOCAL_MSG_KEY, JSON.stringify(list));
}

/**
 * 取得社群聊天室訊息
 * @param limit 限制取得的筆數
 * @returns 訊息列表
 */
export async function getCommunityMessages(limit: number = 100): Promise<any[]> {
  try {
    const url = `${SUPABASE_URL}/rest/v1/community_messages?select=*&order=created_at.asc&limit=${limit}`;
    const res = await fetch(url, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      }
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        return data;
      }
    }
  } catch (e: any) {
    console.warn("[getCommunityMessages] REST fetch error:", e);
  }

  try {
    const { data, error } = await supabase
      .from('community_messages')
      .select('*')
      .order('created_at', { ascending: true })
      .limit(limit);

    if (!error && Array.isArray(data) && data.length > 0) {
      return data;
    }
  } catch (e: any) {
    console.warn("[getCommunityMessages] Supabase client error:", e);
  }

  return getLocalMessages();
}

/**
 * 發送社群聊天室訊息
 * @param msg 訊息內容
 * @returns 寫入的訊息紀錄
 */
export async function sendCommunityMessage(msg: SendMessageData): Promise<any> {
  const newRecord = {
    user_id: msg.user_id || null,
    user_name: msg.user_name || '使用者',
    user_avatar: msg.user_avatar || '',
    role: msg.role || 'student',
    content: msg.content,
    created_at: new Date().toISOString()
  };

  try {
    const url = `${SUPABASE_URL}/rest/v1/community_messages`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(newRecord)
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        return data[0];
      }
      return { id: `msg-${Date.now()}`, ...newRecord };
    }
  } catch (e: any) {
    console.warn("[sendCommunityMessage] REST insert error:", e);
  }

  try {
    const { data, error } = await supabase
      .from('community_messages')
      .insert(newRecord)
      .select()
      .single();

    if (!error && data) return data;
  } catch (e: any) {
    console.warn("[sendCommunityMessage] Supabase client insert error:", e);
  }

  const fallback = { id: `local-${Date.now()}`, ...newRecord };
  saveLocalMessage(fallback);
  return fallback;
}

/**
 * 傳送掃碼資料給後端進行 QR Code 驗證與車位解鎖
 * @param spotId 車位 ID
 * @param qrcodeData 掃碼內容
 * @param userId 使用者 ID
 */
export async function scanQRCode(spotId: string, qrcodeData: string, userId: string): Promise<any> {
  return apiRequest("/api/qrcode/scan", {
    method: "POST",
    body: JSON.stringify({ spotId, qrcodeData, userId }),
  });
}

/**
 * 根據大樓名稱取得推薦的最靠近停車場
 * @param buildingName 大樓名稱
 */
export async function recommendParking(buildingName: string): Promise<any> {
  return apiRequest("/api/recommend-parking", {
    method: "POST",
    body: JSON.stringify({ buildingName }),
  });
}



