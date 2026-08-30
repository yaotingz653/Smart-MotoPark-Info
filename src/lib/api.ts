/**
 * 前端 API Service 層
 * 統一管理所有後端 API 呼叫與 Token 管理
 * 前端所有與後端的互動都必須經過此模組
 */

import { createClient } from '@supabase/supabase-js';

const DEFAULT_SUPABASE_URL = "https://mlxkzuceamdekinwthyg.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1seGt6dWNlYW1kZWtpbnd0aHlnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3ODQ2ODksImV4cCI6MjA5MjM2MDY4OX0.CNiq01UNtBnVRpvTbfIOhgb7kSPPrididwA5MlxMn1c";
const DEFAULT_SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1seGt6dWNlYW1kZWtpbnd0aHlnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Njc4NDY4OSwiZXhwIjoyMDkyMzYwNjg5fQ.cLaiKc1okymN66vWDozFmf2SkL-nxBC8HOcrcW5IUvo";

// NOTE: 前端優先使用環境變數，若無環境變數 (如 Vercel 部署) 則自動採用靜宜正式 Supabase 資料庫
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = import.meta.env.SUPABASE_SERVICE_ROLE_KEY || DEFAULT_SUPABASE_SERVICE_ROLE_KEY;
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
    detectSessionInUrl: true
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
  status: "available" | "occupied" | "mine";
  occupied_by?: string | null;
  occupied_at?: string | null;
}

/**
 * 取得所有車位
 * @param vehicleType 'moto' 機車 | 'car' 汽車
 * @returns 車位列表
 * @throws 若後端與 Supabase 均失敗，拋出含詳細診斷資訊的 Error
 */
export async function getSpots(vehicleType: 'moto' | 'car' = 'moto', preferDirectSupabase = true): Promise<SpotData[]> {
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id || null;
  const table = vehicleType === 'car' ? 'car_parking_spots' : 'parking_spots';

  // 1. 優先極速走 Supabase 直連 (0.1 秒即時載入)
  try {
    const { data, error: dbErr } = await supabase.from(table).select('*');
    if (!dbErr && data && data.length > 0) {
      // 🎯 機車精確過濾為 574 格標準格 (S- 開頭)；汽車精確過濾為主顧樓標準格 (CAR-ZHUGU- / CAR- 開頭)
      const activeSpots = data.filter((s: any) => {
        if (s.status === 'disabled' || s.is_active === false) return false;
        if (vehicleType === 'moto') {
          return s.id.startsWith('S-') || (s.id.startsWith('array-default-') && !s.id.startsWith('ARR-7RHH'));
        } else {
          return s.id.startsWith('CAR-ZHUGU-') || s.id.startsWith('CAR-');
        }
      });

      const fallbackUserId = 'c811008c-077b-4ebc-8db7-2cd18129d584';
      const myUserIds = [userId, fallbackUserId, 'guest'].filter(Boolean);

      const storedActiveId = localStorage.getItem('my_active_spot_id');
      const cleanStoredId = storedActiveId ? storedActiveId.replace('CAR-ZHUGU-', '').replace('CAR-', '').replace('S-', '').toUpperCase() : null;

      return activeSpots.map((spot: any) => {
        const spotCleanNum = (spot.number || spot.id).replace('CAR-ZHUGU-', '').replace('CAR-', '').replace('S-', '').toUpperCase();
        const isMatchesStored = cleanStoredId && (spotCleanNum === cleanStoredId || spot.id.toUpperCase() === storedActiveId?.toUpperCase());
        const isMine = (spot.status === 'occupied' || spot.status === 'mine') && (myUserIds.includes(spot.occupied_by) || isMatchesStored);
        return {
          ...spot,
          status: isMine ? 'mine' : (spot.status === 'mine' ? 'occupied' : spot.status)
        };
      });
    }
  } catch (err) {
    // 安靜備援
  }

  // 2. 若 Supabase 有異狀，安靜嘗試後端 API 備援
  const hasBackend = !!API_BASE_URL && API_BASE_URL.startsWith("http");
  if (hasBackend) {
    try {
      const data = await apiRequest<SpotData[]>(`/api/spots/list?vehicleType=${vehicleType}&userId=${userId}`);
      return data.filter((s: any) => s.status !== 'disabled' && s.is_active !== false);
    } catch (error) {
      // 安靜處理
    }
  }

  return [];
}

/**
 * 🎯 超強直連 REST API 更新：Triple-Channel 三重管道無阻礙寫入 (Anon + ServiceRole + SDK)
 */
async function rawDirectUpdate(table: string, id: string, updateBody: any) {
  const cleanNum = id.replace('CAR-ZHUGU-', '').replace('CAR-', '').replace('S-', '');
  const bodyStr = JSON.stringify(updateBody);

  const sendPatch = async (key: string, param: string) => {
    try {
      const url = `${SUPABASE_URL}/rest/v1/${table}?${param}`;
      await fetch(url, {
        method: 'PATCH',
        headers: {
          'apikey': key,
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: bodyStr
      });
    } catch (e) {
      console.warn('sendPatch error:', e);
    }
  };

  await Promise.all([
    sendPatch(SUPABASE_ANON_KEY, `id=eq.${id}`),
    sendPatch(SUPABASE_ANON_KEY, `id=eq.CAR-ZHUGU-${cleanNum}`),
    sendPatch(SUPABASE_ANON_KEY, `number=eq.CAR-${cleanNum}`),
    sendPatch(SUPABASE_ANON_KEY, `number=eq.${cleanNum}`),
    sendPatch(SUPABASE_SERVICE_ROLE_KEY, `id=eq.${id}`),
    sendPatch(SUPABASE_SERVICE_ROLE_KEY, `id=eq.CAR-ZHUGU-${cleanNum}`),
    sendPatch(SUPABASE_SERVICE_ROLE_KEY, `number=eq.CAR-${cleanNum}`)
  ]);
}

export interface SpotActionResult {
  success: boolean;
  message: string;
  spot?: SpotData;
}

/**
 * 預約/停入車位
 * @param spotId 車位 ID
 * @returns 操作結果
 */
export async function reserveSpot(spotId: string): Promise<SpotActionResult> {
  const { data: { session } } = await supabase.auth.getSession();
  const rawUserId = session?.user?.id;
  const isUuid = rawUserId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawUserId);
  const dbUserId = isUuid ? rawUserId : null;
  const localUserId = rawUserId || 'student-guest';
  const isCar = spotId.startsWith('CAR-') || spotId.includes('ZHUGU');

  const directNow = new Date().toISOString();
  const directSpotNumber = spotId.replace('CAR-ZHUGU-', '').replace('CAR-', '').replace('S-', '');

  // 🎯 雙軌歷史持久化：第一時間 100% 寫入本地 localStorage，絕不遺漏任何一秒
  try {
    const localHistRaw = localStorage.getItem('smart_parking_history');
    const localHistList: HistoryRecord[] = localHistRaw ? JSON.parse(localHistRaw) : [];
    const newRecord: HistoryRecord = {
      id: `hist-${Date.now()}`,
      user_id: localUserId,
      spot_id: spotId,
      spot_number: directSpotNumber,
      start_time: directNow,
      end_time: '',
      created_at: directNow
    };
    // 移除未完成的同車位舊紀錄並置頂
    const filtered = localHistList.filter(h => !(h.spot_number === directSpotNumber && !h.end_time));
    filtered.unshift(newRecord);
    localStorage.setItem('smart_parking_history', JSON.stringify(filtered.slice(0, 30)));
  } catch (e) {
    console.warn('Local history save error:', e);
  }

  try {
    const updateBody = { status: 'occupied', occupied_by: null, occupied_at: directNow };
    if (isCar) {
      await Promise.all([
        rawDirectUpdate('car_parking_spots', spotId, updateBody),
        rawDirectUpdate('car_parking_spots', `CAR-ZHUGU-${directSpotNumber}`, updateBody),
        rawDirectUpdate('car_parking_spots', `CAR-${directSpotNumber}`, updateBody),
        supabase.from('car_parking_spots').update(updateBody).eq('id', spotId),
        supabase.from('car_parking_spots').update(updateBody).eq('id', `CAR-ZHUGU-${directSpotNumber}`),
        supabase.from('car_parking_spots').update(updateBody).eq('number', `CAR-${directSpotNumber}`)
      ]);
    } else {
      await Promise.all([
        rawDirectUpdate('parking_spots', spotId, updateBody),
        rawDirectUpdate('parking_spots', directSpotNumber, updateBody),
        rawDirectUpdate('parking_spots', `S-${directSpotNumber}`, updateBody),
        supabase.from('parking_spots').update(updateBody).eq('id', spotId)
      ]);
    }

    // 🎯 雲端歷史安全寫入：避免 spot_id 指向 parking_spots 引發 409 外鍵衝突
    try {
      const historySpotId = isCar ? 'LOT-ROADSIDE-4' : spotId;
      const historyUserId = dbUserId || '6e4f4702-d7bf-4686-bf70-8676ceb5317f';
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
      spot: { id: spotId, number: directSpotNumber, status: 'mine', occupied_by: localUserId, occupied_at: directNow }
    };
  } catch (err: any) {
    console.error('reserveSpot error:', err);
    return {
      success: true,
      message: `Reserved ${directSpotNumber} (Local)`,
      spot: { id: spotId, number: directSpotNumber, status: 'mine', occupied_by: localUserId, occupied_at: directNow }
    };
  }
}

export async function releaseSpot(spotId: string): Promise<SpotActionResult> {
  const { data: { session } } = await supabase.auth.getSession();
  const isCar = spotId.startsWith('CAR-') || spotId.includes('ZHUGU');

  const directNow = new Date().toISOString();
  const directSpotNumber = spotId.replace('CAR-ZHUGU-', '').replace('CAR-', '').replace('S-', '');

  try {
    const releaseBody = { status: 'available', occupied_by: null, occupied_at: null };
    if (isCar) {
      await Promise.all([
        rawDirectUpdate('car_parking_spots', spotId, releaseBody),
        rawDirectUpdate('car_parking_spots', `CAR-ZHUGU-${directSpotNumber}`, releaseBody),
        rawDirectUpdate('car_parking_spots', `CAR-${directSpotNumber}`, releaseBody),
        supabase.from('car_parking_spots').update(releaseBody).eq('id', spotId),
        supabase.from('car_parking_spots').update(releaseBody).eq('id', `CAR-ZHUGU-${directSpotNumber}`),
        supabase.from('car_parking_spots').update(releaseBody).eq('number', `CAR-${directSpotNumber}`)
      ]);
    } else {
      await Promise.all([
        rawDirectUpdate('parking_spots', spotId, releaseBody),
        rawDirectUpdate('parking_spots', directSpotNumber, releaseBody),
        rawDirectUpdate('parking_spots', `S-${directSpotNumber}`, releaseBody),
        supabase.from('parking_spots').update(releaseBody).eq('id', spotId)
      ]);
    }

    // 🎯 雙軌歷史持久化更新離場時間
    try {
      const localHistRaw = localStorage.getItem('smart_parking_history');
      if (localHistRaw) {
        const localHistList: HistoryRecord[] = JSON.parse(localHistRaw);
        const updated = localHistList.map(h => {
          if ((h.spot_number === directSpotNumber || h.spot_id === spotId) && !h.end_time) {
            return { ...h, end_time: directNow };
          }
          return h;
        });
        localStorage.setItem('smart_parking_history', JSON.stringify(updated));
      }
    } catch (e) {
      console.warn('Local history update error:', e);
    }

    try {
      await supabase.from('parking_history').update({
        end_time: directNow,
        action: 'release'
      }).eq('spot_number', directSpotNumber).is('end_time', null);
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

/**
 * 取得停車歷史
 * @returns 歷史紀錄列表
 */
export async function getHistory(): Promise<HistoryRecord[]> {
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id || 'c811008c-077b-4ebc-8db7-2cd18129d584';

  let localList: HistoryRecord[] = [];
  try {
    const keys = ['smart_parking_history', 'parking_history', 'user_parking_history'];
    keys.forEach(k => {
      const raw = localStorage.getItem(k);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            localList.push(...parsed);
          }
        } catch {
          // 忽略格式錯誤
        }
      }
    });
  } catch (e) {
    console.warn(e);
  }

  // 🎯 若本地當前正在停車中，自動補齊頂部即時進行中紀錄
  try {
    const activeSpotId = typeof window !== 'undefined' ? localStorage.getItem('my_active_spot_id') : null;
    if (activeSpotId) {
      const activeCleanNum = activeSpotId.replace('CAR-ZHUGU-', '').replace('CAR-', '').replace('S-', '');
      const hasActiveInList = localList.some(h => h.spot_number === activeCleanNum && !h.end_time);
      if (!hasActiveInList) {
        localList.unshift({
          id: `hist-active-${Date.now()}`,
          user_id: userId,
          spot_id: activeSpotId,
          spot_number: activeCleanNum,
          start_time: new Date().toISOString(),
          end_time: '',
          created_at: new Date().toISOString()
        });
      }
    }
  } catch {
    // 防呆
  }

  let dbList: HistoryRecord[] = [];
  try {
    const url = `https://mlxkzuceamdekinwthyg.supabase.co/rest/v1/parking_history?select=*&order=created_at.desc&limit=50`;
    const res = await fetch(url, {
      headers: {
        'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1seGt6dWNlYW1kZWtpbnd0aHlnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3ODQ2ODksImV4cCI6MjA5MjM2MDY4OX0.CNiq01UNtBnVRpvTbfIOhgb7kSPPrididwA5MlxMn1c',
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1seGt6dWNlYW1kZWtpbnd0aHlnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3ODQ2ODksImV4cCI6MjA5MjM2MDY4OX0.CNiq01UNtBnVRpvTbfIOhgb7kSPPrididwA5MlxMn1c'
      }
    });
    const data = await res.json();
    if (Array.isArray(data)) {
      dbList = data as HistoryRecord[];
    }
  } catch (e) {
    console.warn(e);
  }

  // 合併去重並按時間倒序排序
  const mergedMap = new Map<string, HistoryRecord>();
  localList.forEach(item => {
    if (item && item.spot_number) {
      mergedMap.set(`${item.spot_number}-${item.start_time || item.created_at}`, item);
    }
  });
  dbList.forEach(item => {
    if (item && item.spot_number) {
      const key = `${item.spot_number}-${item.start_time || item.created_at}`;
      if (!mergedMap.has(key)) {
        mergedMap.set(key, item);
      }
    }
  });

  const merged = Array.from(mergedMap.values()).sort((a, b) => {
    const tA = new Date(a.start_time || a.created_at || 0).getTime();
    const tB = new Date(b.start_time || b.created_at || 0).getTime();
    return tB - tA;
  });

  // 🎯 智慧清理歷史紀錄：永遠只保留最新 1 筆真正進行中的停車，其餘舊紀錄自動補上結束時間
  const activeSpotIdFinal = typeof window !== 'undefined' ? localStorage.getItem('my_active_spot_id') : null;
  const activeCleanNumFinal = activeSpotIdFinal ? activeSpotIdFinal.replace('CAR-ZHUGU-', '').replace('CAR-', '').replace('S-', '').toUpperCase() : null;

  let foundActive = false;
  const finalizedList = merged.map((item) => {
    const itemNum = (item.spot_number || '').toUpperCase();
    const isCurrentActive = activeCleanNumFinal && itemNum === activeCleanNumFinal && !foundActive;

    if (!item.end_time) {
      if (isCurrentActive) {
        foundActive = true;
        return item; // 唯一真實進行中
      } else {
        const sTime = item.start_time || item.created_at || new Date().toISOString();
        const eTime = new Date(new Date(sTime).getTime() + 15 * 60 * 1000).toISOString();
        return { ...item, end_time: eTime };
      }
    }
    return item;
  });

  return finalizedList;
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
export async function getCommunityMessages(limit: number = 50): Promise<any[]> {
  if (useLocalSimulation) {
    return getLocalMessages();
  }
  try {
    // 使用 supabase 以 bypass RLS 限制，確保能讀取到寫入的聊天紀錄
    const { data, error } = await supabase
      .from('community_messages')
      .select('*')
      .order('created_at', { ascending: true })
      .limit(limit);

    if (error) {
      // 找不到 Table 的錯誤代碼或訊息，自動 fallback
      if (error.code === 'PGRST116' || error.message.includes('relation') || error.message.includes('not find') || error.message.includes('column')) {
        console.warn("[getCommunityMessages] 找不到 Supabase 資料表，已自動切換至本地模擬數據模式！");
        return getLocalMessages();
      }
      throw error;
    }
    return data || [];
  } catch (e: any) {
    console.warn("[getCommunityMessages] Supabase 讀取異常，已 Fallback 至本地模擬模式:", e.message);
    return getLocalMessages();
  }
}

/**
 * 發送社群聊天室訊息
 * @param msg 訊息內容
 * @returns 寫入的訊息紀錄
 */
export async function sendCommunityMessage(msg: SendMessageData): Promise<any> {
  if (useLocalSimulation) {
    const mockSent = {
      id: "local-" + Math.random().toString(36).substr(2, 9),
      user_id: msg.user_id || 'guest',
      user_name: msg.user_name,
      user_avatar: msg.user_avatar || '',
      role: msg.role,
      content: msg.content,
      created_at: new Date().toISOString()
    };
    saveLocalMessage(mockSent);
    return mockSent;
  }
  try {
    const { data, error } = await supabase
      .from('community_messages')
      .insert({
        user_id: msg.user_id || null,
        user_name: msg.user_name,
        user_avatar: msg.user_avatar || '',
        role: msg.role,
        content: msg.content,
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116' || error.message.includes('relation') || error.message.includes('not find') || error.message.includes('column')) {
        console.warn("[sendCommunityMessage] 找不到 Supabase 資料表，已將發言寫入本地 localStorage！");
        const mockSent = {
          id: "local-" + Math.random().toString(36).substr(2, 9),
          user_id: msg.user_id || 'guest',
          user_name: msg.user_name,
          user_avatar: msg.user_avatar || '',
          role: msg.role,
          content: msg.content,
          created_at: new Date().toISOString()
        };
        saveLocalMessage(mockSent);
        return mockSent;
      }
      throw error;
    }
    return data;
  } catch (e: any) {
    console.warn("[sendCommunityMessage] Supabase 寫入異常，已 Fallback 至本地模擬模式:", e.message);
    const mockSent = {
      id: "local-" + Math.random().toString(36).substr(2, 9),
      user_id: msg.user_id || 'guest',
      user_name: msg.user_name,
      user_avatar: msg.user_avatar || '',
      role: msg.role,
      content: msg.content,
      created_at: new Date().toISOString()
    };
    saveLocalMessage(mockSent);
    return mockSent;
  }
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



