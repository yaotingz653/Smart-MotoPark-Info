import React, { useEffect, useState, useCallback, useRef } from 'react';
import { GoogleMap, useJsApiLoader, Marker, DirectionsService, DirectionsRenderer, Polyline } from '@react-google-maps/api';
import { X } from 'lucide-react';

const containerStyle = {
  width: '100%',
  height: '100%'
};

// 預設停車場座標 (Fallback 中心點，主顧聖母堂附近)
const PARKING_LOT_CENTER = {
  lat: 24.226400,
  lng: 120.580000
};

// 預設大門口座標 (Snapping Point)
const ENTRANCE_COORDINATE = { lat: 24.22583219034479, lng: 120.57719225274344 };

// 靜宜大學真實校園內部座標定義 (對齊 Google Maps 官方圖標)
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

export const CAMPUS_PARKING_LOTS: Record<string, { lat: number, lng: number }> = {
  "第 1 停車場": { lat: 24.226129256098016, lng: 120.57956153623414 },
  "第 2 停車場": { lat: 24.22861666697639, lng: 120.58280168974743 },
  "第 3 停車場": { lat: 24.22859994360529, lng: 120.58180091007934 },
  "主顧樓地下停車場": { lat: 24.227028, lng: 120.583278 },
  "第 4 停車場": { lat: 24.227028, lng: 120.583278 }, // 保留歷史別名相容，座標同步指向主顧樓
  "第 5 停車場": { lat: 24.227661020363968, lng: 120.57962016471704 },
  "第 6 停車場": { lat: 24.22875729204324, lng: 120.57998780468942 }
};

// 停車場與校園建築的相對位置，作為推薦說明使用；座標本身仍由上方 Google Maps 點位控制。
export const CAMPUS_PARKING_LOT_RELATIONS = [
  '任垣樓南側',
  '思高學苑東側',
  '思高學苑前方及道路旁',
  '主顧樓 B1 地下室專屬停車場 (連接主顧樓/方濟樓)',
  '至善樓南側',
  '大禮堂北側',
] as const;

// 特定重點 Demo 車位精確座標
const specificCoordinates: Record<string, { lat: number, lng: number }> = {
  "A-05": { lat: 24.226129256098016, lng: 120.57956153623414 },
  "B-18": { lat: 24.22861666697639, lng: 120.58280168974743 },
  "E-15": { lat: 24.227661020363968, lng: 120.57962016471704 },
  "C-04": { lat: 24.22859994360529, lng: 120.58180091007934 }
};

/**
 * 取得車位的經緯度座標（去寫死化動態計算）
 * @param spotName 車位名稱 (例如 A-05)
 * @returns 經緯度座標
 */
export function getParkingSpotCoordinate(spotName: string): { lat: number, lng: number } {
  if (!spotName) return PARKING_LOT_CENTER;
  
  // 1. 優先使用特定 Demo 車位的精確座標
  if (specificCoordinates[spotName]) {
    return specificCoordinates[spotName];
  }
  
  try {
    // 2. 否則動態解析車位編號，計算相對於中心點的規則分佈座標
    const parts = spotName.split('-');
    const rowLetter = parts[0]?.toUpperCase() || 'A';
    const colPart = parts[1];
    
    const rowIndex = rowLetter.charCodeAt(0) - 65; // A -> 0, B -> 1
    const colIndex = colPart ? parseInt(colPart) - 1 : 0; // 05 -> 4
    
    const lat = 24.22515 + rowIndex * (-0.0000166) + colIndex * (-0.0000045);
    const lng = 120.57885 + rowIndex * (-0.0000020) + colIndex * (-0.0000295);
    
    return { lat, lng };
  } catch (e) {
    console.error("解析車位座標失敗，使用預設中心點", e);
    return PARKING_LOT_CENTER;
  }
}


// NOTE: origin 可以是座標物件或 'gps' (動態抓取)
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

export default function GoogleMapContainer({ isOpen, onClose, mode, targetSpot, origin = 'gps', isCar = false, carDestination = null, carParkingLotName = null, onDestinationSelect, inline = false }: GoogleMapContainerProps) {
  const { isLoaded } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''
  });

  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [userLocation, setUserLocation] = useState<google.maps.LatLngLiteral | null>(null);
  const [directionsResponse, setDirectionsResponse] = useState<google.maps.DirectionsResult | null>(null);
  // NOTE: 防止 DirectionsService 被重複呼叫造成無限迴圈
  const hasRequestedDirections = useRef(false);

  const onLoad = useCallback(function callback(map: google.maps.Map) {
    setMap(map);
  }, []);

  const onUnmount = useCallback(function callback() {
    setMap(null);
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    if (origin === 'gps') {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            const pos = {
              lat: position.coords.latitude,
              lng: position.coords.longitude,
            };
            setUserLocation(pos);
            if (map && mode === 'location') {
              map.panTo(pos);
            }
          },
          () => {
            console.error("Error: The Geolocation service failed.");
            // Fallback location
            setUserLocation({ lat: 24.225000, lng: 120.578000 });
          }
        );
      } else {
        console.error("Error: Your browser doesn't support geolocation.");
      }
    } else if (typeof origin === 'object') {
      // 座標物件（例如停車場出口）
      setUserLocation(origin);
    } else {
      // Plus Code 字串 → 設為 null，讓 DirectionsService 直接使用字串
      setUserLocation(null);
    }
  }, [isOpen, map, mode, origin]);

  const directionsCallback = useCallback(
    (
      response: google.maps.DirectionsResult | null,
      status: google.maps.DirectionsStatus
    ) => {
      if (response !== null && status === 'OK') {
        console.log('✅ Directions API 成功取得路線！');
        console.log('📊 路線摘要:', response.routes?.[0]?.summary);
        console.log('📏 距離:', response.routes?.[0]?.legs?.[0]?.distance?.text);
        console.log('⏱️ 預估時間:', response.routes?.[0]?.legs?.[0]?.duration?.text);
        setDirectionsResponse(response);
      } else {
        console.error('🚨 Directions API 拒絕請求！狀態碼:', status);
        // 設定一個空的 response 避免元件無限重試
        setDirectionsResponse({} as google.maps.DirectionsResult);
      }
    },
    []
  );

  useEffect(() => {
    // 重置導航狀態，勝于車位或起點改變時
    setDirectionsResponse(null);
    hasRequestedDirections.current = false;
  }, [mode, isOpen, targetSpot, origin, carDestination, carParkingLotName]);

  if (!isOpen) return null;

  // 動態決定導航終點座標 (呼叫動態計算函式，去寫死化)
  const destinationCoords = isCar
    ? (carParkingLotName && CAMPUS_PARKING_LOTS[carParkingLotName] ? CAMPUS_PARKING_LOTS[carParkingLotName] : { lat: 24.225700, lng: 120.576500 })
    : getParkingSpotCoordinate(targetSpot || '');
  // 汽車模式的目的地標記一律使用 CAMPUS_DESTINATIONS 的同一組座標；
  // 停車場是另一組獨立座標，避免目的地標記被誤畫到停車場上。
  const carDestinationCoords = isCar && carDestination
    ? CAMPUS_DESTINATIONS[carDestination]
    : null;


  // NOTE: 決定 DirectionsService 的起點
  // 若 origin 是字串（Plus Code），直接使用；否則使用 userLocation 座標
  const directionsOrigin: string | google.maps.LatLngLiteral | null = 
    isCar && origin === 'entrance'
      ? ENTRANCE_COORDINATE // 大門口座標
      : ((typeof origin === 'string' && origin !== 'gps') ? origin : userLocation);

  const isOriginReady = directionsOrigin !== null;

  // 判斷是否為 GPS 模式
  const isGpsMode = origin === 'gps' || (isCar && origin === 'entrance');

  const lineStartCoord = (typeof directionsOrigin === 'object' && directionsOrigin !== null)
    ? directionsOrigin
    : (userLocation || PARKING_LOT_CENTER);

  return (
    <div className={inline ? "relative w-full h-full min-h-[300px]" : "absolute inset-0 z-50 flex flex-col bg-white"}>
      {!inline && (
        <div className="flex justify-between items-center p-4 bg-editorial-ink text-white shadow-md">
          <h2 className="text-lg font-bold tracking-widest uppercase">
            {isCar 
              ? (mode === 'location' ? '靜宜大學校園汽車停車場' : `導航至 ${carParkingLotName || ''}`)
              : (mode === 'location' ? '目前定位' : `導航至車位 ${targetSpot || ''}`)}
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-full transition-colors">
            <X size={24} />
          </button>
        </div>
      )}
      <div className="flex-1 relative w-full h-full min-h-[300px]">
        {isLoaded ? (
          <GoogleMap
            mapContainerStyle={containerStyle}
            center={isCar ? (carDestinationCoords || { lat: 24.2263, lng: 120.5772 }) : (userLocation || destinationCoords)}
            zoom={isCar ? 17 : 20}
            onLoad={onLoad}
            onUnmount={onUnmount}
            options={{
              disableDefaultUI: true,
              zoomControl: true,
              mapTypeId: isCar ? 'roadmap' : 'hybrid', // 汽車版用普通道路地圖更易讀，機車用衛星混合圖
            }}
          >
            {/* 顯示起點 Marker */}
            {userLocation && (
              <Marker 
                position={userLocation} 
                icon={{
                  path: google.maps.SymbolPath.CIRCLE,
                  scale: 8,
                  fillColor: '#3B82F6',
                  fillOpacity: 1,
                  strokeWeight: 2,
                  strokeColor: '#ffffff',
                }}
              />
            )}
            
            {/* (1) 第一段：馬路導航 (非汽車版專屬) */}
            {!isCar && mode === 'navigation' && isOriginReady && isGpsMode && !hasRequestedDirections.current && (
              <DirectionsService
                options={{
                  origin: directionsOrigin!,
                  destination: isCar ? destinationCoords : ENTRANCE_COORDINATE,
                  travelMode: window.google.maps.TravelMode.DRIVING,
                }}
                callback={(response, status) => {
                  hasRequestedDirections.current = true;
                  directionsCallback(response, status);
                }}
              />
            )}

            {!isCar && mode === 'navigation' && directionsResponse && Object.keys(directionsResponse).length > 0 && (
              <DirectionsRenderer
                options={{
                  directions: directionsResponse,
                  suppressMarkers: isCar, // 汽車版自己標註大樓與停車場 Marker，外觀更美
                  polylineOptions: {
                    strokeColor: '#3B82F6',
                    strokeWeight: 5,
                  }
                }}
              />
            )}

            {/* 如果 GPS 馬路導航失敗，啟動直線備案 (非汽車版專屬) */}
            {!isCar && mode === 'navigation' && isOriginReady && isGpsMode && directionsResponse && Object.keys(directionsResponse).length === 0 && (
              <Polyline
                path={[lineStartCoord, isCar ? destinationCoords : ENTRANCE_COORDINATE]}
                options={{
                  strokeColor: '#3B82F6',
                  strokeOpacity: 0.6,
                  strokeWeight: 5,
                  geodesic: true,
                }}
              />
            )}

            {/* (2) 第二段：最後一哩路虛線 (機車版專屬) */}
            {!isCar && mode === 'navigation' && isOriginReady && (
              <>
                <Polyline
                  path={[
                    isGpsMode ? ENTRANCE_COORDINATE : lineStartCoord,
                    destinationCoords
                  ]}
                  options={{
                    strokeColor: '#FF4D00',
                    strokeOpacity: 0.8,
                    strokeWeight: 4,
                    icons: [{
                      icon: {
                        path: 'M 0,-1 0,1',
                        strokeOpacity: 1,
                        scale: 4
                      },
                      offset: '0',
                      repeat: '20px'
                    }],
                  }}
                />
                
                <Marker 
                  position={destinationCoords}
                  label={{
                    text: targetSpot || 'P',
                    color: '#ffffff',
                    fontWeight: 'bold',
                    fontSize: '12px',
                  }}
                  icon={{
                    path: google.maps.SymbolPath.BACKWARD_CLOSED_ARROW,
                    scale: 6,
                    fillColor: '#EF4444',
                    fillOpacity: 1,
                    strokeWeight: 2,
                    strokeColor: '#ffffff',
                  }}
                />
              </>
            )}

            {/* 汽車版目的地大樓 Marker */}
            {isCar && Object.entries(CAMPUS_DESTINATIONS)
              .filter(([name]) => name !== '大門口')
              .map(([name, coords]) => {
                const isSelected = name === carDestination;
                return (
                  <Marker
                    key={`destination-${name}`}
                    position={coords}
                    title={`選擇目的地：${name}`}
                    onClick={() => onDestinationSelect?.(name)}
                    label={{
                      text: name,
                      color: isSelected ? '#1D4ED8' : '#475569',
                      fontWeight: isSelected ? 'bold' : 'normal',
                      fontSize: isSelected ? '12px' : '10px',
                    }}
                    icon={{
                      path: google.maps.SymbolPath.CIRCLE,
                      scale: isSelected ? 9 : 6,
                      fillColor: isSelected ? '#2563EB' : '#64748B',
                      fillOpacity: 1,
                      strokeWeight: 2,
                      strokeColor: '#ffffff',
                    }}
                  />
                );
              })}

            {/* 汽車版所有停車場 Marker */}
            {isCar && Object.entries(CAMPUS_PARKING_LOTS).map(([name, coords]) => {
              const isRecommended = name === carParkingLotName;
              if (mode === 'navigation' && !isRecommended) return null; // 導航模式下只顯示推薦的那一個
              
              return (
                <Marker
                  key={name}
                  position={coords}
                  label={{
                    text: isRecommended ? `⭐ ${name}` : name,
                    color: isRecommended ? '#10B981' : '#475569',
                    fontWeight: 'bold',
                    fontSize: isRecommended ? '12px' : '10px',
                  }}
                  icon={{
                    path: google.maps.SymbolPath.BACKWARD_CLOSED_ARROW,
                    scale: isRecommended ? 8 : 6,
                    fillColor: isRecommended ? '#10B981' : '#94A3B8',
                    fillOpacity: 1,
                    strokeWeight: 2,
                    strokeColor: '#ffffff',
                  }}
                />
              );
            })}
          </GoogleMap>
        ) : (
          <div className="flex items-center justify-center w-full h-full text-slate-400">
            載入 Google Maps 中...
          </div>
        )}
      </div>
    </div>
  );
}
