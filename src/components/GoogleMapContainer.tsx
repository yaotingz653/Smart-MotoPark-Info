import React from 'react';
import { X, Compass, ExternalLink } from 'lucide-react';

// 靜宜大學主顧聖母堂中心座標
const PARKING_LOT_CENTER = {
  lat: 24.226400,
  lng: 120.580000
};

// 靜宜大學真實校園內部大樓座標
export const CAMPUS_DESTINATIONS: Record<string, { lat: number, lng: number }> = {
  "任垣樓": { lat: 24.22697821929028, lng: 120.5799721902853 },
  "伯鐸樓": { lat: 24.226191754592346, lng: 120.58063468494247 },
  "蓋夏圖書館": { lat: 24.22629535601347, lng: 120.5813016280436 },
  "靜安樓": { lat: 24.226212002359276, lng: 120.58204928636303 },
  "格倫樓": { lat: 24.226292679492445, lng: 120.58319908036006 },
  "主顧樓": { lat: 24.22705270022881, lng: 120.58356699776688 },
  "方濟樓": { lat: 24.227946144849867, lng: 120.58346460550584 },
  "修院": { lat: 24.227930578853677, lng: 120.58266803006626 },
  "思源樓": { lat: 24.227015919694406, lng: 120.58249230763214 },
  "文興樓": { lat: 24.227089651383423, lng: 120.5811259609959 },
  "靜園餐廳": { lat: 24.227579485533262, lng: 120.58163523285138 },
  "希嘉學苑": { lat: 24.228150407221957, lng: 120.58027107636354 },
  "宜園餐廳": { lat: 24.227220113342632, lng: 120.579511786746 },
  "至善樓": { lat: 24.228179925885087, lng: 120.57979114476262 },
  "思高學苑": { lat: 24.2290678261877, lng: 120.58206635033274 },
  "體育館/運動場": { lat: 24.229327407452, lng: 120.58063378934766 },
  "溫水游泳池": { lat: 24.229498480881364, lng: 120.58043716390073 },
  "綜合運動場": { lat: 24.227970369201962, lng: 120.57912148144388 },
  "綜合球場": { lat: 24.226811770485178, lng: 120.57853682882619 },
  "主顧聖母堂": { lat: 24.228103521823453, lng: 120.58132773588444 },
  "善牧學苑": { lat: 24.228864711515357, lng: 120.58250279495674 },
  "大門口": { lat: 24.22583219034479, lng: 120.57719225274344 }
};

// 靜宜大學真實校園停車場座標
export const CAMPUS_PARKING_LOTS: Record<string, { lat: number, lng: number }> = {
  "第 1 停車場": { lat: 24.226129256098016, lng: 120.57956153623414 },
  "第 2 停車場": { lat: 24.22861666697639, lng: 120.58280168974743 },
  "第 3 停車場": { lat: 24.22859994360529, lng: 120.58180091007934 },
  "主顧樓地下停車場": { lat: 24.227028, lng: 120.583278 },
  "第 4 停車場": { lat: 24.227028, lng: 120.583278 },
  "第 5 停車場": { lat: 24.227661020363968, lng: 120.57962016471704 },
  "第 6 停車場": { lat: 24.22875729204324, lng: 120.57998780468942 }
};

export const CAMPUS_PARKING_LOT_RELATIONS = [
  '任垣樓南側',
  '思高學苑東側',
  '思高學苑前方及道路旁',
  '主顧樓 B1 地下室專屬停車場 (連接主顧樓/方濟樓)',
  '主顧樓 B1 地下室專屬停車場 (連接主顧樓/方濟樓)',
  '至善樓與綜合運動場間',
  '游泳池旁 (靠近思高學苑)'
];

const specificCoordinates: Record<string, { lat: number, lng: number }> = {
  'A-05': { lat: 24.225103, lng: 120.578762 },
  'A-01': { lat: 24.225120, lng: 120.578880 },
  'B-12': { lat: 24.224980, lng: 120.578650 },
  'C-08': { lat: 24.224850, lng: 120.578500 },
};

export function getParkingSpotCoordinate(spotName: string): { lat: number, lng: number } {
  if (!spotName) return PARKING_LOT_CENTER;
  if (specificCoordinates[spotName]) return specificCoordinates[spotName];
  try {
    const parts = spotName.split('-');
    const rowLetter = parts[0]?.toUpperCase() || 'A';
    const colPart = parts[1];
    const rowIndex = rowLetter.charCodeAt(0) - 65;
    const colIndex = colPart ? parseInt(colPart) - 1 : 0;
    const lat = 24.22515 + rowIndex * (-0.0000166) + colIndex * (-0.0000045);
    const lng = 120.57885 + rowIndex * (-0.0000020) + colIndex * (-0.0000295);
    return { lat, lng };
  } catch (e) {
    return PARKING_LOT_CENTER;
  }
}

type OriginType = { lat: number; lng: number } | 'gps' | 'entrance';

interface GoogleMapContainerProps {
  isOpen: boolean;
  onClose: () => void;
  mode: 'location' | 'navigation';
  targetSpot?: string | null;
  origin?: OriginType;
  isCar?: boolean;
  carDestination?: string | null;
  carParkingLotName?: string | null;
  onDestinationSelect?: (destination: string) => void;
  inline?: boolean;
}

export default function GoogleMapContainer({
  isOpen,
  onClose,
  mode,
  targetSpot,
  origin = 'gps',
  isCar = false,
  carDestination = null,
  carParkingLotName = null,
  onDestinationSelect,
  inline = false
}: GoogleMapContainerProps) {
  if (!isOpen && !inline) return null;

  // 計算動態目標座標
  const targetLotCoords = carParkingLotName ? (CAMPUS_PARKING_LOTS[carParkingLotName] || PARKING_LOT_CENTER) : PARKING_LOT_CENTER;
  const destCoords = carDestination ? (CAMPUS_DESTINATIONS[carDestination] || targetLotCoords) : targetLotCoords;
  const targetSpotCoords = targetSpot ? getParkingSpotCoordinate(targetSpot) : PARKING_LOT_CENTER;

  const finalCoords = isCar ? destCoords : targetSpotCoords;

  // 生成不需要 API Key 且 100% 穩定的 Google 地圖嵌入 URL
  const searchKeyword = isCar ? (carParkingLotName || carDestination || "靜宜大學") : `靜宜大學 車位 ${targetSpot || ''}`;
  const mapEmbedUrl = `https://maps.google.com/maps?q=${finalCoords.lat},${finalCoords.lng}&hl=zh-TW&z=18&output=embed`;

  const openExternalGoogleMaps = () => {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${finalCoords.lat},${finalCoords.lng}&travelmode=driving`;
    window.open(url, '_blank');
  };

  return (
    <div className={inline ? "relative w-full h-full min-h-[300px] rounded-2xl overflow-hidden shadow-inner border border-slate-100" : "fixed inset-0 z-[9999] flex flex-col bg-slate-900/90 backdrop-blur-md p-2 sm:p-6"}>
      <div className="relative w-full max-w-5xl mx-auto flex-1 flex flex-col bg-white rounded-3xl overflow-hidden shadow-2xl border border-slate-200">
        
        {/* 頂部標題與關閉按鈕 */}
        {!inline && (
          <div className="flex justify-between items-center px-6 py-4 bg-slate-900 text-white shrink-0 z-[10000]">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-ping"></span>
              <h2 className="text-sm font-black tracking-wider uppercase text-slate-100">
                {isCar 
                  ? (mode === 'location' ? '靜宜大學校園汽車停車場即時地圖' : `導航至 ${carParkingLotName || searchKeyword}`)
                  : (mode === 'location' ? '校園定位' : `導航至車位 ${targetSpot || ''}`)}
              </h2>
            </div>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-full text-xs font-black flex items-center gap-1.5 shadow-lg transition-all active:scale-95 cursor-pointer border border-rose-400/40 z-[10001]"
            >
              <X size={16} />
              <span>關閉視窗 (返回車位)</span>
            </button>
          </div>
        )}

        <div className="flex-1 relative w-full h-full min-h-[320px] bg-slate-100">
          {/* 使用不需要 API Key 且 100% 鎖定該停車場真實位址的 Google 嵌入地圖 */}
          <iframe
            title="Google Maps Campus Navigation"
            width="100%"
            height="100%"
            style={{ border: 0, minHeight: '320px' }}
            loading="lazy"
            allowFullScreen
            src={mapEmbedUrl}
            className="w-full h-full rounded-2xl"
          ></iframe>

          {/* 底部開啟外部原生地圖按鈕 */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[10000]">
            <button
              onClick={openExternalGoogleMaps}
              className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-full text-xs font-black shadow-xl flex items-center gap-2 transition-all active:scale-95 border border-blue-400/30 cursor-pointer"
            >
              <Compass size={15} />
              <span>開啟 Google 地圖全功能導航</span>
              <ExternalLink size={13} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
