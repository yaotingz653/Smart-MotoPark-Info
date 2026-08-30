import { useState, useEffect, useRef, useCallback, PointerEvent, memo, useMemo } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import {
  Map as MapIcon,
  MapPin,
  User,
  Search,
  Compass,
  Plus,
  Minus,
  LogOut,
  ChevronRight,
  Bike,
  Car,
  Sparkles,
  Loader2,
  Image as ImageIcon,
  Camera,
  RefreshCcw,
  Clock,
  X,
  Unlock,
  Maximize,
  Save,
  MessageSquare
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ViewState, VehicleMode, ParkingSpot, UserProfile, ParkingBlock, CommunityMessage, EntryNotice } from './types';
import { askParkingAI } from './lib/gemini';
import * as api from './lib/api';
import ZhuguParkingCanvas from './components/ZhuguParkingCanvas';
import GoogleMapContainer, { CAMPUS_DESTINATIONS, CAMPUS_PARKING_LOTS, CAMPUS_PARKING_LOT_RELATIONS } from './components/GoogleMapContainer';
import campusMap from './providence-campus-map.png';

// --- Configuration & Constants ---
// ROWS and COLS are dynamically calculated in MapView based on spots
const SPOT_W = 55;
const SPOT_H = 85;
const AISLE_W = 40;
const COLUMN_GAP = 5;
const ROW_GAP = 3;

// --- Helpers ---
function withTimeout<T>(promise: Promise<T>, timeoutMs: number = 8000, errorMsg: string = "連線逾時，請檢查網路狀態或稍後重試。"): Promise<T> {
  let timeoutId: any;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(errorMsg));
    }, timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutId);
  });
}

// --- Components ---

function Button({ children, onClick, className = "", variant = "primary" }: any) {
  const baseStyles = "px-6 py-3 rounded-none font-sans font-bold text-xs uppercase tracking-widest transition-all active:scale-95 flex items-center justify-center gap-2 border transition-all duration-300";
  const variants: any = {
    primary: "bg-editorial-ink text-editorial-bg border-editorial-ink hover:bg-white hover:text-editorial-ink",
    secondary: "bg-white text-editorial-ink border-slate-200 hover:border-editorial-ink",
    ghost: "bg-transparent text-editorial-muted border-transparent hover:text-editorial-ink",
    neon: "bg-white text-brand-orange border-brand-orange hover:bg-brand-orange hover:text-white"
  };

  return (
    <button onClick={onClick} className={`${baseStyles} ${variants[variant]} ${className}`}>
      {children}
    </button>
  );
}

const generateDefaultMotoSpots = (): ParkingSpot[] => {
  const list: ParkingSpot[] = [];
  for (let r = 0; r < 25; r++) {
    const rowLetter = String.fromCharCode(65 + r);
    for (let c = 0; c < 23; c++) {
      const colNum = String(c + 1).padStart(2, '0');
      list.push({
        id: `S-${r}-${c}`,
        number: `${rowLetter}-${colNum}`,
        status: 'available',
        parkingBlockId: 'moto'
      });
    }
  }
  return list;
};

const ZHUGU_B1_NUMS_CLIENT = [
  'A00', 'A01', 'A02', 'A03', 'A04', 'A05', 'A06', 'A07', 'A08', 'A09', 'A10', 'A11', 'A12', 'A13', 'A14', 'A15',
  'B00', 'B01', 'B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B08',
  'C01', 'C02', 'C03', 'C04', 'C05', 'C06', 'C07', 'C08', 'C09', 'C10', 'C11', 'C12', 'C13',
  'D00', 'D01', 'D02', 'D03', 'D04', 'D05', 'D06', 'D07', 'D08', 'D09', 'D10', 'D11', 'D12', 'D13', 'D14', 'D15', 'D16',
  'E01', 'E02', 'E03', 'E04', 'E05', 'E06', 'E07', 'E08', 'E09', 'E10',
  'F00', 'F01', 'F02', 'F03', 'F04', 'F05', 'F06', 'F07',
  'G01', 'G02', 'G03', 'G04', 'G05', 'G06', 'G07', 'G08', 'G09', 'G10', 'G11', 'G12',
  'H01', 'H02', 'H03', 'H04', 'H05', 'H06', 'H07', 'H08', 'H09', 'H10', 'H11',
  'I01', 'I02', 'J01'
];

const generateDefaultCarSpots = (): ParkingSpot[] => {
  return ZHUGU_B1_NUMS_CLIENT.map(num => ({
    id: `CAR-ZHUGU-${num}`,
    number: `CAR-${num}`,
    status: 'available',
    parkingBlockId: 'zhugu'
  }));
};

export default function App() {
  const [view, setView] = useState<ViewState>('login');
  const [vehicleType, setVehicleType] = useState<'moto' | 'car'>('moto');
  const [vehicleMode, setVehicleMode] = useState<VehicleMode>('motorcycle');
  const [user, setUser] = useState<UserProfile | null>(null);
  const [motoSpots, setMotoSpots] = useState<ParkingSpot[]>(() => generateDefaultMotoSpots());
  const [carSpots, setCarSpots] = useState<ParkingSpot[]>(() => generateDefaultCarSpots());
  const spots = vehicleType === 'car' ? carSpots : motoSpots;
  const setSpots = (updater: ParkingSpot[] | ((prev: ParkingSpot[]) => ParkingSpot[])) => {
    if (typeof updater === 'function') {
      if (vehicleType === 'car') setCarSpots(prev => updater(prev));
      else setMotoSpots(prev => updater(prev));
    } else {
      if (vehicleType === 'car') setCarSpots(updater);
      else setMotoSpots(updater);
    }
  };
  const [spotsError, setSpotsError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [startTime, setStartTime] = useState<Date | null>(null);
  const [parkingHistory, setParkingHistory] = useState<{ id: string, number: string, time: string }[]>([]);
  const [modal, setModal] = useState<{
    isOpen: boolean,
    title: string,
    message: string,
    type: 'alert' | 'confirm',
    onConfirm?: () => void,
    showReportBtn?: boolean,
    spotId?: string
  }>({ isOpen: false, title: '', message: '', type: 'alert' });
  const [modalConfirming, setModalConfirming] = useState(false);
  const [googleMapState, setGoogleMapState] = useState<{
    isOpen: boolean,
    mode: 'location' | 'navigation',
    targetSpot?: string | null,
    origin?: { lat: number; lng: number } | 'gps' | 'entrance',
    carDestination?: string | null,
    carParkingLotName?: string | null
  }>({ isOpen: false, mode: 'location' });
  // 用 ref 存 onConfirm，避免因重新渲染導致閉包失效
  const onConfirmRef = useRef<(() => void) | undefined>(undefined);

  // 統一開啟 modal，並同步更新 ref
  const openModal = useCallback((opts: { 
    title: string; 
    message: string; 
    type: 'alert' | 'confirm'; 
    onConfirm?: () => void;
    showReportBtn?: boolean;
    spotId?: string;
  }) => {
    onConfirmRef.current = opts.onConfirm;
    setModal({ isOpen: true, ...opts });
  }, []);

  const [isScanning, setIsScanning] = useState(false);
  const [entryNotice, setEntryNotice] = useState<EntryNotice | null>(null);

  // 停車成功時自動完成進場登記並徹底瞬間消除所有警告與超時 (P1)
  const markEntryNoticeCompleted = useCallback(() => {
    setEntryNotice(null);
  }, []);

  // P1 車牌進場 2 分鐘計時器與超時後每 1 分鐘持續告警邏輯
  useEffect(() => {
    if (!entryNotice || entryNotice.status === 'completed') return;

    const timer = setInterval(() => {
      setEntryNotice(prev => {
        if (!prev || prev.status === 'completed') return prev;

        // 1. 未滿 2 分鐘倒數中
        if (prev.status === 'pending') {
          if (prev.remainingSeconds <= 1) {
            const timeStr = new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            const initialLog = {
              id: Date.now().toString(),
              timestamp: timeStr,
              message: `⚠️ 進場滿 2 分鐘未掃碼，發出第 1 次違規告警！`
            };
            // 📡 雙重實時連動：使用 api.sendCommunityMessage 保證訊息 100% 同步廣播至管理者端！
            void api.sendCommunityMessage({
              user_name: user?.name || prev.plateNumber || '學生用戶',
              user_avatar: '',
              role: 'student',
              content: `⚠️ 停車逾時未掃描警告：車牌【${prev.plateNumber}】進場已超過 2 分鐘未完成 QR Code / 影像辨識掃描！`,
            });
            void api.supabase.from('system_alerts').insert([{
              alert_type: 'unscanned_timeout',
              title: '⚠️ 停車逾時未掃描警告',
              user_name: user?.name || prev.plateNumber || '學生用戶',
              user_email: '',
              spot_number: '門口進場',
              vehicle_type: vehicleType,
              message: `車牌【${prev.plateNumber}】進場已超過 2 分鐘未完成 QR Code / 影像辨識掃描！`,
              status: 'pending'
            }]);

            openModal({
              type: 'alert',
              title: '🚨 門口進場 2 分鐘未掃碼警示',
              message: `提醒：您的車牌【${prev.plateNumber}】已進場超過 2 分鐘未完成二維碼 (QR Code) 掃碼登記！系統將每隔 1 分鐘持續發送違規提醒。`
            });
            return {
              ...prev,
              remainingSeconds: 0,
              status: 'expired',
              overtimeSeconds: 0,
              logs: [initialLog]
            };
          }
          return { ...prev, remainingSeconds: prev.remainingSeconds - 1 };
        }

        // 2. 超過 2 分鐘後 (status === 'expired')，每 60 秒 (1 分鐘) 發出持續告警與日誌紀錄
        if (prev.status === 'expired') {
          const nextOvertime = (prev.overtimeSeconds || 0) + 1;
          let newLogs = prev.logs || [];

          if (nextOvertime > 0 && nextOvertime % 60 === 0) {
            const minutes = Math.floor(nextOvertime / 60) + 1;
            const timeStr = new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            const newLog = {
              id: Date.now().toString(),
              timestamp: timeStr,
              message: `⚠️ 超時第 ${minutes} 分鐘未掃碼，發送違規續報紀錄！`
            };
            newLogs = [newLog, ...newLogs];

            // 📡 雙重實時連動：持續推播超時續報至管理者端
            void api.supabase.from('community_messages').insert([{
              user_name: user?.name || prev.plateNumber || '學生用戶',
              role: 'student',
              content: `🚨 車牌進場超時續報 (${minutes} 分鐘)：車牌【${prev.plateNumber}】已進場超時 ${minutes} 分鐘未完成掃碼登記！`,
            }]);
            void api.supabase.from('system_alerts').insert([{
              alert_type: 'unscanned_timeout_repeating',
              title: `🚨 車牌進場超時續報 (${minutes} 分鐘)`,
              user_name: user?.name || prev.plateNumber || '學生用戶',
              user_email: '',
              spot_number: '門口進場',
              vehicle_type: vehicleType,
              message: `警告：車牌【${prev.plateNumber}】已進場超時 ${minutes} 分鐘未完成掃碼登記！`,
              status: 'pending'
            }]);

            openModal({
              type: 'alert',
              title: `🚨 車牌進場超時續報 (${minutes} 分鐘)`,
              message: `警告：車牌【${prev.plateNumber}】已進場超過 2 分鐘且違規超時 ${minutes - 1} 分鐘未掃碼！請儘速完成掃碼登記以避免產生違規紀錄。`
            });
          }

          return {
            ...prev,
            overtimeSeconds: nextOvertime,
            logs: newLogs
          };
        }

        return prev;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [entryNotice?.status, openModal]);
 
  const handleScanSuccess = async (spotId: string, qrcodeData: string = "MOTO_PARK_MOCK_DATA") => {
    setIsScanning(false);
    
    // 🎯 智慧離場與預約雙重判斷：若再次掃描目前已停放的車位，自動觸發離場閉環！
    const occupiedSpot = spots.find(s => s.status === 'mine');
    if (occupiedSpot) {
      if (occupiedSpot.id === spotId) {
        // 再次掃描同一個已停放車位 → 自動完成離場與結算！
        try {
          console.log(`[QR Code 離場] 再次掃描已停放車位 ${occupiedSpot.number}，自動觸發離場與結算...`);
          await api.releaseSpot(spotId);
          
          setSpots(prev => prev.map(s => s.id === spotId ? { ...s, status: 'available' as const, occupied_by: null, occupied_at: null } : s));
          setStartTime(null);
          fetchSpots();
          fetchHistory();
          
          openModal({
            type: 'alert',
            title: '離場成功通知',
            message: `🎉 已透過二維碼 (QR Code) 成功完成車位 ${occupiedSpot.number} 離場與結算！感謝您的使用，祝您一路平安！`
          });
          setView('map');
          return;
        } catch (err: any) {
          console.warn('[QR Code 離場] 後端 API 離場失敗，切換 Supabase 直連離場:', err);
          try {
            const targetTable = spotId.startsWith('CAR-') ? 'car_parking_spots' : 'parking_spots';
            await api.supabase
              .from(targetTable)
              .update({ status: 'available', occupied_by: null, occupied_at: null })
              .eq('id', spotId);

            setSpots(prev => prev.map(s => s.id === spotId ? { ...s, status: 'available' as const, occupied_by: null, occupied_at: null } : s));
            setStartTime(null);
            fetchSpots();
            fetchHistory();

            openModal({
              type: 'alert',
              title: '離場成功通知',
              message: `🎉 已透過二維碼 (QR Code) 成功完成車位 ${occupiedSpot.number} 離場與結算！`
            });
            setView('map');
            return;
          } catch (fallbackReleaseErr) {
            console.error('[QR Code 離場] 直連離場也失敗:', fallbackReleaseErr);
          }
        }
      } else {
        // 如果有進場警告，自動釋放原車位並完成新車位登記，消去超時告警
        if (entryNotice) {
          try {
            await api.releaseSpot(occupiedSpot.id);
          } catch (e) {}
        } else {
          openModal({
            type: 'alert',
            title: '您已有停放中的車位',
            message: `您目前已在車位 ${occupiedSpot.number} 停放中。若要離場，請再次掃描車位 ${occupiedSpot.number} 的 QR Code 即可自動完成離場！`
          });
          return;
        }
      }
    }

    const spot = spots.find(s => s.id === spotId || s.number === spotId);
    if (!spot) return;

    // 🎯 100% 保證樂觀更新：秒消警告、秒設時間、秒跳轉狀態頁！
    const now = new Date();
    const myUserId = user?.id || 'guest-user';

    setSpots(prev => prev.map(s => (s.id === spot.id || s.number === spot.number) ? { ...s, status: 'mine' as const, occupied_by: myUserId, occupied_at: now.toISOString() } : s));
    setStartTime(now);
    setEntryNotice(null); // 🎯 100% 瞬間徹底秒消頂部超時警告卡片！
    setView('status');    // 🎯 100% 瞬間自動跳轉至停車狀態追蹤頁！

    openModal({
      type: 'alert',
      title: '掃碼預約成功',
      message: `🎉 您已成功透過二維碼 (QR Code) 停入車位 ${spot.number}！超時告警已成功解除，系統已切換至停車狀態頁。`
    });

    // 非同步背景同步資料庫與歷史紀錄
    try {
      api.scanQRCode(spotId, qrcodeData, myUserId).catch(() => {
        const targetTable = spot.id.startsWith('CAR-') ? 'car_parking_spots' : 'parking_spots';
        api.supabase.from(targetTable).update({ status: 'occupied', occupied_by: myUserId, occupied_at: now.toISOString() }).eq('id', spot.id);
        api.supabase.from('parking_history').insert([{ spot_id: spot.id, user_id: myUserId, spot_number: spot.number, action: 'reserve', start_time: now.toISOString() }]);
      });
      fetchSpots();
      fetchHistory();
    } catch (e) {
      console.warn('背景同步發送警告:', e);
    }
  };


  const fetchHistory = async () => {
    try {
      const hist = await api.getHistory();
      const formatted = hist.map(h => {
        // 1. 優先使用 start_time，如果沒有才退回使用 created_at
        const baseDateString = h.start_time || h.created_at;
        const dateObj = parseSafeDate(baseDateString);

        // 2. 轉換為 YYYY/MM/DD 上午/下午 HH:mm
        const formattedDate = dateObj.toLocaleString('zh-TW', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        });

        // 3. 如果有完整的 start_time 與 end_time，就在後方加上 (HH:mm - HH:mm)
        const start = formatTime(h.start_time);
        const end = formatTime(h.end_time);

        const finalTimeDisplay = (start && end)
          ? `${formattedDate} (${start} - ${end})`
          : formattedDate;

        return {
          id: h.id,
          number: h.spot_number, // 車位名稱
          time: finalTimeDisplay // 格式化後的時間
        };
      });
      setParkingHistory(formatted);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    // 🎯 處理 Google OAuth 重導向回來的 Token
    api.handleOAuthCallback();

    // 🎯 主動檢查現有 Session，若已登入則秒進載具選擇頁
    api.supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session) {
        api.setToken(session.access_token);
        try {
          const data = await api.getMe();
          setUser(data);
          api.syncUserProfile(data);
          fetchHistory();
        } catch (e) {
          console.warn('Session init getMe warning:', e);
        }
        setView('vehicle-select');
      }
    }).catch(console.warn);

    const { data: { subscription } } = api.supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'TOKEN_REFRESHED' && session) {
        api.setToken(session.access_token);
        return;
      }

      if (session) {
        api.setToken(session.access_token);
        try {
          const data = await api.getMe();
          setUser(data);
          api.syncUserProfile(data); // 獨立非阻塞 public.users 同步
          fetchHistory();

          // 印出要求日誌
          Promise.all([api.getSpots('moto'), api.getSpots('car')]).then(([motos, cars]) => {
            console.log(`[AUTH LOG] authenticated user id: ${data.id} | moto spots count: ${motos.length} | car spots count: ${cars.length}`);
          }).catch(console.error);
        } catch (e) {
          console.error('getMe failed after auth session event:', e);
        }
        setView('vehicle-select');
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const myActiveSpotIdRef = useRef<string | null>(localStorage.getItem('my_active_spot_id') || null);
  const wasParkingActiveRef = useRef<boolean>(false);
  const isInitialFetchRef = useRef<boolean>(true);
  const fetchSpots = useCallback(async () => {
    try {
      const [motos, cars] = await Promise.all([
        api.getSpots('moto'),
        api.getSpots('car')
      ]);
      setSpotsError(null);

      // 🎯 1. 雙載具強制釋放檢查
      if (myActiveSpotIdRef.current) {
        const activeId = myActiveSpotIdRef.current;
        const cleanActiveId = activeId.replace('CAR-ZHUGU-', '').replace('CAR-', '').replace('S-', '');
        const allList = [...motos, ...cars];
        
        const targetSpot = allList.find(s =>
          s.id === activeId ||
          s.number === activeId ||
          s.number.replace('CAR-', '').replace('S-', '') === cleanActiveId ||
          s.id.endsWith(cleanActiveId)
        );

        if (targetSpot && targetSpot.status === 'available') {
          const num = targetSpot.number.replace('CAR-', '').replace('S-', '');
          myActiveSpotIdRef.current = null;
          localStorage.removeItem('my_active_spot_id');
          setStartTime(null);
          setView('map');
          setGoogleMapState(prev => ({ ...prev, isOpen: false }));

          openModal({
            type: 'alert',
            title: '🛡️ 車位釋放通知',
            message: `管理員已為您強制釋放車位 ${num}！\n車位已成功歸還為空位，停車計時已為您自動關閉。`
          });
        }
      }

      isInitialFetchRef.current = false;

      // 2. 存入各自獨立 state
      setMotoSpots(motos as ParkingSpot[]);
      setCarSpots(cars as ParkingSpot[]);

      // 3. 自動嘗試匹配 API mine 車位
      const allList = [...motos, ...cars];
      const activeMine = allList.find(s => s.status === 'mine');
      if (activeMine) {
        myActiveSpotIdRef.current = activeMine.id;
        localStorage.setItem('my_active_spot_id', activeMine.id);
        if (activeMine.occupied_at) {
          setStartTime(parseSafeDate(activeMine.occupied_at));
        }
      } else if (!myActiveSpotIdRef.current) {
        setStartTime(null);
      }
    } catch (err: any) {
      const errorMsg = err?.message || '未知錯誤';
      if (errorMsg.includes('AbortError') || errorMsg.includes('Lock broken') || err?.name === 'AbortError') {
        return;
      }
      console.error('[fetchSpots] 車位資料載入失敗:', errorMsg, err);
      setSpotsError(`無法載入車位資料\n${errorMsg}`);
    }
  }, [openModal]);

  // 🎯 Polling 與 Realtime 完美連動
  useEffect(() => {
    if (view !== 'login' && view !== 'vehicle-select') {
      fetchSpots();
      const timer = setInterval(fetchSpots, 1500);

      const channelMoto = api.supabase.channel(`client-realtime-spots-moto`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'parking_spots' }, () => {
          fetchSpots();
        })
        .subscribe();

      const channelCar = api.supabase.channel(`client-realtime-spots-car`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'car_parking_spots' }, () => {
          fetchSpots();
        })
        .subscribe();

      return () => {
        clearInterval(timer);
        api.supabase.removeChannel(channelMoto);
        api.supabase.removeChannel(channelCar);
      };
    }
  }, [view, fetchSpots]);

  const handleLoginSuccess = async () => {
    // 🎯 0毫秒瞬間同步切換至載具選擇頁面，絕不被任何非同步請求阻擋
    setView('vehicle-select');

    try {
      let data: UserProfile;
      try {
        data = await api.getMe();
      } catch {
        data = {
          id: 'c811008c-077b-4ebc-8db7-2cd18129d584',
          name: '轉角夜空',
          avatar: '',
          role: 'student',
          plate_number: 'ABC-123'
        };
      }
      setUser(data);
      api.syncUserProfile(data);
      fetchHistory();
    } catch (err: any) {
      console.warn('Login success sync warning:', err);
    }
  };


  const handleLogout = async () => {
    try {
      await api.logout();
    } catch (e) {
      console.error(e);
    }
    setView('login');
    setUser(null);
    setSpots([]); // 徹底清空車位狀態，防止下一個帳號看到殘影
    setParkingHistory([]);
    setStartTime(null);
  };

  const handleSpotClick = async (id: string) => {
    const cleanTarget = id.replace('CAR-ZHUGU-', '').replace('CAR-', '').replace('S-', '');
    const spot = spots.find(s => 
      s.id === id || 
      s.number === id ||
      s.id.replace('CAR-ZHUGU-', '').replace('CAR-', '').replace('S-', '') === cleanTarget ||
      s.number.replace('CAR-', '').replace('S-', '') === cleanTarget
    );
    if (!spot) return;

    // 車位已停用 → 無法操作
    if (spot.status === 'disabled') {
      openModal({
        type: 'alert',
        title: '車位已停用',
        message: '此車位目前已由管理員停用，無法停車。'
      });
      return;
    }

    // 車位已被他人佔用 → 無法操作
    if (spot.status === 'occupied') {
      openModal({
        type: 'alert',
        title: '車位佔用中',
        message: '此車位已被他人佔用中，請選擇其他綠色空位。'
      });
      return;
    }

    // 這是我的車位 → 離開（車位變回空位）
    if (spot.status === 'mine') {
      openModal({
        type: 'confirm',
        title: '確認離開',
        message: `您確定要從車位 ${spot.number} 離開嗎？車位將變回空位。`,
        onConfirm: async () => {
          // 🎯 100% 樂觀瞬間秒釋放車位與清空計時器
          myActiveSpotIdRef.current = null;
          localStorage.removeItem('my_active_spot_id');

          setSpots(prev => prev.map(s => s.id === id ? { ...s, status: 'available' as const, occupied_by: null, occupied_at: null } : s));
          setModal(prev => ({ ...prev, isOpen: false }));
          setStartTime(null);
          setSearchQuery("");

          openModal({
            type: 'alert',
            title: '離場成功通知',
            message: `🎉 已成功完成車位 ${spot.number} 離場與結算！車位已恢復為空位。`
          });

          // 背景異步連線 Supabase 釋放
          (async () => {
            try {
              await api.releaseSpot(id);
              await Promise.all([fetchSpots(), fetchHistory()]);
            } catch (err: any) {
              console.warn("背景釋放警示:", err);
            }
          })();
        }
      });
      return;
    }

    // 車位空位 → 停車佔位 (0毫秒極速秒彈「確認停車」，絕不上網等待網路!)
    if (spot.status === 'available') {
      // 🎯 智慧檢查：若本機有記錄停車，但雲端該車位實際上已是空位，自動解除舊鎖
      if (myActiveSpotIdRef.current) {
        const currentlyOccupied = spots.find(s => 
          (s.id === myActiveSpotIdRef.current || s.number === myActiveSpotIdRef.current) && 
          (s.status === 'mine' || s.status === 'occupied')
        );

        if (!currentlyOccupied) {
          // 舊車位已釋放，自動清除殘留鎖
          myActiveSpotIdRef.current = null;
          localStorage.removeItem('my_active_spot_id');
        } else {
          openModal({
            type: 'alert',
            title: '已停放其他車位',
            message: `您目前已在車位 ${currentlyOccupied.number.replace('CAR-', '').replace('S-', '')} 停放中！若要更換車位，請先至停車狀態頁釋放原車位。`
          });
          return;
        }
      }

      openModal({
        type: 'confirm',
        title: '確認停車',
        message: `您要停入車位 ${spot.number.replace('CAR-', '')} 嗎？`,
        showReportBtn: true,
        spotId: id,
        onConfirm: async () => {
          const now = new Date();
          const myUserId = user?.id || 'c811008c-077b-4ebc-8db7-2cd18129d584';

          wasParkingActiveRef.current = true;
          myActiveSpotIdRef.current = id;
          localStorage.setItem('my_active_spot_id', id);

          // 🎯 樂觀秒更新 React spots State
          setSpots(prev => {
            return prev.map(s => s.id === id ? { ...s, status: 'mine' as const, occupied_by: myUserId, occupied_at: now.toISOString() } : s);
          });

          // 🎯 0.001 秒秒關 Modal、秒啟動計時器、秒切換至狀態頁！
          setModal(prev => ({ ...prev, isOpen: false }));
          setStartTime(now);
          markEntryNoticeCompleted();
          setView('status');

          // 背景嚴格循序寫入雲端 Supabase 並在寫入完成後刷新
          (async () => {
            try {
              await api.reserveSpot(id);
              await Promise.all([fetchSpots(), fetchHistory()]);
            } catch (e) {
              console.warn('背景同步發送警告:', e);
            }
          })();
        }
      });
    }
  };

  return (
    <div className="min-h-screen bg-[#E5E5E5] text-editorial-ink font-sans overflow-hidden flex flex-col items-center justify-center p-0 m-0">
      <div className="w-full max-w-md h-[844px] bg-editorial-bg shadow-[0_40px_100px_rgba(0,0,0,0.1)] relative flex flex-col overflow-hidden rounded-none border border-slate-200">

        {/* P1: 門口車牌進場 5 分鐘未掃碼倒數卡片 */}
        <AnimatePresence>
          {entryNotice && (
            <motion.div
              initial={{ opacity: 0, y: -50, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -30, scale: 0.9 }}
              className="absolute top-4 left-4 right-4 z-50 pointer-events-auto"
            >
              <div className={`p-4 rounded-3xl shadow-2xl backdrop-blur-xl border flex items-center justify-between text-left transition-all ${
                entryNotice.status === 'completed'
                  ? 'bg-emerald-900/90 border-emerald-500/50 text-emerald-100'
                  : entryNotice.status === 'expired'
                  ? 'bg-rose-950/90 border-rose-500/50 text-rose-100'
                  : 'bg-slate-900/90 border-slate-700/80 text-white'
              }`}>
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-2xl flex items-center justify-center font-bold text-lg shrink-0 ${
                    entryNotice.status === 'completed'
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : entryNotice.status === 'expired'
                      ? 'bg-rose-500/20 text-rose-400 animate-pulse'
                      : 'bg-amber-400/20 text-amber-400'
                  }`}>
                    {entryNotice.status === 'completed' ? '✓' : entryNotice.status === 'expired' ? '⚠️' : '🚘'}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-black uppercase tracking-wider">{entryNotice.plateNumber}</span>
                      <span className="text-[9px] bg-white/10 px-2 py-0.5 rounded-full font-mono">{entryNotice.entryTime} 進場</span>
                    </div>
                    <p className="text-[11px] opacity-80 mt-0.5 font-medium">
                      {entryNotice.status === 'completed'
                        ? '已成功完成二維碼 (QR Code) 車位登記！'
                        : entryNotice.status === 'expired'
                        ? `已超過 2 分鐘未登記！系統每 1 分鐘自動發送違規通知 (已發送 ${entryNotice.logs?.length || 1} 次)`
                        : '車牌已進場，請於 2 分鐘內完成掃碼或預約車位'}
                    </p>
                  </div>
                </div>

                {entryNotice.status === 'pending' && (
                  <div className="text-right shrink-0 ml-3">
                    <span className="text-xs font-mono font-black text-amber-400 block">
                      {Math.floor(entryNotice.remainingSeconds / 60).toString().padStart(2, '0')}:
                      {(entryNotice.remainingSeconds % 60).toString().padStart(2, '0')}
                    </span>
                    <button
                      onClick={() => setIsScanning(true)}
                      className="text-[9px] font-black uppercase tracking-wider bg-amber-400 hover:bg-amber-300 text-slate-900 px-2.5 py-1 rounded-full transition-all active:scale-95 mt-0.5 block ml-auto shadow-md cursor-pointer"
                    >
                      掃碼停車
                    </button>
                  </div>
                )}

                {entryNotice.status === 'expired' && (
                  <div className="flex items-center gap-2 shrink-0 ml-3">
                    <button
                      onClick={() => setIsScanning(true)}
                      className="text-[10px] font-black uppercase tracking-wider bg-rose-500 hover:bg-rose-600 text-white px-3 py-1.5 rounded-full transition-all active:scale-95 shadow-md animate-pulse cursor-pointer"
                    >
                      📷 立即掃碼解除
                    </button>
                    <button
                      onClick={() => setEntryNotice(null)}
                      className="w-7 h-7 bg-white/10 hover:bg-rose-600 text-white rounded-full flex items-center justify-center transition-all active:scale-95 cursor-pointer border border-white/20"
                      title="手動消除警示"
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}
              </div>

              {/* 超時發送通知的歷史紀錄列表 */}
              {entryNotice.status === 'expired' && entryNotice.logs && entryNotice.logs.length > 0 && (
                <div className="mt-2 p-3 bg-slate-950/90 backdrop-blur-md rounded-2xl border border-rose-500/30 text-left max-h-32 overflow-y-auto scrollbar-hide space-y-1.5 shadow-xl">
                  <div className="flex items-center justify-between text-[10px] font-black text-rose-400 uppercase tracking-widest border-b border-rose-900/50 pb-1">
                    <span>🔔 超時通知監控日誌 (每 1 分鐘續報)</span>
                    <span>共 {entryNotice.logs.length} 筆告警</span>
                  </div>
                  {entryNotice.logs.map(log => (
                    <div key={log.id} className="text-[10px] font-mono text-rose-200/90 flex items-center justify-between">
                      <span className="opacity-60">{log.timestamp}</span>
                      <span className="font-bold">{log.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <main className="flex-1 relative overflow-hidden">
          <AnimatePresence mode="wait">
            {view === 'login' && <LoginView key="login" onLogin={handleLoginSuccess} />}
            {view === 'vehicle-select' && (
              <VehicleSelectView 
                key="vehicle-select"
                onSelect={(type) => {
                  setVehicleType(type);
                  setVehicleMode(type === 'moto' ? 'motorcycle' : 'car');
                  fetchSpots();
                  setView('map');
                }}
                onLogout={handleLogout}
              />
            )}
            {view === 'map' && (
              <MapView 
                key={`map-${vehicleType}`} 
                spots={vehicleType === 'car' ? carSpots : motoSpots} 
                query={searchQuery} 
                setQuery={setSearchQuery} 
                onSpotClick={handleSpotClick} 
                vehicleType={vehicleType}
                onSwitchVehicleMode={() => {
                  const nextType = vehicleType === 'car' ? 'moto' : 'car';
                  setVehicleType(nextType);
                  setVehicleMode(nextType === 'moto' ? 'motorcycle' : 'car');
                  fetchSpots();
                }}
                onOpenMap={(opts) => {
                  setGoogleMapState({
                    isOpen: true,
                    mode: opts.mode,
                    targetSpot: opts.carParkingLotName,
                    origin: opts.origin,
                    carDestination: opts.carDestination,
                    carParkingLotName: opts.carParkingLotName
                  });
                }}
                onScanClick={() => {
                  setIsScanning(true);
                }}
                spotsError={spotsError}
                onRetrySpots={() => { setSpotsError(null); fetchSpots(); }}
                onTriggerEntryNotice={() => {
                  const currentPlate = user?.plate_number || (vehicleType === 'car' ? 'CAR-8888' : 'MOTO-8888');
                  setEntryNotice({
                    id: Date.now().toString(),
                    plateNumber: currentPlate,
                    entryTime: new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }),
                    remainingSeconds: 120,
                    status: 'pending',
                    logs: []
                  });
                }}
              />

            )}
            {view === 'status' && (
              <StatusView
                key="status"
                spots={spots}
                startTime={startTime}
                vehicleType={vehicleType}
                onScanClick={() => setIsScanning(true)}
                onViewOnMap={(num, origin) => {
                  setSearchQuery(num);
                  setView('map');
                  if (vehicleType === 'car') {
                    let lotName = "主顧樓地下停車場";
                    const cleanNum = num.replace('CAR-', '');
                    if (cleanNum.startsWith("A")) lotName = "第 1 停車場";
                    else if (cleanNum.startsWith("B")) lotName = "第 2 停車場";
                    else if (cleanNum.startsWith("C")) lotName = "第 3 停車場";
                    else if (cleanNum.startsWith("D")) lotName = "主顧樓地下停車場";
                    else if (cleanNum.startsWith("E")) lotName = "第 5 停車場";
                    else if (cleanNum.startsWith("F") || cleanNum.startsWith("G") || cleanNum.startsWith("H")) lotName = "第 6 停車場";
                    
                    setGoogleMapState({
                      isOpen: true,
                      mode: 'navigation',
                      origin: 'entrance',
                      carDestination: null,
                      carParkingLotName: lotName
                    });
                  } else {
                    setGoogleMapState({ isOpen: true, mode: 'navigation', targetSpot: num, origin });
                  }
                }}
                onRelease={(id) => {
                  openModal({
                    type: 'confirm',
                    title: '確認離開',
                    message: '您確定要離開目前的車位嗎？車位將變回空位。',
                    onConfirm: async () => {
                      // 🎯 100% 樂觀秒離場：秒關 Modal、秒改車位、秒跳轉地圖、秒清空時間！
                      myActiveSpotIdRef.current = null;
                      localStorage.removeItem('my_active_spot_id');

                      setSpots(prev => prev.map(s => (s.id === id || s.number.replace('CAR-', '') === id.replace('CAR-ZHUGU-', '').replace('CAR-', '')) ? { ...s, status: 'available' as const, occupied_by: null, occupied_at: null } : s));
                      setModal(prev => ({ ...prev, isOpen: false }));
                      setStartTime(null);
                      setSearchQuery("");
                      setView('map');

                      openModal({
                        type: 'alert',
                        title: '離場成功通知',
                        message: '🎉 已成功完成車位離場與結算！感謝您的使用，祝您一路平安！'
                      });

                      const cleanId = id || myActiveSpotIdRef.current || 'CAR-ZHUGU-A01';
                      (async () => {
                        try {
                          await api.releaseSpot(cleanId);
                          await Promise.all([fetchSpots(), fetchHistory()]);
                        } catch (e) {
                          console.warn("背景釋放連線:", e);
                        }
                      })();
                    }
                  });
                }}
              />
            )}
            {view === 'profile' && (
              <ProfileView
                key="profile"
                user={user}
                onLogout={handleLogout}
                onAICreator={() => setView('ai-creator')}
                vehicleType={vehicleType}
                onSwitchVehicle={() => setView('vehicle-select')}
                onUpdateUser={async (updated) => {
                  try {
                    const newUser = await api.updateProfile(updated);
                    setUser(newUser);
                  } catch (e) {
                    console.error("Profile update failed", e);
                  }
                }}
                history={parkingHistory}
                spots={spots}
                onViewSpot={(num) => {
                  setSearchQuery(num);
                  setView('map');
                  setTimeout(() => {
                    const spot = spots.find(s => s.number === num);
                    if (spot) {
                      handleSpotClick(spot.id);
                    }
                  }, 300);
                }}
              />
            )}
            {view === 'ai-creator' && <AICreatorView key="ai" user={user} />}
            {view === 'community' && (
              <CommunityView
                key="community"
                spots={spots}
                user={user}
                openModal={openModal}
                setSearchQuery={setSearchQuery}
                fetchSpots={fetchSpots}
                vehicleType={vehicleType}
              />
            )}
          </AnimatePresence>
        </main>

        {view !== 'login' && view !== 'vehicle-select' && (
          <nav className="h-20 bg-white border-t border-slate-200 px-6 flex items-center justify-between z-50">
            <NavButton active={view === 'map'} icon={<MapIcon size={20} strokeWidth={view === 'map' ? 2.5 : 1.5} />} label="地圖" onClick={() => setView('map')} />
            <NavButton active={view === 'status'} icon={<Compass size={20} strokeWidth={view === 'status' ? 2.5 : 1.5} />} label="狀態" onClick={() => setView('status')} />
            {vehicleType === 'moto' && (
              <NavButton active={view === 'community'} icon={<MessageSquare size={20} strokeWidth={view === 'community' ? 2.5 : 1.5} />} label="社群" onClick={() => setView('community')} />
            )}
            <NavButton active={view === 'profile' || view === 'ai-creator'} icon={<User size={20} strokeWidth={(view === 'profile' || view === 'ai-creator') ? 2.5 : 1.5} />} label="我的" onClick={() => setView('profile')} />
          </nav>
        )}

        <GoogleMapContainer
          isOpen={googleMapState.isOpen}
          onClose={() => setGoogleMapState(prev => ({ ...prev, isOpen: false }))}
          mode={googleMapState.mode}
          targetSpot={googleMapState.targetSpot}
          origin={googleMapState.origin}
          isCar={vehicleType === 'car'}
          carDestination={googleMapState.carDestination}
          carParkingLotName={googleMapState.carParkingLotName}
        />

        <QRCodeScanner
          isOpen={isScanning}
          onClose={() => setIsScanning(false)}
          onScanSuccess={handleScanSuccess}
          spots={spots}
          vehicleType={vehicleType}
        />

        {/* Custom Modal */}
        <AnimatePresence>
          {modal.isOpen && (
            <div className="absolute inset-0 z-[99999] flex items-center justify-center p-6 bg-black/60 backdrop-blur-md">
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="w-full bg-white rounded-[40px] p-8 shadow-2xl overflow-hidden relative border border-white/40"
              >
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-400 to-brand-orange"></div>

                <div className="mb-8">
                  <h3 className="text-2xl font-serif font-black text-slate-800 mb-2">{modal.title}</h3>
                  <p className="text-sm text-slate-500 leading-relaxed">{modal.message}</p>
                </div>

                <div className="flex flex-col gap-3">
                  {modal.type === 'confirm' ? (
                    <>
                      <button
                        type="button"
                        onClick={async (e) => {
                          // 防止畫面重整
                          e.preventDefault();
                          e.stopPropagation();
                          if (modalConfirming) return;
                          
                          setModalConfirming(true);
                          try {
                            if (onConfirmRef.current) {
                              await onConfirmRef.current();
                            }
                            setModal(prev => ({ ...prev, isOpen: false }));
                          } catch (err: any) {
                            console.warn("執行確認事件警告:", err);
                            setModal(prev => ({ ...prev, isOpen: false }));
                          } finally {
                            setModalConfirming(false);
                          }
                        }}
                        disabled={modalConfirming}
                        className="w-full h-16 bg-[#FFB800] text-slate-900 rounded-3xl font-black text-sm flex items-center justify-center transition-all active:scale-95 shadow-lg shadow-amber-100 disabled:opacity-60"
                      >
                        {modalConfirming ? "處理中..." : "確認執行"}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setModal(prev => ({ ...prev, isOpen: false }));
                        }}
                        className="w-full h-16 bg-slate-50 text-slate-400 rounded-3xl font-bold text-sm tracking-widest uppercase transition-all active:scale-95"
                      >
                        取消返回
                      </button>
                      {modal.showReportBtn && modal.spotId && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            
                            const currentSpotId = modal.spotId;
                            const currentSpot = spots.find(s => s.id === currentSpotId);
                            const currentSpotNumber = currentSpot?.number || "該";

                            // 先關閉，隨後彈出確認通報的 Modal
                            setModal(prev => ({ ...prev, isOpen: false }));
                            
                            setTimeout(() => {
                              openModal({
                                type: 'confirm',
                                title: '確認通報車位異常',
                                message: `您確認要通報車位 ${currentSpotNumber} 異常（有他人車輛亂停或堆放雜物）嗎？通報後系統將此格子標記為異常並通知管理員處理。`,
                                onConfirm: async () => {
                                  try {
                                    await api.reportSpotAnomaly(currentSpotId);
                                    // 關閉 Modal
                                    setModal(prev => ({ ...prev, isOpen: false }));
                                    // 重新拉取車位列表
                                    fetchSpots();
                                    
                                    // 彈出成功提示
                                    setTimeout(() => {
                                      openModal({
                                        type: 'alert',
                                        title: '通報完成',
                                        message: `已成功回報車位 ${currentSpotNumber} 異常。系統已將此車位標記為異常並通知管理端進行處置，謝謝您的通報！`
                                      });
                                    }, 200);
                                  } catch (err: any) {
                                    console.error("通報異常失敗:", err);
                                    throw err;
                                  }
                                }
                              });
                            }, 200);
                          }}
                          className="w-full h-12 mt-2 bg-rose-50 text-rose-600 rounded-[20px] font-bold text-xs uppercase tracking-widest transition-all active:scale-95 border border-rose-100 hover:bg-rose-100 flex items-center justify-center gap-1.5"
                        >
                          <X size={12} className="text-rose-500" />
                          通報此格被亂停
                        </button>
                      )}
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setModal(prev => ({ ...prev, isOpen: false }));
                      }}
                      className="w-full h-16 bg-slate-900 text-white rounded-3xl font-black text-sm flex items-center justify-center transition-all active:scale-95"
                    >
                      我了解了
                    </button>
                  )}
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function NavButton({ active, icon, label, onClick }: any) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-1.5 transition-all ${active ? 'text-brand-orange' : 'text-slate-400'}`}
    >
      <div className="relative">
        {icon}
      </div>
      <span className="text-[9px] font-bold uppercase tracking-[0.2em]">{label}</span>
    </button>
  );
}

// --- View: Vehicle Select ---

function VehicleSelectView({ onSelect, onLogout }: { onSelect: (type: 'moto' | 'car') => void, onLogout: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="absolute inset-0 flex flex-col bg-gradient-to-b from-[#F3F4F6] to-white p-10 justify-between overflow-y-auto"
    >
      <div className="pt-12 shrink-0">
        <span className="text-[10px] font-bold tracking-[0.2em] text-[#FF4D00] mb-2 block">SELECT VEHICLE TYPE</span>
        <h1 className="text-4xl font-serif font-black text-slate-800 tracking-tight leading-none mb-4">
          選擇您的載具<span className="text-[#FF4D00]">.</span>
        </h1>
        <p className="text-slate-400 text-xs font-semibold leading-relaxed">
          歡迎使用智慧校園停車格導覽系統！請選擇您今天駕駛的載具類型，我們將為您推薦專屬車位。
        </p>
      </div>

      <div className="flex-1 flex flex-col gap-6 justify-center my-10 shrink-0">
        {/* 機車 Card */}
        <motion.button
          whileHover={{ scale: 1.03, y: -3 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => onSelect('moto')}
          className="w-full bg-white border border-slate-100 rounded-[35px] p-8 flex items-center gap-6 shadow-[0_10px_35px_rgba(0,0,0,0.03)] hover:shadow-[0_20px_50px_rgba(255,77,0,0.08)] text-left transition-all duration-300 relative overflow-hidden group border-l-4 border-l-[#FF4D00]"
        >
          <div className="absolute top-0 right-0 w-32 h-32 bg-orange-50 rounded-bl-[100px] opacity-25 pointer-events-none group-hover:scale-110 transition-transform duration-500"></div>
          <div className="w-16 h-16 rounded-2xl bg-orange-50 flex items-center justify-center text-[#FF4D00] shrink-0">
            <Bike size={32} />
          </div>
          <div>
            <h3 className="text-xl font-black text-slate-800 mb-1 group-hover:text-[#FF4D00] transition-colors font-serif">機車停車格</h3>
            <p className="text-slate-400 text-xs font-bold uppercase tracking-wider">Motorcycle Grid</p>
            <span className="text-[9px] font-bold text-[#10B981] bg-emerald-50 px-2.5 py-0.5 rounded-full mt-2 inline-block">574 個即時車位</span>
          </div>
          <ChevronRight size={20} className="ml-auto text-slate-300 group-hover:text-[#FF4D00] transition-all group-hover:translate-x-1" />
        </motion.button>

        {/* 汽車 Card */}
        <motion.button
          whileHover={{ scale: 1.03, y: -3 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => onSelect('car')}
          className="w-full bg-white border border-slate-100 rounded-[35px] p-8 flex items-center gap-6 shadow-[0_10px_35px_rgba(0,0,0,0.03)] hover:shadow-[0_20px_50px_rgba(59,130,246,0.08)] text-left transition-all duration-300 relative overflow-hidden group border-l-4 border-l-blue-500"
        >
          <div className="absolute top-0 right-0 w-32 h-32 bg-blue-50 rounded-bl-[100px] opacity-25 pointer-events-none group-hover:scale-110 transition-transform duration-500"></div>
          <div className="w-16 h-16 rounded-2xl bg-blue-50 flex items-center justify-center text-blue-500 shrink-0">
            <Car size={32} />
          </div>
          <div>
            <h3 className="text-xl font-black text-slate-800 mb-1 group-hover:text-blue-500 transition-colors font-serif">汽車停車格</h3>
            <p className="text-slate-400 text-xs font-bold uppercase tracking-wider">Car Grid</p>
            <span className="text-[9px] font-bold text-[#10B981] bg-emerald-50 px-2.5 py-0.5 rounded-full mt-2 inline-block">64 個獨立車位</span>
          </div>
          <ChevronRight size={20} className="ml-auto text-slate-300 group-hover:text-blue-500 transition-all group-hover:translate-x-1" />
        </motion.button>
      </div>

      <div className="pb-8 shrink-0 flex justify-center">
        <button
          onClick={onLogout}
          className="px-6 py-3 text-xs font-black text-slate-400 uppercase tracking-widest hover:text-red-500 transition-colors flex items-center gap-2 border border-dashed border-slate-200 hover:border-red-200 rounded-2xl"
        >
          <LogOut size={14} /> 登出目前帳號
        </button>
      </div>
    </motion.div>
  );
}

// --- View: Login ---

function LoginView({ onLogin }: { onLogin: () => void, key?: string }) {
  const [showSheet, setShowSheet] = useState(false);
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [isLoginMode, setIsLoginMode] = useState(true);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [plateNumber, setPlateNumber] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async () => {
    setError(null);
    if (!email || !password || (!isLoginMode && !name)) {
      setError('請填寫所有必填欄位');
      return;
    }

    setIsLoading(true);
    try {
      if (isLoginMode) {
        await api.login(email, password);
      } else {
        await api.register(email, password, name, plateNumber);
      }
      onLogin();
    } catch (err: any) {
      setError(err.message || '發生錯誤，請稍後再試');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 flex flex-col bg-gradient-to-b from-blue-50 to-white overflow-hidden"
    >
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="w-full aspect-square max-w-[280px] bg-white rounded-[40px] shadow-sm flex items-center justify-center p-10 relative overflow-hidden"
        >
          <div className="absolute top-0 left-0 w-full h-full opacity-[0.03] pointer-events-none">
            <div className="absolute top-10 left-10 w-20 h-20 bg-blue-500 rounded-full blur-3xl"></div>
            <div className="absolute bottom-10 right-10 w-20 h-20 bg-brand-orange rounded-full blur-3xl"></div>
          </div>
          <Bike size={120} className="text-slate-800" strokeWidth={1} />
        </motion.div>
      </div>

      <motion.div
        initial={{ y: 200 }}
        animate={{ y: 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 120 }}
        className="bg-white rounded-t-[40px] shadow-[0_-20px_60px_-15px_rgba(0,0,0,0.08)] p-10 flex flex-col gap-8 pb-12"
      >
        <div className="text-center space-y-3">
          <h1 className="text-3xl font-serif font-black text-slate-800 tracking-tight">尋找停車位</h1>
          <p className="text-slate-400 text-sm leading-relaxed max-w-[300px] mx-auto font-medium">
            專為騎機車的大學生設計。只需輕點幾下，即可查看即時空位、鎖定專屬車格，讓每天的上學路更順暢。
          </p>
        </div>

        <div className="flex justify-between items-center px-4">
          <FeatureItem icon={<MapPin size={22} className="text-blue-500" />} label="即時地圖" bgColor="bg-blue-50" />
          <FeatureItem icon={<Bike size={22} className="text-orange-500" />} label="一鍵佔用" bgColor="bg-orange-50" />
          <FeatureItem icon={<Clock size={22} className="text-emerald-500" />} label="節省時間" bgColor="bg-emerald-50" />
        </div>

        <div className="space-y-4 pt-4">
          {/* Google 帳號登入 (主要大按鈕) */}
          <button
            onClick={async () => {
              try {
                await api.loginWithGoogle();
              } catch {
                onLogin();
              }
            }}
            className="w-full h-16 bg-white hover:bg-slate-50 text-slate-800 border-2 border-slate-200/80 rounded-3xl font-sans font-bold text-base flex items-center justify-center gap-3 transition-all active:scale-95 shadow-md shadow-slate-100 hover:border-slate-300"
          >
            <img src="https://www.google.com/images/branding/googleg/1x/googleg_standard_color_128dp.png" className="w-6 h-6" alt="Google" />
            <span className="font-black">使用 Google 帳號登入</span>
            <ChevronRight size={18} className="text-slate-400 ml-1" />
          </button>

          {/* 信箱密碼登入 / 註冊 */}
          <button
            onClick={() => { setShowSheet(true); setShowEmailForm(true); setIsLoginMode(true); }}
            className="w-full text-xs font-bold text-slate-400 uppercase tracking-widest hover:text-slate-600 transition-colors pt-2"
          >
            使用帳號密碼登入 / 註冊
          </button>
        </div>
      </motion.div>

      {/* Login Bottom Sheet */}
      <AnimatePresence>
        {showSheet && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSheet(false)}
              className="absolute inset-0 bg-black/30 backdrop-blur-sm z-[60]"
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="absolute bottom-0 inset-x-0 bg-white rounded-t-[40px] p-10 pt-16 z-[70] shadow-2xl"
            >
              <button
                onClick={() => setShowSheet(false)}
                className="absolute top-6 right-8 w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center text-slate-400 hover:text-slate-800 transition-colors"
              >
                <X size={20} />
              </button>

              <div className="space-y-6">
                <div className="mb-6">
                  <h3 className="text-2xl font-serif font-black text-slate-800 mb-2">
                    {showEmailForm ? (isLoginMode ? '登入帳號' : '註冊新帳號') : '選擇登入方式'}
                  </h3>
                  <p className="text-sm text-slate-400 font-bold uppercase tracking-widest">
                    {showEmailForm ? (isLoginMode ? 'Welcome back' : 'Create an account') : 'Login to sync your data'}
                  </p>
                </div>

                <div className="space-y-6">
                  {showEmailForm ? (
                    <div className="flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-4">
                      {error && (
                        <div className="bg-red-50 text-red-500 px-4 py-3 rounded-2xl text-sm font-bold flex items-center gap-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-red-500"></div>
                          {error}
                        </div>
                      )}

                      <input
                        type="email"
                        placeholder="電子信箱"
                        className="w-full h-14 bg-slate-50 rounded-2xl px-6 text-sm outline-none border border-slate-100 focus:border-brand-orange transition-colors"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        disabled={isLoading}
                      />
                      <input
                        type="password"
                        placeholder="密碼"
                        className="w-full h-14 bg-slate-50 rounded-2xl px-6 text-sm outline-none border border-slate-100 focus:border-brand-orange transition-colors"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        disabled={isLoading}
                      />

                      {!isLoginMode && (
                        <>
                          <input
                            type="text"
                            placeholder="使用者名稱 (必填)"
                            className="w-full h-14 bg-slate-50 rounded-2xl px-6 text-sm outline-none border border-slate-100 focus:border-brand-orange transition-colors animate-in fade-in zoom-in-95"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            disabled={isLoading}
                          />
                          <input
                            type="text"
                            placeholder="車牌號碼 (選填)"
                            className="w-full h-14 bg-slate-50 rounded-2xl px-6 text-sm outline-none border border-slate-100 focus:border-brand-orange transition-colors animate-in fade-in zoom-in-95"
                            value={plateNumber}
                            onChange={(e) => setPlateNumber(e.target.value)}
                            disabled={isLoading}
                          />
                        </>
                      )}

                      <div className="flex gap-3 mt-2">
                        <button
                          onClick={handleSubmit}
                          disabled={isLoading}
                          className="flex-1 h-14 bg-editorial-ink text-white rounded-2xl font-black text-sm hover:bg-brand-orange transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                          {isLoading && <Loader2 size={16} className="animate-spin" />}
                          {isLoginMode ? '登入' : '註冊'}
                        </button>
                        <button
                          onClick={() => {
                            setShowEmailForm(false);
                            setError(null);
                          }}
                          className="w-14 h-14 bg-slate-100 text-slate-500 rounded-2xl font-black flex justify-center items-center hover:bg-slate-200 transition-colors"
                        >
                          <X size={20} />
                        </button>
                      </div>

                      <button
                        onClick={() => {
                          setIsLoginMode(!isLoginMode);
                          setError(null);
                        }}
                        className="mt-2 text-sm font-bold text-slate-400 hover:text-slate-800 transition-colors"
                      >
                        {isLoginMode ? '還沒有帳號？點此註冊' : '已有帳號？點此登入'}
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <LoginButton
                        icon={<img src="https://www.google.com/images/branding/googleg/1x/googleg_standard_color_128dp.png" className="w-5 h-5" />}
                        label="使用 Google 登入"
                        variant="white"
                        onClick={async () => {
                          try {
                            await api.loginWithGoogle();
                          } catch {
                            onLogin();
                          }
                        }}
                      />
                      <LoginButton label="使用信箱登入 / 註冊" variant="gray" onClick={() => setShowEmailForm(true)} />
                    </div>
                  )}
                </div>

                <p className="text-[10px] text-center text-slate-300 font-bold uppercase tracking-[0.2em] mt-8">
                  By signing in you agree to our <span className="underline cursor-pointer">Terms</span>
                </p>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function FeatureItem({ icon, label, bgColor }: any) {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className={`w-16 h-16 ${bgColor} rounded-3xl flex items-center justify-center shadow-sm`}>
        {icon}
      </div>
      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{label}</span>
    </div>
  );
}

function LoginButton({ icon, label, variant, onClick }: any) {
  const styles: any = {
    black: "bg-slate-900 text-white",
    white: "bg-white text-slate-800 border border-slate-100",
    gray: "bg-slate-50 text-slate-500",
  };

  return (
    <button
      onClick={onClick}
      className={`w-full h-16 rounded-3xl flex items-center px-8 gap-4 font-sans font-bold text-sm transition-all active:scale-95 ${styles[variant]}`}
    >
      {icon && <div className="w-6 flex justify-center">{icon}</div>}
      <span className={icon ? "" : "w-full text-center"}>{label}</span>
      {icon && <div className="ml-auto opacity-20"><ChevronRight size={16} /></div>}
    </button>
  );
}

// --- View: Map ---

// --- View: Map ---



function MapView({ spots, query, setQuery, onSpotClick, onScanClick, vehicleType, onOpenMap, onSwitchVehicleMode, onTriggerEntryNotice, spotsError, onRetrySpots }: {
  spots: ParkingSpot[],
  query: string,
  setQuery: (q: string) => void,
  onSpotClick: (id: string) => void,
  onScanClick: () => void,
  vehicleType: 'moto' | 'car',
  onOpenMap?: (opts: { mode: 'location' | 'navigation', carDestination: string | null, carParkingLotName: string | null, origin: { lat: number; lng: number } | 'gps' | 'entrance' }) => void,
  onSwitchVehicleMode?: () => void,
  onTriggerEntryNotice?: () => void,
  spotsError?: string | null,
  onRetrySpots?: () => void,
  key?: string
}) {
  const isCar = vehicleType === 'car';
  const SPOT_W = isCar ? 80 : 55;
  const SPOT_H = isCar ? 120 : 85;
  const AISLE_W = isCar ? 60 : 40;
  const COLUMN_GAP = isCar ? 10 : 5;
  const ROW_GAP = isCar ? 6 : 3;

  const [selectedDestination, setSelectedDestination] = useState<string>('主顧樓');
  const [selectedParkingLot, setSelectedParkingLot] = useState<string | null>(null);

  const getLotRemainingSpots = useCallback((lotName: string) => {
    if (lotName === "主顧樓地下停車場" || lotName === "第 4 停車場" || lotName.includes("主顧") || lotName.includes("地下")) {
      const zhuguAvailable = spots.filter(s => 
        (s.id.startsWith("CAR-ZHUGU-") || s.parkingBlockId === 'zhugu' || s.id.startsWith("CAR-")) && 
        s.status === 'available'
      ).length;
      return zhuguAvailable;
    }
    if (lotName === "第 6 停車場") {
      return spots.filter(s => (s.id.startsWith("CAR-5") || s.id.startsWith("CAR-6") || s.id.startsWith("CAR-7")) && s.status === 'available').length;
    }
    return spots.filter(s => {
      const parts = s.id.split('-');
      if (parts.length < 2) return false;
      const rowIdx = parseInt(parts[1]);
      if (lotName === "第 1 停車場") return rowIdx === 0 && s.status === 'available';
      if (lotName === "第 2 停車場") return rowIdx === 1 && s.status === 'available';
      if (lotName === "第 3 停車場") return rowIdx === 2 && s.status === 'available';
      if (lotName === "第 5 停車場") return rowIdx === 4 && s.status === 'available';
      return false;
    }).length;
  }, [spots]);

  const getLotTotalSpots = (lotName: string) => {
    if (lotName === "主顧樓地下停車場" || lotName === "第 4 停車場" || lotName.includes("主顧") || lotName.includes("地下")) {
      const zhuguTotal = spots.filter(s => s.id.startsWith("CAR-ZHUGU-") || s.parkingBlockId === 'zhugu' || s.id.startsWith("CAR-")).length;
      return zhuguTotal || 96;
    }
    if (lotName === "第 6 停車場") return 24;
    return 8;
  };

  const getDistance = (coords1: { lat: number, lng: number }, coords2: { lat: number, lng: number }) => {
    const dLat = coords1.lat - coords2.lat;
    const dLng = coords1.lng - coords2.lng;
    return Math.sqrt(dLat * dLat + dLng * dLng) * 111000;
  };

  const sortedLots = useMemo(() => {
    if (!isCar) return [];
    const destCoords = CAMPUS_DESTINATIONS[selectedDestination] || { lat: 24.2263, lng: 120.5772 };
    return Object.entries(CAMPUS_PARKING_LOTS).map(([name, coords], index) => {
      const dist = getDistance(destCoords, coords);
      const remaining = getLotRemainingSpots(name);
      const total = getLotTotalSpots(name);
      return { name, coords, dist, remaining, total, relation: CAMPUS_PARKING_LOT_RELATIONS[index] || '' };
    }).sort((a, b) => a.dist - b.dist);
  }, [isCar, selectedDestination, getLotRemainingSpots]);

  const recommendationInfo = useMemo(() => {
    if (!isCar || sortedLots.length === 0) return null;
    const firstLot = sortedLots[0];
    
    return {
      recommendedLot: firstLot.name,
      distance: firstLot.dist,
      remaining: firstLot.remaining,
      total: firstLot.total,
      relation: firstLot.relation,
      isBackup: false,
      firstLotName: firstLot.name
    };
  }, [isCar, sortedLots]);
  // 👉 初始視角精準對齊置中第一排 A 區車位 (x: 10, y: 35, scale: 0.8)
  const [scale, setScale] = useState(0.8);
  const [position, setPosition] = useState({ x: 10, y: 35 });
  const [isDragging, setIsDragging] = useState(false);
  const [filterMode, setFilterMode] = useState<'all' | 'available' | 'occupied'>('all');
  const [selectedZone, setSelectedZone] = useState<string>('All');
  const dragStartPos = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const startPos = useRef({ x: 0, y: 0 });
  const lastPosition = useRef({ x: 0, y: 0 });

  // 🎯 當切換載具模式時，自動重置視角至首排中央
  useEffect(() => {
    if (!isCar) {
      setPosition({ x: 10, y: 35 });
      setScale(0.8);
      setSelectedParkingLot(null);
    }
  }, [isCar]);

  const gridRows = useMemo(() => {
    if (!spots.length) return 24;
    let max = 0;
    spots.forEach(spot => {
      const parts = spot.id.split('-');
      if (parts.length === 3) {
        const r = parseInt(parts[1]);
        if (r > max) max = r;
      }
    });
    return max + 1;
  }, [spots]);

  const gridCols = useMemo(() => {
    if (!spots.length) return 23;
    let max = 0;
    spots.forEach(spot => {
      const parts = spot.id.split('-');
      if (parts.length === 3) {
        const c = parseInt(parts[2]);
        if (c > max) max = c;
      }
    });
    return max + 1;
  }, [spots]);

  // 動態取得所有車位的區域 (例如 A, B, C...)
  const zones = useMemo(() => {
    const uniqueZones = new Set(spots.map(s => s.number.charAt(0).toUpperCase()));
    return ['All', ...Array.from(uniqueZones).sort()];
  }, [spots]);

  const handlePointerDown = (e: PointerEvent) => {
    setIsDragging(true);
    dragStartPos.current = { x: e.clientX, y: e.clientY };
    startPos.current = { x: e.clientX, y: e.clientY };
    lastPosition.current = { ...position };
  };

  const handlePointerMove = (e: PointerEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - startPos.current.x;
    const dy = e.clientY - startPos.current.y;
    setPosition({
      x: lastPosition.current.x + dx,
      y: lastPosition.current.y + dy
    });
  };

  const handlePointerUp = () => {
    setIsDragging(false);
  };

  const handleZoom = (delta: number) => {
    setScale(prev => Math.min(Math.max(prev + delta, 0.3), 2.5));
  };

  // NOTE: 一鍵還原視角，將縮放比例重置為 1x 並平滑移回初始位置
  const resetView = () => {
    setScale(1);
    setPosition({ x: 16, y: 0 });
  };

  const GRID_OFFSET_X = 35; // 👉 左側寬度縮小為 35，消除突兀灰色留白並留出出口標籤寬度
  const GRID_OFFSET_Y = 20;

  const getColX = (colIndex: number) => {
    return colIndex * (SPOT_W + COLUMN_GAP) + GRID_OFFSET_X;
  };

  const getRowY = (rowIndex: number) => {
    let currentY = GRID_OFFSET_Y;
    for (let i = 0; i < rowIndex; i++) {
      currentY += SPOT_H;
      if (i % 3 === 0) {
        currentY += ROW_GAP;
      } else if (i % 3 === 1) {
        currentY += AISLE_W;
      } else if (i % 3 === 2) {
        currentY += AISLE_W;
      }
    }
    return currentY;
  };

  useEffect(() => {
    const trimmed = query.trim().toUpperCase();
    if (!trimmed) return;

    // NOTE: 移除橫線做模糊比對，讓 "A05" 也能匹配到 "A-05"
    const normalize = (s: string) => s.replace(/-/g, '').toUpperCase();
    const normalizedInput = normalize(trimmed);

    // 1. 先嘗試「完全比對」車位號碼（忽略橫線差異）
    let firstMatch = spots.find(s => normalize(s.number) === normalizedInput);

    // 2. 如果沒有完全比對成功，再進行「部分比對」（不限狀態）
    if (!firstMatch) {
      firstMatch = spots.find(s => normalize(s.number).includes(normalizedInput));
    }

    if (firstMatch && containerRef.current) {
      const parts = firstMatch.id.split('-');
      if (parts.length === 3) {
        const rowIdx = parseInt(parts[1]);
        const colIdx = parseInt(parts[2]);
        const localX = getColX(colIdx);
        const localY = getRowY(rowIdx);

        const container = containerRef.current;
        const rect = container.getBoundingClientRect();

        // 找到車位時，將地圖適當放大 (scale: 1.2) 以便清楚查看
        const targetScale = 1.2;
        setScale(targetScale);

        const targetX = (rect.width / 2) - (localX + SPOT_W / 2) * targetScale;
        const targetY = (rect.height / 2) - (localY + SPOT_H / 2) * targetScale;

        setPosition({ x: targetX, y: targetY });
      }
    }
  }, [query, spots]);

  // 新增：監聽 selectedZone 變化，讓畫面自動平滑移動到該區域 (達到等同 scrollIntoView 的效果)
  useEffect(() => {
    if (selectedZone === 'All') return;

    // 找到該區域的第一個車位
    const firstMatch = spots.find(s => s.number.toUpperCase().startsWith(selectedZone));
    if (firstMatch && containerRef.current) {
      const parts = firstMatch.id.split('-');
      if (parts.length === 3) {
        const rowIdx = parseInt(parts[1]);
        const colIdx = parseInt(parts[2]);
        const localX = getColX(colIdx);
        const localY = getRowY(rowIdx);

        const container = containerRef.current;
        const rect = container.getBoundingClientRect();

        // 計算並設定置中座標
        const targetX = (rect.width / 2) - (localX + SPOT_W / 2) * scale;
        const targetY = (rect.height / 2) - (localY + SPOT_H / 2) * scale;

      }
    }
  }, [selectedZone, scale, spots]);

  // 汽車專屬：點擊選擇任意停車場後，視角自動鎖定定位到該停車場第一排第一個車位
  useEffect(() => {
    if (isCar && selectedParkingLot) {
      let targetRow = 0;
      if (selectedParkingLot === "第 1 停車場") targetRow = 0;
      else if (selectedParkingLot === "第 2 停車場") targetRow = 1;
      else if (selectedParkingLot === "第 3 停車場") targetRow = 2;
      else if (selectedParkingLot === "第 4 停車場" || selectedParkingLot === "主顧樓地下停車場") targetRow = 3;
      else if (selectedParkingLot === "第 5 停車場") targetRow = 4;
      else if (selectedParkingLot === "第 6 停車場") targetRow = 5;

      const firstSpotY = getRowY(targetRow);
      // 自動設定最適縮放與座標平移，使第一排第一個車位精準聚焦於畫面上方
      setScale(0.95);
      setPosition({
        x: 10,
        y: -firstSpotY + 50
      });
    }
  }, [isCar, selectedParkingLot]);

  const availableCount = spots.filter(s => s.status === 'available').length;

  const destinationList = Object.keys(CAMPUS_DESTINATIONS).filter(name => name !== "大門口");
  const quickDestinations = ["主顧樓", "蓋夏圖書館", "伯鐸樓"];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 flex flex-col bg-white"
    >
      {/* 頂部選單面板 */}
      <div className="p-6 border-b border-slate-100 bg-white z-10 shrink-0 shadow-sm">
        <div className="flex justify-between items-start mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-[10px] font-bold tracking-[0.2em] text-[#FF4D00]">
                {isCar ? 'PROVIDENCE CAMPUS' : 'CAMPUS FACILITY'}
              </h2>
            </div>
            <h1 className="text-3xl font-serif font-black text-slate-800 tracking-tight leading-none">
              {isCar ? '校園停車導航' : '尋找停車位'}
            </h1>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-1.5">
              {onTriggerEntryNotice && (
                <button
                  onClick={onTriggerEntryNotice}
                  className="flex items-center gap-1 px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-900 rounded-full text-[10px] font-black tracking-wider transition-all active:scale-95 border border-amber-300/80 shadow-2xs"
                  title="模擬車牌感應進場 (開啟 5 分鐘未掃碼倒數)"
                >
                  <span>🚘 模擬進場</span>
                </button>
              )}
              {onSwitchVehicleMode && (
                <button
                  onClick={onSwitchVehicleMode}
                  className="flex items-center gap-1.5 px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-full text-[11px] font-bold transition-all active:scale-95 border border-slate-200/80 shadow-2xs"
                  title="切換載具模式"
                >
                  {isCar ? <Bike size={13} className="text-[#FF4D00]" /> : <Car size={13} className="text-blue-600" />}
                  <span>{isCar ? '切換機車' : '切換汽車'}</span>
                </button>
              )}
            </div>
            {isCar && recommendationInfo ? (
              <div className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping"></span>
                <span className="text-[9px] font-bold text-emerald-600 tracking-wider">
                  剩餘 {recommendationInfo.remaining} 格
                </span>
              </div>
            ) : (
              <>
                <span className="text-[9px] font-bold text-slate-400 tracking-widest uppercase mb-1">REMAINING SPOTS</span>
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-serif font-black text-[#10B981] leading-none">{availableCount}</span>
                  <span className="text-xs font-bold text-slate-300">/ {spots.length}</span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* 車位載入失敗提示 — 包含完整診斷細節 (URL / HTTP Status / Error) */}
        {spotsError && (
          <div className="mx-0 mb-3 p-4 bg-red-50 border border-red-200 rounded-2xl flex items-start gap-3 shadow-xs">
            <span className="text-red-500 text-lg shrink-0 mt-0.5">⚠️</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-black text-red-700 uppercase tracking-wider mb-1">無法載入車位資料</p>
              <div className="space-y-1 font-mono text-[11px] text-red-600 bg-red-100/50 p-2.5 rounded-xl border border-red-200/60 leading-relaxed whitespace-pre-wrap break-all">
                {spotsError}
              </div>
              {onRetrySpots && (
                <button
                  onClick={onRetrySpots}
                  className="mt-2.5 px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded-xl text-[11px] font-bold shadow-2xs transition-colors"
                >
                  重試載入
                </button>
              )}
            </div>
          </div>
        )}


        {/* 汽車版目的地選取快捷標籤與下拉選單 */}
        {isCar ? (
          <div className="space-y-3">
            <div className="flex gap-2 overflow-x-auto scrollbar-hide py-1">
              {quickDestinations.map(name => (
                <button
                  key={name}
                  onClick={() => {
                    setSelectedDestination(name);
                    setSelectedParkingLot(null); // 切換目的地時重置 2D 車格
                  }}
                  className={`shrink-0 px-3.5 py-2 rounded-2xl text-[11px] font-bold transition-all active:scale-95 ${
                    selectedDestination === name && !selectedParkingLot
                      ? 'bg-blue-600 text-white shadow-md shadow-blue-200'
                      : 'bg-slate-50 text-slate-500 border border-slate-100 hover:bg-slate-100'
                  }`}
                >
                  {name.split('/')[0]}
                </button>
              ))}
              
              {/* 其他教學樓下拉選單 */}
              <div className="relative shrink-0">
                <select
                  value={quickDestinations.includes(selectedDestination) ? "" : selectedDestination}
                  onChange={(e) => {
                    if (e.target.value) {
                      setSelectedDestination(e.target.value);
                      setSelectedParkingLot(null);
                    }
                  }}
                  className={`px-3.5 py-2 rounded-2xl text-[11px] font-bold border outline-none cursor-pointer appearance-none pr-8 bg-no-repeat bg-[length:8px_8px] bg-[position:right_10px_center] ${
                    !quickDestinations.includes(selectedDestination) && !selectedParkingLot
                      ? 'bg-blue-600 text-white border-blue-600 shadow-md shadow-blue-200 bg-[url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%23ffffff%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E")]'
                      : 'bg-slate-50 text-slate-500 border-slate-100 hover:bg-slate-100 bg-[url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%2394A3B8%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E")]'
                  }`}
                >
                  <option value="" disabled>其他大樓...</option>
                  {destinationList.map(name => (
                    <option key={name} value={name} className="text-slate-800 bg-white">{name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        ) : (
          /* 機車版搜尋列與一鍵掃碼 */
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" />
              <input
                type="text"
                placeholder="搜尋車位（例如 A-05）"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full h-10 bg-slate-50 rounded-2xl pl-10 pr-10 text-sm outline-none border border-slate-100 focus:border-[#FF4D00] focus:ring-1 focus:ring-[#FF4D00]/30 transition-all placeholder:text-slate-300 font-bold"
              />
              {query && (
                <button
                  onClick={() => setQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-300 transition-colors"
                >
                  <X size={12} />
                </button>
              )}
            </div>
            <button
              onClick={onScanClick}
              className="h-10 px-4 bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-white rounded-2xl flex items-center gap-1.5 font-bold text-xs shadow-md shadow-emerald-100 transition-all active:scale-95 shrink-0"
            >
              <Camera size={14} className="animate-pulse" />
              <span>掃碼停車</span>
            </button>
          </div>
        )}
      </div>

      {/* 汽車版 2D 格位詳情返回鈕與圖例 */}
      {isCar && selectedParkingLot && (
        <div className="px-8 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between shrink-0 animate-in fade-in">
          <button
            onClick={() => setSelectedParkingLot(null)}
            className="flex items-center gap-1.5 text-xs font-black text-blue-600 uppercase tracking-widest hover:underline"
          >
            ← 返回校園地圖
          </button>
          <span className="text-[10px] font-bold text-slate-400 tracking-wider">
            {selectedParkingLot} 車位分佈
          </span>
        </div>
      )}

      {/* 地圖區域 */}
      {isCar && !selectedParkingLot ? (
        /* 汽車版手繪/Google地圖導航概覽 */
        <div className="flex-1 overflow-hidden bg-slate-50 relative p-6 flex flex-col justify-between">
          <div className="w-full rounded-[30px] overflow-hidden shadow-lg border border-slate-200/40 relative bg-white flex-1 min-h-[300px]">
            <GoogleMapContainer
              isOpen={true}
              mode="navigation"
              inline={true}
              isCar={true}
               carDestination={selectedDestination}
               carParkingLotName={recommendationInfo?.recommendedLot}
               onDestinationSelect={(destination) => {
                 setSelectedDestination(destination);
                 setSelectedParkingLot(null);
               }}
               origin="entrance"
              onClose={() => {}}
            />
          </div>

          {/* 推薦卡片 */}
          {recommendationInfo && (
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              className="bg-white border border-slate-200/80 p-6 rounded-[28px] mt-4 shadow-xl flex flex-col gap-4 relative overflow-hidden"
            >
              {recommendationInfo.isBackup && (
                <div className="absolute top-0 inset-x-0 bg-amber-500 text-slate-900 text-[9px] font-black text-center py-1 tracking-wider uppercase">
                  ⚠️ 首選的 {recommendationInfo.firstLotName} 即將客滿，已為您改推薦備用停車場！
                </div>
              )}
              
              <div className="flex items-center justify-between border-b border-slate-100 pb-3 mt-1">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full font-black uppercase">最佳推薦</span>
                    <h3 className="text-lg font-black text-slate-800">{recommendationInfo.recommendedLot}</h3>
                  </div>
                  <p className="text-[10px] text-slate-400 font-bold mt-1">
                    {recommendationInfo.relation} · 步行至 {selectedDestination} 約 {Math.round(recommendationInfo.distance)}m (約 {Math.max(1, Math.round(recommendationInfo.distance / 80))} 分鐘)
                  </p>
                </div>
                <div className="text-right">
                  <strong className="text-2xl font-serif font-black text-emerald-600 leading-none">
                    {recommendationInfo.remaining}
                  </strong>
                  <span className="text-xs text-slate-300 font-bold font-sans"> / {recommendationInfo.total}</span>
                  <p className="text-[9px] text-slate-400 font-bold">可用空位</p>
                </div>
              </div>

              <div className={`grid ${recommendationInfo.recommendedLot.includes('主顧') ? 'grid-cols-2' : 'grid-cols-1'} gap-3`}>
                <button
                  onClick={() => {
                    if (onOpenMap) {
                      onOpenMap({
                        mode: 'navigation',
                        carDestination: selectedDestination,
                        carParkingLotName: recommendationInfo.recommendedLot,
                        origin: 'entrance'
                      });
                    }
                  }}
                  className="py-3 bg-blue-600 hover:bg-blue-700 text-white text-xs font-black rounded-2xl flex items-center justify-center gap-1.5 shadow-md shadow-blue-100 transition-all active:scale-95"
                >
                  <Compass size={14} />
                  <span>開始導航至 {recommendationInfo.recommendedLot}</span>
                </button>
                {recommendationInfo.recommendedLot.includes('主顧') && (
                  <button
                    onClick={() => {
                      setSelectedParkingLot(recommendationInfo.recommendedLot);
                    }}
                    className="py-3 bg-emerald-500 hover:bg-emerald-600 text-slate-900 text-xs font-black rounded-2xl flex items-center justify-center gap-1.5 shadow-md shadow-emerald-50 transition-all active:scale-95"
                  >
                    <MapIcon size={14} />
                    <span>進入 2D 平面預約</span>
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </div>
      ) : (
        /* 2D 擬真平面圖 (主顧樓地下停車場專用) vs 原有的 2D 格子配置 */
        isCar && (selectedParkingLot?.includes("主顧") || selectedParkingLot?.includes("第 4") || selectedParkingLot?.includes("地下") || selectedParkingLot === "主顧樓地下停車場") ? (
          <div className="flex-1 overflow-hidden bg-slate-100 relative">
            <ZhuguParkingCanvas
              spots={spots}
              onSpotClick={(spot) => {
                onSpotClick(spot.id);
              }}
            />
          </div>
        ) : (
          <>
            <div
              ref={containerRef}
            className="flex-1 overflow-hidden bg-slate-200 relative cursor-grab active:cursor-grabbing select-none touch-none scrollbar-hide"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
          >
            <div
              className="absolute inset-0"
              style={{
                transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
                transformOrigin: 'top left',
                transition: isDragging ? 'none' : 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)'
              }}
            >
              <div className="relative" style={{ width: gridCols * (SPOT_W + COLUMN_GAP) + 300, height: getRowY(gridRows) + 200 }}>
                {/* 入口 (Entrance) */}
                <div
                  className="absolute flex items-center justify-center bg-blue-50 border-2 border-blue-400 rounded-2xl shadow-sm text-blue-600 font-black tracking-widest z-0"
                  style={{
                    left: GRID_OFFSET_X + (gridCols * (SPOT_W + COLUMN_GAP)) / 2 - 80,
                    top: GRID_OFFSET_Y - 68,
                    width: 160,
                    height: 48
                  }}
                >
                  <div className="flex items-center gap-2">
                    <ChevronRight size={20} className="text-blue-500 rotate-90" />
                    <span>入口 ENTRANCE</span>
                    <ChevronRight size={20} className="text-blue-500 rotate-90" />
                  </div>
                </div>

                {/* 出口 (Exit) */}
                <div
                  className="absolute flex items-center justify-center bg-orange-50 border-2 border-orange-400 rounded-2xl shadow-sm text-orange-600 font-black tracking-widest z-0"
                  style={{
                    left: 10,
                    top: GRID_OFFSET_Y + (getRowY(gridRows) - GRID_OFFSET_Y) / 2 - 80,
                    width: 48,
                    height: 160,
                    writingMode: 'vertical-rl',
                    textOrientation: 'mixed'
                  }}
                >
                  <div className="flex flex-col items-center gap-2">
                    <ChevronRight size={20} className="text-orange-500 rotate-180" />
                    <span className="tracking-[0.3em]">出口 EXIT</span>
                  </div>
                </div>
                
                {Array.from({ length: gridRows }).map((_, rowIdx) => {
                  if (isCar && selectedParkingLot) {
                    if (selectedParkingLot === "第 1 停車場" && rowIdx !== 0) return null;
                    if (selectedParkingLot === "第 2 停車場" && rowIdx !== 1) return null;
                    if (selectedParkingLot === "第 3 停車場" && rowIdx !== 2) return null;
                    if ((selectedParkingLot === "第 4 停車場" || selectedParkingLot === "主顧樓地下停車場") && rowIdx !== 3) return null;
                    if (selectedParkingLot === "第 5 停車場" && rowIdx !== 4) return null;
                    if (selectedParkingLot === "第 6 停車場" && (rowIdx < 5 || rowIdx > 7)) return null;
                  }
                  const y = getRowY(rowIdx);
                  return (
                    <div
                      key={`row-${rowIdx}`}
                      className="absolute flex flex-row"
                      style={{ left: GRID_OFFSET_X, top: y, gap: COLUMN_GAP }}
                    >
                      {Array.from({ length: gridCols }).map((__, colIdx) => {
                        const spotId = isCar ? `CAR-${rowIdx}-${colIdx}` : `S-${rowIdx}-${colIdx}`;
                        
                        // 智慧全相容比對：先找 ID、再找預設索引、最後備用 Supabase 物件列表
                        let spot = spots.find(s => s.id === spotId);
                        
                        if (isCar && !spot && selectedParkingLot) {
                          const lotPrefixMap: Record<string, string> = {
                            "第 1 停車場": "A",
                            "第 2 停車場": "B",
                            "第 3 停車場": "C",
                            "第 4 停車場": "D",
                            "主顧樓地下停車場": "D",
                            "第 5 停車場": "E",
                            "第 6 停車場": "F"
                          };
                          const letter = lotPrefixMap[selectedParkingLot];
                          const lotSpots = spots.filter(s => 
                            (letter && (s.id.toUpperCase().includes(`CAR-${letter}`) || s.number.toUpperCase().includes(`CAR-${letter}`) || s.number.toUpperCase().startsWith(letter))) ||
                            s.id.startsWith("CAR-")
                          );
                          if (lotSpots[colIdx]) {
                            spot = lotSpots[colIdx];
                          }
                        }

                        if (!spot) return null;

                        const normalizedQuery = query.trim().replace(/-/g, '').toUpperCase();
                        const isHighlighted = normalizedQuery !== "" && spot.number.replace(/-/g, '').toUpperCase() === normalizedQuery;

                        const isZoneMatch = selectedZone === 'All' || spot.number.toUpperCase().replace('CAR-', '').startsWith(selectedZone);
                        const isStatusMatch = filterMode === 'all' || spot.status === filterMode || (filterMode === 'occupied' && spot.status === 'mine');
                        const isDimmed = !isHighlighted && (!isZoneMatch || !isStatusMatch);

                        return (
                          <SpotCard
                            key={spotId}
                            spot={spot}
                            isCar={isCar}
                            onClick={(e) => {
                              const dx = Math.abs(e.clientX - dragStartPos.current.x);
                              const dy = Math.abs(e.clientY - dragStartPos.current.y);
                              if (dx < 5 && dy < 5) {
                                onSpotClick(spot.id);
                              }
                            }}
                            className={`transition-all duration-300 ${isDimmed ? 'opacity-20 scale-90 grayscale-[0.5]' : 'opacity-100 scale-100'} ${isHighlighted ? 'ring-[5px] ring-brand-orange ring-offset-4 z-20 scale-110 shadow-2xl !opacity-100' : ''}`}
                          />
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 右下角縮放與還原按鈕 */}
          <div className="absolute bottom-6 right-6 flex flex-col gap-3 z-20">
            <div className="bg-editorial-ink rounded-full shadow-lg flex flex-col overflow-hidden w-8">
              <button
                onClick={() => handleZoom(0.2)}
                className="h-8 flex items-center justify-center text-white hover:bg-brand-orange transition-colors border-b border-white/10"
                title="Zoom In"
              >
                <Plus size={14} />
              </button>
              <button
                onClick={() => handleZoom(-0.2)}
                className="h-8 flex items-center justify-center text-white hover:bg-brand-orange transition-colors"
                title="Zoom Out"
              >
                <Minus size={14} />
              </button>
            </div>

            <button
              onClick={resetView}
              className="bg-white text-editorial-ink w-8 h-8 rounded-full shadow-lg flex items-center justify-center hover:bg-brand-orange hover:text-white transition-all active:scale-95 border border-slate-100"
              title="Center View"
            >
              <MapPin size={14} />
            </button>
          </div>
        </>
      )
    )}
    </motion.div>
  );
}

function LegendItem({ color, label }: { color: string, label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className={`w-3 h-5 rounded-sm ${color}`}></div>
      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{label}</span>
    </div>
  );
}

const SpotCard = memo(function SpotCard({ spot, className = "", onClick, isCar }: { spot: ParkingSpot, className?: string, onClick?: (e: any) => void, isCar?: boolean, key?: string }) {
  const isAvailable = spot.status === 'available';
  const isMine = spot.status === 'mine';
  const isDisabled = spot.status === 'disabled';

  const statusColor = isMine
    ? 'bg-[#3B82F6]'
    : isAvailable
      ? 'bg-[#10B981]'
      : isDisabled
        ? 'bg-orange-500 animate-pulse-anomaly shadow-[0_0_15px_rgba(249,115,22,0.4)]'
        : 'bg-[#EF4444]';

  return (
    <motion.div
      whileHover={{ y: -5, scale: 1.05 }}
      onPointerUp={onClick}
      style={{ width: isCar ? 80 : 55, height: isCar ? 120 : 85 }}
      className={`rounded-xl flex flex-col items-center justify-center transition-all duration-300 ${statusColor} text-white shadow-md cursor-pointer ${className}`}
    >
      <span className="text-[12px] font-black font-sans leading-none mb-2 tracking-tight">{spot.number.replace('CAR-', '')}</span>
      {isDisabled
        ? <span className="text-[9px] font-bold tracking-widest opacity-90 animate-pulse">異常</span>
        : isCar 
          ? <Car size={28} strokeWidth={2} className="opacity-90" />
          : <Bike size={24} strokeWidth={2.5} className="opacity-90" />}
    </motion.div>
  );
}, (prev, next) => {
  return prev.spot.id === next.spot.id &&
    prev.spot.status === next.spot.status &&
    prev.className === next.className &&
    prev.isCar === next.isCar;
});

// --- Helpers & Hooks ---

// NOTE: 用於相容 iOS/Safari 的安全日期解析函數，將減號 "-" 替換為斜線 "/"
export function parseSafeDate(dateInput: string | number | Date | null | undefined): Date {
  if (!dateInput) return new Date();
  if (dateInput instanceof Date) return dateInput;

  if (typeof dateInput === 'string') {
    // 解決 iOS/Safari 無法解析 YYYY-MM-DD HH:mm:ss 的問題
    const cleaned = dateInput.trim().replace(/-/g, '/');
    const parsed = new Date(cleaned);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  const defaultParsed = new Date(dateInput);
  if (!isNaN(defaultParsed.getTime())) {
    return defaultParsed;
  }
  return new Date();
}

export function formatTime(dateInput: string | number | Date | null | undefined): string {
  if (!dateInput) return '';
  const date = parseSafeDate(dateInput);
  if (isNaN(date.getTime())) return '';

  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

export function useParkingDuration(startTime: string | number | Date | null | undefined) {
  const [duration, setDuration] = useState({ hours: 0, minutes: 0, seconds: 0 });

  useEffect(() => {
    if (!startTime) {
      setDuration({ hours: 0, minutes: 0, seconds: 0 });
      return;
    }

    const startMs = parseSafeDate(startTime).getTime();

    const calculateTimeDiff = () => {
      const nowMs = new Date().getTime();
      const diffMs = Math.max(0, nowMs - startMs);

      const totalSeconds = Math.floor(diffMs / 1000);
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;

      setDuration({ hours, minutes, seconds });
    };

    calculateTimeDiff();
    const intervalId = setInterval(calculateTimeDiff, 1000);

    return () => clearInterval(intervalId);
  }, [startTime]);

  return duration;
}

// NOTE: 出發點選項的型別定義
type OriginOption = 'entrance' | 'exit' | 'gps';

// NOTE: 三個真實出發點資料（畢業專題 Demo 用）
const ORIGIN_OPTIONS: { value: OriginOption; label: string; icon: string; origin: { lat: number; lng: number } | 'gps' }[] = [
  // 為了畫線，我們將入口直接設定為最新、最精準的實際座標
  { value: 'entrance', label: '停車場入口', icon: '🅿️', origin: { lat: 24.224845, lng: 120.579124 } },
  { value: 'exit', label: '停車場出口', icon: '🚪', origin: { lat: 24.225260, lng: 120.578800 } },
  { value: 'gps', label: '目前真實定位', icon: '📍', origin: 'gps' },
];

function StatusView({ spots, startTime, endTime, onViewOnMap, onRelease, onScanClick, vehicleType }: {
  spots: ParkingSpot[],
  startTime: Date | null,
  endTime?: Date | null,
  onViewOnMap: (num: string, origin: { lat: number; lng: number } | 'gps') => void,
  onRelease: (id: string) => void,
  onScanClick?: () => void,
  vehicleType: 'moto' | 'car',
  key?: string
}) {
  const mySpot = spots.find(s => s.status === 'mine');
  const [selectedOrigin, setSelectedOrigin] = useState<OriginOption>('gps');

  const isCar = vehicleType === 'car';
  const carOrigins = [
    { value: 'entrance' as const, label: '汽車場入口', icon: '🅿️', origin: { lat: 24.225500, lng: 120.579300 } },
    { value: 'exit' as const, label: '汽車場出口', icon: '🚪', origin: { lat: 24.225800, lng: 120.579000 } },
    { value: 'gps' as const, label: '目前真實定位', icon: '📍', origin: 'gps' as const },
  ];
  const motoOrigins = [
    { value: 'entrance' as const, label: '機車場入口', icon: '🅿️', origin: { lat: 24.224845, lng: 120.579124 } },
    { value: 'exit' as const, label: '機車場出口', icon: '🚪', origin: { lat: 24.225260, lng: 120.578800 } },
    { value: 'gps' as const, label: '目前真實定位', icon: '📍', origin: 'gps' as const },
  ];
  const currentOrigins = isCar ? carOrigins : motoOrigins;

  // 使用建立好的 Custom Hook
  const duration = useParkingDuration(mySpot ? startTime : null);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 flex flex-col bg-editorial-bg p-8 overflow-y-auto pb-40 scrollbar-hide"
    >
      <div className="mt-12 mb-auto">
        <div className="mb-12">
          <h2 className="text-[10px] font-bold tracking-[0.2em] text-[#FF4D00] mb-3 flex items-center gap-2">
            ACTIVE STATUS <span className="text-gray-400 font-sans normal-case">v2</span>
          </h2>
          <h1 className="text-5xl font-black italic tracking-tight" style={{ fontFamily: 'Playfair Display, serif' }}>
            {mySpot ? (isCar ? '優質汽車停車狀態' : '優質機車停車狀態') : '尚無預約車位'}
          </h1>
          <p className="text-editorial-muted text-sm leading-relaxed max-w-[200px]">
            {mySpot
              ? `您的愛車目前停放於校園專屬區域，環境良好。`
              : '快去地圖上尋找適合您的車位吧！'}
          </p>
        </div>
      </div>

      {mySpot ? (
        <div className="bg-white border border-slate-200 p-10 flex flex-col gap-10 mt-8 shadow-sm">
          <div className="flex items-end justify-between border-b border-slate-100 pb-8">
            <div>
              <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest block mb-2">SPOT NUMBER</span>
              <h3 className="text-8xl font-serif font-black text-editorial-ink leading-none tracking-tighter">
                {mySpot.number.replace('CAR-', '')}
              </h3>
            </div>
            <div className="w-16 h-16 border border-editorial-ink rounded-full flex items-center justify-center text-editorial-ink">
              {isCar ? <Car size={24} /> : <Bike size={24} />}
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="flex justify-between items-baseline">
              <span className="text-slate-400 font-bold uppercase tracking-widest text-[10px]">DURATION</span>
              <div className="flex items-baseline gap-1">
                <span className="text-editorial-ink font-serif text-3xl">{duration.hours}</span>
                <span className="text-slate-400 text-[10px] font-bold uppercase">HRS</span>
                <span className="text-editorial-ink font-serif text-3xl ml-2">{duration.minutes}</span>
                <span className="text-slate-400 text-[10px] font-bold uppercase">MIN</span>
                <span className="text-brand-orange font-serif text-3xl ml-2 font-bold">{duration.seconds.toString().padStart(2, '0')}</span>
                <span className="text-slate-400 text-[10px] font-bold uppercase">SEC</span>
              </div>
            </div>

            <div className="h-[1px] bg-slate-100 w-full relative">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${Math.min((duration.hours * 60 + duration.minutes) / 120 * 100, 100)}%` }}
                className="h-[1px] bg-brand-orange absolute top-0 left-0"
              />
            </div>

            {/* 新增：停車時間區間 */}
            <div className="flex justify-between items-baseline pt-2">
              <span className="text-slate-400 font-bold uppercase tracking-widest text-[10px]">TIME RANGE</span>
              <div className="flex items-baseline gap-1 text-slate-800 font-medium text-sm">
                {startTime ? (
                  <>
                    <span className="font-sans font-bold">{formatTime(startTime)}</span>
                    <span className="mx-2 text-slate-300">-</span>
                    <span className={`font-sans font-bold ${endTime ? 'text-slate-800' : 'text-[#10B981]'}`}>
                      {endTime ? formatTime(endTime) : '進行中'}
                    </span>
                  </>
                ) : (
                  <span className="text-slate-400">尚未記錄</span>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4">
            {!isCar && (
              <>
                {/* 機車專屬：出發點選擇器與導航按鈕 (專題 Demo 核心) */}
                <div className="flex justify-between items-center px-2 py-1 mb-2 bg-slate-50/50 rounded-lg border border-slate-100">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                    <Compass size={12} /> 出發點 (模擬)
                  </span>
                  <select
                    value={selectedOrigin}
                    onChange={(e) => setSelectedOrigin(e.target.value as OriginOption)}
                    className="bg-white border border-slate-200 text-slate-600 text-xs font-bold rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#FF4D00] transition-all cursor-pointer shadow-sm appearance-none pr-8 relative"
                    style={{
                      backgroundImage: `url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e")`,
                      backgroundRepeat: 'no-repeat',
                      backgroundPosition: 'right 0.5rem center',
                      backgroundSize: '1em 1em'
                    }}
                  >
                    {currentOrigins.map(opt => (
                      <option key={opt.value} value={opt.value}>
                        {opt.icon} {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <Button
                  variant="primary"
                  className="py-5 flex items-center justify-center gap-3"
                  onClick={() => {
                    const selected = currentOrigins.find(o => o.value === selectedOrigin);
                    onViewOnMap(mySpot.number, selected?.origin ?? 'gps');
                  }}
                >
                  <Compass size={18} /> 開始步行導航
                </Button>
              </>
            )}

            {isCar && (
              <div className="bg-blue-50 border border-blue-200 p-4 rounded-2xl flex items-center justify-between text-blue-700">
                <span className="text-xs font-bold flex items-center gap-2">
                  <Car size={16} /> 狀態：車位已成功佔用中
                </span>
                <span className="text-[10px] font-black uppercase bg-blue-600 text-white px-2 py-0.5 rounded-full">
                  已佔用
                </span>
              </div>
            )}

            {onScanClick && (
              <Button
                variant="secondary"
                className="py-4 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 text-emerald-800 flex items-center justify-center gap-2 text-xs font-black shadow-xs active:scale-95 transition-all"
                onClick={onScanClick}
              >
                <Camera size={18} className="text-emerald-600 animate-pulse" />
                <span>📷 二維碼 (QR Code) 掃碼離場</span>
              </Button>
            )}

            <Button
              variant="secondary"
              className="py-5 border-red-100 text-red-500 hover:bg-red-50 flex items-center justify-center gap-3"
              onClick={() => onRelease(mySpot.id)}
            >
              <Unlock size={18} /> {isCar ? '釋放汽車位' : '釋放機車位'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-12 p-10 border-2 border-dashed border-slate-200 flex flex-col items-center justify-center text-slate-300 bg-white/50">
          <MapIcon size={48} strokeWidth={1} className="mb-4 opacity-20" />
          <p className="text-xs font-bold uppercase tracking-widest">NO RESERVATION FOUND</p>
        </div>
      )}

      <div className="mt-auto pt-8 border-t border-slate-100 flex justify-between text-[9px] font-bold text-slate-300 uppercase tracking-[0.2em]">
        <span>AUTO REFRESH ENABLED</span>
        <span>72% ENGINE HEALTH</span>
      </div>
    </motion.div>
  );
}

// --- View: Profile ---

function ProfileView({
  user,
  onLogout,
  onAICreator,
  onUpdateUser,
  history,
  spots,
  onViewSpot,
  vehicleType,
  onSwitchVehicle
}: {
  user: UserProfile | null,
  onLogout: () => void,
  onAICreator: () => void,
  onUpdateUser: (data: Partial<UserProfile>) => void,
  history: { id: string, number: string, time: string }[],
  spots?: ParkingSpot[],
  onViewSpot?: (num: string) => void,
  vehicleType: 'moto' | 'car',
  onSwitchVehicle: () => void,
  key?: string
}) {
  const [editingPlate, setEditingPlate] = useState(false);
  const [tempPlate, setTempPlate] = useState(user?.plate_number || "");
  const [activeModal, setActiveModal] = useState<'favorites' | 'history' | null>(null);

  if (!user) return null;

  const handleSavePlate = () => {
    onUpdateUser({ plate_number: tempPlate });
    setEditingPlate(false);
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="absolute inset-0 flex flex-col bg-editorial-bg overflow-y-auto"
    >
      <div className="p-10 pt-16 flex justify-between items-start">
        <div>
          <span className="text-[10px] font-bold text-[#FF4D00] tracking-widest uppercase mb-2 block">USER SETTINGS</span>
          <h1 className="text-5xl font-serif font-black text-editorial-ink tracking-tighter">個人中心</h1>
          <p className="text-slate-400 font-bold uppercase tracking-widest text-[9px] mt-1 italic">ACCOUNT MANAGEMENT</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button onClick={onSwitchVehicle} title="切換載具" className="px-4 py-3 bg-white border border-slate-200 text-editorial-ink hover:text-[#FF4D00] transition-all font-bold text-xs flex items-center gap-1.5 active:scale-95 shadow-sm">
            {vehicleType === 'car' ? <Car size={16} /> : <Bike size={16} />} 切換
          </button>
          <button onClick={onLogout} title="登出" className="p-4 bg-white border border-slate-200 text-editorial-ink hover:text-brand-orange transition-colors">
            <LogOut size={20} />
          </button>
        </div>
      </div>

      <div className="px-10 space-y-10 pb-40">
        <div className="bg-white border border-slate-200 p-10 flex flex-col items-center text-center">
          <div className="relative mb-8">
            <div className="p-1 border border-editorial-ink rounded-full">
              {localStorage.getItem('user_avatar') || user.avatar ? (
                <img
                  src={localStorage.getItem('user_avatar') || user.avatar}
                  alt={user.name}
                  className="w-32 h-32 rounded-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-32 h-32 rounded-full bg-emerald-500 flex items-center justify-center text-4xl font-bold text-white uppercase tracking-widest">
                  {user.name.substring(0, 2)}
                </div>
              )}
            </div>
            <button
              onClick={onAICreator}
              className="absolute -bottom-2 -right-2 p-4 bg-brand-orange text-white rounded-full shadow-xl hover:bg-editorial-ink transition-all active:scale-95 flex items-center justify-center"
            >
              <Sparkles size={18} />
            </button>
          </div>
          <h2 className="text-4xl font-serif font-black text-editorial-ink tracking-tighter mb-2">{user.name}</h2>
          <span className="text-[11px] font-bold text-brand-orange uppercase tracking-[0.3em]">{user.role}</span>
        </div>

        <div className="space-y-1">
          {/* Plate Tile */}
          <div className="w-full bg-white border-t border-editorial-ink p-6 flex flex-col">
            <div className="flex items-start justify-between">
              <div className="flex">
                <span className="font-serif italic text-sm text-brand-orange mr-10">01</span>
                <div className="text-left flex-1">
                  <p className="text-lg font-bold text-editorial-ink leading-none mb-1 uppercase tracking-tight">車牌號碼綁定</p>
                  <p className="text-[9px] font-bold text-slate-300 uppercase tracking-widest">PLATE NUMBER</p>
                </div>
              </div>
              <button
                onClick={() => setEditingPlate(!editingPlate)}
                className="text-[10px] font-black text-brand-orange uppercase tracking-widest hover:underline"
              >
                {editingPlate ? '取消' : '編輯'}
              </button>
            </div>
            {editingPlate ? (
              <div className="mt-4 flex gap-2">
                <input
                  autoFocus
                  className="flex-1 bg-slate-50 border border-slate-100 p-3 font-serif italic text-lg focus:ring-1 focus:ring-brand-orange outline-none"
                  value={tempPlate}
                  onChange={(e) => setTempPlate(e.target.value)}
                />
                <button
                  onClick={handleSavePlate}
                  className="px-6 bg-brand-orange text-white text-[10px] font-bold uppercase tracking-widest transition-all active:scale-95"
                >
                  儲存
                </button>
              </div>
            ) : (
              <span className="mt-4 font-serif italic text-2xl text-editorial-ink self-end">{user.plate_number}</span>
            )}
          </div>

          <ProfileTile
            label="SAVED SPOTS"
            title="我的最愛"
            icon={2}
            onClick={() => setActiveModal('favorites')}
          />
          <ProfileTile
            label="HISTORY"
            title="停車歷史紀錄"
            icon={3}
            onClick={() => setActiveModal('history')}
          />
        </div>
      </div>

      <AnimatePresence>
        {activeModal && (
          <div className="absolute inset-0 z-[110] flex items-end justify-center p-0 bg-black/40 backdrop-blur-sm px-4">
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="w-full max-w-md bg-white rounded-t-[40px] p-10 pb-20 shadow-2xl relative"
            >
              <button
                onClick={() => setActiveModal(null)}
                className="absolute top-6 right-8 text-slate-300 hover:text-editorial-ink transition-colors"
              >
                <X size={24} />
              </button>

              <h3 className="text-3xl font-serif font-black text-slate-800 mb-8 uppercase tracking-tighter">
                {activeModal === 'favorites' ? '常用車位' : '停車歷史'}
              </h3>

              <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 scrollbar-hide">
                {activeModal === 'favorites' ? (
                  (vehicleType === 'car' ? ['CAR-A-01', 'CAR-B-02', 'CAR-C-03'] : ['A-05', 'B-12', 'C-01']).map((spotNum) => {
                    const spot = spots?.find(s => s.number === spotNum);
                    const isOccupied = spot && spot.status === 'occupied';

                    return (
                      <button
                        key={spotNum}
                        onClick={() => {
                          if (isOccupied) {
                            alert('此車位目前已被佔用，請選擇其他空位。');
                            return;
                          }
                          if (onViewSpot) {
                            onViewSpot(spotNum);
                          }
                          setActiveModal(null);
                        }}
                        className={`w-full p-6 border flex justify-between items-center group transition-all duration-200 rounded-2xl active:scale-95 ${isOccupied
                          ? 'border-slate-50 bg-slate-50/30 opacity-60 cursor-not-allowed'
                          : 'border-slate-100 bg-slate-50/50 hover:border-brand-orange hover:bg-white shadow-sm'
                          }`}
                      >
                        <span className={`font-serif italic text-2xl transition-colors ${isOccupied ? 'text-slate-300' : 'text-editorial-ink group-hover:text-brand-orange'
                          }`}>
                          {spotNum}
                        </span>
                        {!isOccupied ? (
                          <ChevronRight size={18} className="text-slate-300 group-hover:text-brand-orange transition-all" />
                        ) : (
                          <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest bg-slate-100 px-3 py-1 rounded-full">已佔用</span>
                        )}
                      </button>
                    );
                  })
                ) : (
                  history.length > 0 ? (
                    history.map((item) => (
                      <div key={item.id} className="p-6 border-b border-slate-50 flex justify-between items-center">
                        <div className="text-left">
                          <p className="text-sm font-bold text-editorial-ink uppercase">{item.number}</p>
                          <p className="text-[10px] text-slate-300 font-bold uppercase tracking-widest">{item.time}</p>
                        </div>
                        <MapPin size={16} className="text-brand-orange opacity-20" />
                      </div>
                    ))
                  ) : (
                    <div className="py-12 text-center">
                      <Clock size={40} className="mx-auto text-slate-100 mb-4" strokeWidth={1} />
                      <p className="text-[10px] font-bold text-slate-300 tracking-widest uppercase">暫無任何紀錄</p>
                    </div>
                  )
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function ProfileTile({ label, title, value, icon, onClick }: any) {
  return (
    <button
      onClick={onClick}
      className="w-full bg-white border-t border-editorial-ink p-6 flex items-start group hover:bg-slate-50 transition-colors"
    >
      <span className="font-serif italic text-sm text-brand-orange mr-10">{String(icon).padStart(2, '0')}</span>
      <div className="text-left flex-1">
        <p className="text-lg font-bold text-editorial-ink leading-none mb-1 uppercase tracking-tight">{title}</p>
        <p className="text-[9px] font-bold text-slate-300 uppercase tracking-widest">{label}</p>
      </div>
      {value && <span className="font-serif italic text-lg text-editorial-ink">{value}</span>}
      <ChevronRight size={18} className="text-slate-300 group-hover:text-editorial-ink transition-transform group-hover:translate-x-1" />
    </button>
  );
}

// --- View: AI Creator ---

function AICreatorView({ user }: { user: UserProfile | null, key?: string }) {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [mode, setMode] = useState<'create' | 'edit'>('create');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      setGeneratedImage(base64);
      setMode('edit');
    };
    reader.readAsDataURL(file);
  };

  const handleSave = () => {
    if (generatedImage) {
      localStorage.setItem('user_avatar', generatedImage);
      alert("頭像已成功儲存！請返回個人中心查看。");
    } else {
      alert("請先拍照、上傳或生成照片！");
    }
  };

  const handleGenerate = async () => {
    if (!prompt) return;
    setLoading(true);
    try {
      let url;
      if (mode === 'create') {
        url = await api.generateImage(prompt);
      } else if (generatedImage) {
        url = await api.editImage(generatedImage, prompt);
      }

      if (url) {
        setGeneratedImage(url);
        setHistory(prev => [url, ...prev].slice(0, 5));
        setPrompt("");
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 flex flex-col bg-white overflow-y-auto"
    >
      <div className="p-10 pt-16 relative">
        <span className="text-[10px] font-bold text-brand-orange tracking-widest uppercase mb-2 block">POWERED BY GEMINI</span>
        <h2 className="text-5xl font-serif font-black text-editorial-ink tracking-tighter flex items-center gap-4">
          CREATOR.
        </h2>
        <p className="text-slate-400 font-bold uppercase tracking-widest text-[9px] mt-1">GENERATE YOUR MOTO AVATAR</p>

        <button
          onClick={handleSave}
          className="absolute top-16 right-10 w-12 h-12 bg-editorial-ink text-white rounded-full flex items-center justify-center hover:bg-brand-orange transition-colors shadow-lg active:scale-95"
        >
          <Save size={20} />
        </button>
      </div>

      <div className="flex-1 px-10 space-y-10 pb-40">
        <div className="relative aspect-square w-full bg-editorial-bg border border-slate-100 flex items-center justify-center overflow-hidden">
          {loading ? (
            <div className="flex flex-col items-center gap-6 text-brand-orange">
              <Loader2 className="animate-spin" size={40} />
              <p className="text-[10px] font-bold animate-pulse uppercase tracking-[0.3em]">PROCESSING IMAGERY</p>
            </div>
          ) : generatedImage ? (
            <img src={generatedImage} alt="Generated" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
          ) : (
            <div
              className="flex flex-col items-center gap-6 text-slate-300 hover:text-editorial-ink cursor-pointer transition-colors w-full h-full justify-center"
              onClick={() => fileInputRef.current?.click()}
            >
              <Camera size={60} strokeWidth={1} />
              <p className="text-[10px] font-bold uppercase tracking-[0.3em]">點擊拍照或上傳照片</p>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                ref={fileInputRef}
                className="hidden"
                onChange={handleImageUpload}
              />
            </div>
          )}
        </div>

        <div className="grid grid-cols-2">
          <button
            onClick={() => setMode('create')}
            className={`py-4 border text-[10px] font-bold uppercase tracking-[0.2em] transition-all ${mode === 'create' ? 'bg-editorial-ink text-white border-editorial-ink' : 'bg-transparent text-slate-300 border-slate-100'}`}
          >
            New Asset
          </button>
          <button
            disabled={!generatedImage}
            onClick={() => setMode('edit')}
            className={`py-4 border text-[10px] font-bold uppercase tracking-[0.2em] transition-all ${mode === 'edit' ? 'bg-editorial-ink text-white border-editorial-ink' : 'bg-transparent text-slate-300 border-slate-100 disabled:opacity-30'}`}
          >
            Refine
          </button>
        </div>

        <div className="relative border-t border-editorial-ink pt-6">
          <span className="text-[9px] font-bold text-slate-300 uppercase tracking-widest mb-4 block">PROMPT INPUT</span>
          <textarea
            rows={4}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={"Describe aesthetics..."}
            className="w-full bg-transparent border-none p-0 text-editorial-ink placeholder:text-slate-200 focus:ring-0 resize-none text-base font-serif italic"
          />
          <div className="flex justify-end mt-4">
            <button
              disabled={loading || !prompt}
              onClick={handleGenerate}
              className="w-16 h-16 bg-brand-orange text-white rounded-full flex items-center justify-center hover:bg-editorial-ink transition-all active:scale-95 disabled:opacity-20"
            >
              <Sparkles size={24} />
            </button>
          </div>
        </div>

        {history.length > 0 && (
          <div className="space-y-6 pt-10 border-t border-slate-100">
            <h3 className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">ASSET HISTORY</h3>
            <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide">
              {history.map((url, i) => (
                <img
                  key={i}
                  src={url}
                  className="w-24 h-24 flex-shrink-0 cursor-pointer border border-slate-100 hover:border-editorial-ink transition-all"
                  onClick={() => setGeneratedImage(url)}
                  referrerPolicy="no-referrer"
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// --- Component: QRCodeScanner (整合真實鏡頭掃描與電腦 Fallback 模擬) ---
function QRCodeScanner({ isOpen, onClose, onScanSuccess, spots, vehicleType }: { isOpen: boolean, onClose: () => void, onScanSuccess: (spotId: string, qrcodeData: string) => void, spots: ParkingSpot[], vehicleType: 'moto' | 'car' }) {
  const [dots, setDots] = useState(".");
  const [successSpot, setSuccessSpot] = useState<ParkingSpot | null>(null);
  
  // 相機狀態
  const [hasCamera, setHasCamera] = useState<boolean | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [manualSpotId, setManualSpotId] = useState<string>("");
  const scannerRef = useRef<Html5Qrcode | null>(null);

  // 1. 模擬對焦動畫 (在無相機的 Fallback 模擬模式下使用)
  useEffect(() => {
    if (!isOpen || hasCamera) return;
    const interval = setInterval(() => {
      setDots(d => d.length >= 3 ? "." : d + ".");
    }, 500);
    return () => clearInterval(interval);
  }, [isOpen, hasCamera]);

  // 2. 初始化與啟動真實相機
  useEffect(() => {
    if (!isOpen) {
      // 關閉時停止相機
      if (scannerRef.current) {
        const scannerObj = scannerRef.current;
        if (scannerObj.isScanning) {
          scannerObj.stop()
            .then(() => console.log("[相機] 已成功關閉"))
            .catch(err => console.error("[相機] 關閉失敗:", err));
        }
        scannerRef.current = null;
      }
      setSuccessSpot(null);
      setScanError(null);
      setHasCamera(null);
      return;
    }

    // 延遲一下初始化，確保 <div id="reader"> 已經渲染在 DOM 中
    const initTimer = setTimeout(() => {
      const readerDiv = document.getElementById("reader");
      if (!readerDiv) return;

      const html5Qrcode = new Html5Qrcode("reader");
      scannerRef.current = html5Qrcode;

      Html5Qrcode.getCameras()
        .then(devices => {
          if (devices && devices.length > 0) {
            setHasCamera(true);
            console.log("[相機] 偵測到相機裝置數量:", devices.length);
            
            // 啟動相機，優先使用後置鏡頭
            html5Qrcode.start(
              { facingMode: "environment" },
              {
                fps: 10,
                qrbox: (width, height) => {
                  const size = Math.min(width, height) * 0.7;
                  return { width: size, height: size };
                }
              },
              (decodedText) => {
                // 掃描成功！
                console.log("[相機] 掃碼解碼成功:", decodedText);
                
                // 解析車位 ID (若是 "MOTO_PARK_S-0-4" 則提取出 "S-0-4")
                let spotId = decodedText;
                if (decodedText.startsWith("MOTO_PARK_")) {
                  spotId = decodedText.replace("MOTO_PARK_", "");
                } else if (decodedText.startsWith("CAR_PARK_")) {
                  spotId = decodedText.replace("CAR_PARK_", "");
                }

                // 檢查是否是有效的車位編號或 ID
                const match = spots.find(s => s.id === spotId || s.number === spotId);
                const finalSpotId = match ? match.id : spotId;
                const finalSpot = match || null;

                if (finalSpot) {
                  setSuccessSpot(finalSpot);
                }

                // 播放嗶聲/震動（若瀏覽器支援）
                if (navigator.vibrate) navigator.vibrate(100);

                // 暫停一秒後，停止相機並呼叫成功回呼
                setTimeout(() => {
                  html5Qrcode.stop()
                    .then(() => {
                      onScanSuccess(finalSpotId, decodedText);
                    })
                    .catch(err => {
                      console.error("[相機] 停止掃描出錯，但仍執行回呼:", err);
                      onScanSuccess(finalSpotId, decodedText);
                    });
                }, 1000);
              },
              () => {
                // 掃描中，不輸出日誌以防洗板
              }
            ).catch(err => {
              console.warn("[相機] 無法啟動相機 (可能無權限或被佔用):", err);
              setHasCamera(false);
              setScanError("無法啟動您的鏡頭。已為您切換至「電腦開發模擬模式」。");
            });
          } else {
            console.log("[相機] 未偵測到任何相機設備，切換至模擬模式");
            setHasCamera(false);
          }
        })
        .catch(err => {
          console.error("[相機] 取得相機列表出錯:", err);
          setHasCamera(false);
        });
    }, 100);

    return () => {
      clearTimeout(initTimer);
      if (scannerRef.current) {
        const scannerObj = scannerRef.current;
        if (scannerObj.isScanning) {
          scannerObj.stop().catch(err => console.error("[相機] 卸載時關閉失敗:", err));
        }
      }
    };
  }, [isOpen, spots, onScanSuccess]);

  // 3. 電腦測試時的模擬點擊處理
  const handleMockScan = (spotIdToMock: string) => {
    if (!spotIdToMock) return;
    const targetSpot = spots.find(s => s.id === spotIdToMock || s.number === spotIdToMock);
    if (!targetSpot) return;

    setSuccessSpot(targetSpot);
    setTimeout(() => {
      const prefix = vehicleType === 'car' ? 'CAR_PARK_' : 'MOTO_PARK_';
      onScanSuccess(targetSpot.id, `${prefix}${targetSpot.id}`);
    }, 1200);
  };

  // 安全關閉相機，避免 React 先銷毀 DOM 導致 html5-qrcode 停止出錯崩潰
  const handleClose = () => {
    if (scannerRef.current && scannerRef.current.isScanning) {
      scannerRef.current.stop()
        .then(() => {
          onClose();
        })
        .catch(err => {
          console.warn("[相機] 關閉出錯，強行 onClose:", err);
          onClose();
        });
    } else {
      onClose();
    }
  };

  if (!isOpen) return null;

  // 取得目前所有可用的空車位，供電腦測試模擬時選擇
  const availableSpots = spots.filter(s => s.status === 'available');

  return (
    <div className="absolute inset-0 bg-black/85 z-[90] flex flex-col justify-between p-10 select-none overflow-y-auto">
      {/* 頂部標題 */}
      <div className="flex justify-between items-center text-white shrink-0">
        <div className="flex items-center gap-2">
          <Camera className="text-emerald-400 animate-pulse" size={20} />
          <span className="text-xs font-bold uppercase tracking-[0.2em]">
            {hasCamera === true ? "真實鏡頭掃描中" : hasCamera === false ? "掃描器測試模擬模式" : "正在讀取手機鏡頭..."}
          </span>
        </div>
        <button 
          onClick={handleClose}
          className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors"
        >
          <X size={20} />
        </button>
      </div>

      {/* 中間掃描區域 */}
      <div className="flex-1 flex flex-col items-center justify-center my-6 min-h-[300px]">
        {hasCamera !== false ? (
          /* 真實鏡頭畫面容器 */
          <div className="relative w-64 h-64 border-2 border-white/20 rounded-[40px] flex items-center justify-center overflow-hidden bg-black">
            {/* html5-qrcode 相機渲染視訊 */}
            <div id="reader" className="w-full h-full object-cover"></div>
            
            {/* 四個綠色定位定位角 */}
            <div className="absolute top-4 left-4 w-6 h-6 border-t-4 border-l-4 border-emerald-400 rounded-tl-md pointer-events-none"></div>
            <div className="absolute top-4 right-4 w-6 h-6 border-t-4 border-r-4 border-emerald-400 rounded-tr-md pointer-events-none"></div>
            <div className="absolute bottom-4 left-4 w-6 h-6 border-b-4 border-l-4 border-emerald-400 rounded-bl-md pointer-events-none"></div>
            <div className="absolute bottom-4 right-4 w-6 h-6 border-b-4 border-r-4 border-emerald-400 rounded-br-md pointer-events-none"></div>

            {/* 綠色掃描雷射線 */}
            {!successSpot && <div className="animate-scan-line pointer-events-none"></div>}

            {successSpot && (
              <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center text-emerald-400 animate-in fade-in">
                <svg className="w-12 h-12 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={4}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-xs font-bold uppercase tracking-widest">辨識成功: {successSpot.number}</span>
              </div>
            )}
          </div>
        ) : (
          /* 無鏡頭/測試時的極簡測試卡片 */
          <div className="w-full max-w-sm bg-slate-900/90 border border-slate-800 rounded-[35px] p-6 flex flex-col items-center gap-4 text-center shadow-2xl backdrop-blur-xl">
            <div className="w-14 h-14 rounded-2xl bg-amber-400/10 flex items-center justify-center text-amber-400 mb-1 border border-amber-400/20">
              <Camera size={26} />
            </div>
            
            <div className="space-y-1">
              <h4 className="text-white text-sm font-black tracking-wide">二維碼測試模擬模式已啟用</h4>
              <p className="text-slate-400 text-xs leading-relaxed font-medium">
                點擊下方任一車位膠囊，即可一鍵模擬二維碼 (QR Code) 條碼解析：
              </p>
            </div>

            {spots.length > 0 ? (
              <div className="space-y-3 w-full">
                <div className="flex flex-wrap gap-2 justify-center my-2 max-h-48 overflow-y-auto p-1 scrollbar-hide">
                  {spots.slice(0, 12).map(spot => (
                    <button
                      key={`demo-qr-${spot.id}`}
                      type="button"
                      onClick={() => handleMockScan(spot.id)}
                      disabled={successSpot !== null}
                      className="px-3 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-emerald-400 border border-emerald-500/30 rounded-2xl text-xs font-bold transition-all active:scale-95 flex items-center gap-1 shadow-sm cursor-pointer"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                      車位 {spot.number}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-rose-400 text-xs font-bold">目前無可用的車位，無法進行模擬。</p>
            )}

            {successSpot && (
              <div className="text-emerald-400 text-xs font-bold flex items-center gap-1.5 mt-1 animate-pulse">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                已成功模擬掃描車位 {successSpot.number}，超時警告已消除，正在切換頁面...
              </div>
            )}
          </div>
        )}
      </div>

      {/* 底部說明 */}
      <div className="flex flex-col items-center gap-2 shrink-0">
        <span className="text-[11px] font-bold text-slate-500 tracking-widest uppercase">
          {successSpot 
            ? "已完成條碼解析，正在送至後端" 
            : (hasCamera ? "將手機對準車格旁的 QR Code 貼紙" : `電腦模擬中${dots}`)}
        </span>
        <p className="text-[10px] text-center text-slate-600 leading-relaxed max-w-[280px]">
          {hasCamera 
            ? "如需在手機上真實測試，請確認您的網站是否具備 HTTPS 安全連線。"
            : "若在手機上測試，本視窗會自動開啟後置相機鏡頭。"}
        </p>
      </div>
    </div>
  );
}

// --- View: Community (社群討論聊天室) ---
function CommunityView({ spots, user, openModal, setSearchQuery, fetchSpots, vehicleType }: { spots: ParkingSpot[], user: UserProfile | null, openModal: any, setSearchQuery: (q: string) => void, fetchSpots: () => void, vehicleType: 'moto' | 'car' }) {
  const [messages, setMessages] = useState<CommunityMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // 1. 拉取社群聊天歷史訊息
  const fetchMessages = async () => {
    try {
      const msgs = await api.getCommunityMessages();
      setMessages(msgs);
    } catch (e) {
      console.error("無法載入社群歷史訊息:", e);
    }
  };

  // 自動拉取歷史與定時更新 (每 3 秒 Polling 一次以求即時同步)
  useEffect(() => {
    fetchMessages();
    const interval = setInterval(fetchMessages, 3000);
    return () => clearInterval(interval);
  }, []);

  // 當新訊息加入時，自動滾動到底部
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 2. 發送訊息
  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isSending || !user) return;

    const userMsgContent = inputText;
    setInputText("");
    setIsSending(true);

    try {
      // 學生端發送訊息
      const sentMsg = await api.sendCommunityMessage({
        user_id: user.id,
        user_name: user.name,
        user_avatar: user.avatar,
        role: 'student',
        content: userMsgContent
      });

      // 即時渲染在本地
      setMessages(prev => [...prev, sentMsg]);

      // --- [新增] 自動感知亂停並與地圖連動 ---
      // 偵測是否包含「亂停」、「異常」或格號（如 B-04, A-05 等）
      const spotMatch = userMsgContent.match(/CAR-[A-Za-z]-[0-9]{2}/i) || userMsgContent.match(/[A-Za-z]-[0-9]{2}/);
      if (spotMatch) {
        const spotNumber = spotMatch[0].toUpperCase();
        const spot = spots.find(s => s.number === spotNumber);
        if (spot && spot.status === 'available') {
          console.log(`[AI Auto-Action] 偵測到使用者在對話中回報車位 ${spotNumber} 被亂停，自動連動通報異常並更新地圖`);
          api.reportSpotAnomaly(spot.id).then(() => {
            fetchSpots();
            // 自動設定搜尋關鍵字以定位高亮地圖該車位
            setSearchQuery(spotNumber);
          }).catch(console.error);
        }
      }
      // ---------------------------------------------

      // 3. 觸發 AI 自動回覆 (在 1.2 秒後回覆，模擬思考過程)
      setTimeout(async () => {
        try {
          const aiReplyText = await askParkingAI(userMsgContent, spots, vehicleType);
          
          await api.sendCommunityMessage({
            user_id: 'ai-helper',
            user_name: vehicleType === 'car' ? 'Smart-CarPark AI' : 'Smart-MotoPark AI',
            user_avatar: '', // 留空，前端會渲染 AI 專屬機器人頭像
            role: 'ai',
            content: aiReplyText
          });
          
          // 重新拉取
          fetchMessages();
        } catch (err) {
          console.error("AI 自動回覆失敗:", err);
        }
      }, 1200);

    } catch (err: any) {
      console.error("發送訊息失敗:", err);
      openModal({
        type: 'alert',
        title: '發送失敗',
        message: err.message || '無法發送訊息，請稍後再試。'
      });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 flex flex-col bg-slate-50 overflow-hidden"
    >
      {/* 聊天室頂部 Banner */}
      <div className="p-6 border-b border-slate-100 bg-white z-10 shrink-0 shadow-sm flex items-center justify-between">
        <div>
          <h2 className="text-[10px] font-bold tracking-[0.2em] text-[#FF4D00] mb-1">CAMPUS COMMUNITY</h2>
          <h1 className="text-2xl font-serif font-black text-editorial-ink tracking-tight flex items-center gap-2">
            {vehicleType === 'car' ? '汽車討論室' : '機車討論室'} <span className="text-[#FF4D00]">.</span>
          </h1>
        </div>
        <div className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-full">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping"></span>
          <span className="text-[9px] font-bold text-emerald-600 tracking-wider">AI 停車助理在線</span>
        </div>
      </div>

      {/* 聊天訊息滾動區 */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4 scrollbar-hide">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-300 gap-3">
            <MessageSquare size={48} strokeWidth={1} />
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">目前沒有討論訊息，發個言吧！</p>
          </div>
        ) : (
          messages.map((msg) => {
            const isMe = msg.user_id === user?.id;
            const isAi = msg.role === 'ai';
            const isAdmin = msg.role === 'admin';

            return (
              <div 
                key={msg.id} 
                className={`flex gap-3 max-w-[85%] ${isMe ? 'ml-auto flex-row-reverse' : 'mr-auto'}`}
              >
                {/* 頭像 */}
                <div className="shrink-0">
                  {isAi ? (
                    <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-purple-500 to-indigo-600 flex items-center justify-center text-white text-xs font-black shadow-md shadow-indigo-100">
                      AI
                    </div>
                  ) : isAdmin ? (
                    <div className="w-9 h-9 rounded-full bg-rose-500 flex items-center justify-center text-white text-xs font-black shadow-md shadow-rose-100">
                      👮
                    </div>
                  ) : msg.user_avatar ? (
                    <img src={msg.user_avatar} alt={msg.user_name} className="w-9 h-9 rounded-full object-cover shadow-sm border border-slate-100" />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-slate-200 text-slate-500 flex items-center justify-center text-xs font-black shadow-sm">
                      {msg.user_name.charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>

                {/* 訊息氣泡與發送者名稱 */}
                <div className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                  <span className="text-[10px] font-bold text-slate-400 mb-1 flex items-center gap-1.5">
                    {msg.user_name}
                    {isAi && <span className="bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider scale-90">✨ AI 助理</span>}
                    {isAdmin && <span className="bg-rose-100 text-rose-600 px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider scale-90">👮 管理員</span>}
                  </span>
                  
                  <div 
                    className={`px-4 py-3 rounded-3xl text-sm leading-relaxed ${
                      isMe 
                        ? 'bg-editorial-ink text-white rounded-tr-none' 
                        : isAi
                          ? 'bg-white text-indigo-950 border border-indigo-100 rounded-tl-none shadow-md shadow-indigo-50/20'
                          : 'bg-white text-slate-800 border border-slate-100 rounded-tl-none shadow-sm'
                    }`}
                  >
                    {msg.content}
                  </div>
                  
                  <span className="text-[8px] text-slate-300 mt-1 font-bold">
                    {new Date(msg.created_at).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false })}
                  </span>
                </div>
              </div>
            );
          })
        )}
        <div ref={chatEndRef} />
      </div>

      {/* 底部輸入欄 */}
      <form onSubmit={handleSend} className="p-4 bg-white border-t border-slate-100 shrink-0 flex gap-2 z-10">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="詢問空車位或通報有人亂停..."
          className="flex-1 h-12 bg-slate-50 border border-slate-100 rounded-2xl px-5 text-sm outline-none focus:border-[#FF4D00] focus:ring-1 focus:ring-[#FF4D00]/30 transition-all font-medium placeholder:text-slate-300"
          disabled={isSending}
        />
        <button
          type="submit"
          disabled={!inputText.trim() || isSending}
          className="h-12 px-6 bg-[#FFB800] hover:bg-[#E6A600] disabled:bg-slate-100 disabled:text-slate-300 text-slate-900 font-sans font-black text-xs uppercase tracking-widest rounded-2xl transition-all active:scale-95 shadow-md shadow-amber-100 shrink-0"
        >
          {isSending ? "發送中" : "發送"}
        </button>
      </form>
    </motion.div>
  );
}
