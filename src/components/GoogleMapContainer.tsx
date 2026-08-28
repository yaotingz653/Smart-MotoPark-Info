import React, { useEffect, useState, useCallback, useRef } from 'react';
import { GoogleMap, useJsApiLoader, Marker, DirectionsService, DirectionsRenderer, Polyline } from '@react-google-maps/api';
import { X, Compass, ExternalLink } from 'lucide-react';

const containerStyle = {
  width: '100%',
  height: '100%'
};

// 靜宜大學主顧聖母堂中心座標
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

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

  const { isLoaded } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: apiKey
  });

  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [userLocation, setUserLocation] = useState<google.maps.LatLngLiteral | null>(null);
  const [directionsResponse, setDirectionsResponse] = useState<google.maps.DirectionsResult | null>(null);
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
            setUserLocation(PARKING_LOT_CENTER);
          }
        );
      } else {
        setUserLocation(PARKING_LOT_CENTER);
      }
    } else if (typeof origin === 'object' && origin !== null) {
      setUserLocation(origin);
    }
  }, [isOpen, origin, map, mode]);

  const directionsCallback = useCallback((result: any, status: string) => {
    if (status === 'OK' && result) {
      setDirectionsResponse(result);
    } else {
      setDirectionsResponse({} as any);
    }
  }, []);

  const destinationCoords = targetSpot ? getParkingSpotCoordinate(targetSpot) : PARKING_LOT_CENTER;
  const carDestinationCoords = carDestination ? (CAMPUS_DESTINATIONS[carDestination] || { lat: 24.2263, lng: 120.5772 }) : null;
  const targetParkingLotCoords = carParkingLotName ? (CAMPUS_PARKING_LOTS[carParkingLotName] || PARKING_LOT_CENTER) : PARKING_LOT_CENTER;

  const directionsOrigin: string | google.maps.LatLngLiteral | null = 
    isCar && origin === 'entrance'
      ? ENTRANCE_COORDINATE
      : ((typeof origin === 'string' && origin !== 'gps') ? origin : userLocation);

  const isOriginReady = directionsOrigin !== null;
  const isGpsMode = origin === 'gps' || (isCar && origin === 'entrance');

  const lineStartCoord = (typeof directionsOrigin === 'object' && directionsOrigin !== null)
    ? directionsOrigin
    : (userLocation || PARKING_LOT_CENTER);

  const openExternalGoogleMaps = () => {
    const dest = isCar ? targetParkingLotCoords : destinationCoords;
    const url = `https://www.google.com/maps/dir/?api=1&destination=${dest.lat},${dest.lng}&travelmode=driving`;
    window.open(url, '_blank');
  };

  return (
    <div className={inline ? "relative w-full h-full min-h-[300px]" : "fixed inset-0 z-[9999] flex flex-col bg-slate-900/90 backdrop-blur-md p-2 sm:p-6"}>
      <div className="relative w-full max-w-5xl mx-auto flex-1 flex flex-col bg-white rounded-3xl overflow-hidden shadow-2xl border border-slate-200">
        
        {/* 頂部極致清晰標題列與強制可點擊關閉按鈕 */}
        {!inline && (
          <div className="flex justify-between items-center px-6 py-4 bg-slate-900 text-white shrink-0 z-[10000]">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-ping"></span>
              <h2 className="text-sm font-black tracking-wider uppercase text-slate-100">
                {isCar 
                  ? (mode === 'location' ? '靜宜大學校園汽車停車場即時地圖' : `導航至 ${carParkingLotName || ''}`)
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

        <div className="flex-1 relative w-full h-full min-h-[350px]">
          {isLoaded ? (
            <GoogleMap
              mapContainerStyle={containerStyle}
              center={isCar ? (carDestinationCoords || targetParkingLotCoords || { lat: 24.2263, lng: 120.5772 }) : (userLocation || destinationCoords)}
              zoom={isCar ? 17 : 20}
              onLoad={onLoad}
              onUnmount={onUnmount}
              options={{
                disableDefaultUI: true,
                zoomControl: true,
                mapTypeId: isCar ? 'roadmap' : 'hybrid',
              }}
            >
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
                    suppressMarkers: isCar,
                    polylineOptions: {
                      strokeColor: '#3B82F6',
                      strokeWeight: 5,
                    }
                  }}
                />
              )}

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

              {isCar && Object.entries(CAMPUS_PARKING_LOTS).map(([name, coords]) => {
                const isRecommended = name === carParkingLotName;
                if (mode === 'navigation' && !isRecommended) return null;
                
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
            <div className="flex flex-col items-center justify-center w-full h-full bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white p-6 text-center relative overflow-hidden">
              {/* 背景網格線條 */}
              <div className="absolute inset-0 bg-[linear-gradient(to_right,#1e293b_1px,transparent_1px),linear-gradient(to_bottom,#1e293b_1px,transparent_1px)] bg-[size:24px_24px] opacity-30"></div>
              
              <div className="relative z-10 flex flex-col items-center gap-3">
                <div className="w-16 h-16 rounded-3xl bg-blue-500/20 border border-blue-400/40 flex items-center justify-center text-blue-400 shadow-xl shadow-blue-500/10 animate-pulse">
                  <Compass size={32} />
                </div>

                <div>
                  <h3 className="text-base font-black text-white tracking-wide">
                    {isCar ? (carParkingLotName || '靜宜大學校園停車場') : `車位 ${targetSpot || ''}`}
                  </h3>
                  <p className="text-xs text-slate-400 font-mono mt-1">
                    座標：24.2285° N, 120.5818° E
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* 底部一鍵開啟外部真實 Google Maps 導航按鈕 */}
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[10000]">
            <button
              onClick={openExternalGoogleMaps}
              className="px-5 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-full text-xs font-black shadow-xl flex items-center gap-2 transition-all active:scale-95 border border-blue-400/30 cursor-pointer"
            >
              <Compass size={16} />
              <span>開啟外連 Google 地圖全功能導航</span>
              <ExternalLink size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
