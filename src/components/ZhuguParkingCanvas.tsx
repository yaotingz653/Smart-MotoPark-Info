import React, { useState, useRef } from 'react';
import { Accessibility, Car, Crown, Star, ArrowUp, ArrowDown, Plus, Minus, MapPin, Compass } from 'lucide-react';
import { ParkingSpot } from '../types';

interface ZhuguParkingCanvasProps {
  spots: ParkingSpot[];
  onSpotClick?: (spot: ParkingSpot) => void;
}

// 車位類別判斷 helper
function getSpotCategory(num: string) {
  if (['A00', 'B00', 'D00', 'E09', 'F00'].includes(num)) {
    return 'disabled'; // 身障車格 ♿
  }
  if (['I01', 'I02'].includes(num)) {
    return 'vice_president'; // 副校長專屬格 👑
  }
  if (['J01'].includes(num)) {
    return 'special'; // 特殊車格 ⭐
  }
  return 'general'; // 一般車格
}

export default function ZhuguParkingCanvas({ spots, onSpotClick }: ZhuguParkingCanvasProps) {
  // ─── 縮放與平移 State ──────────────────────────────────────────
  const [scale, setScale] = useState(0.85);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartPos = useRef({ x: 0, y: 0 });
  const startPos = useRef({ x: 0, y: 0 });
  const lastPosition = useRef({ x: 0, y: 0 });

  const handlePointerDown = (e: React.PointerEvent) => {
    setIsDragging(true);
    dragStartPos.current = { x: e.clientX, y: e.clientY };
    startPos.current = { x: e.clientX, y: e.clientY };
    lastPosition.current = { ...position };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
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
    setScale(prev => Math.min(Math.max(prev + delta, 0.4), 1.8));
  };

  const resetView = () => {
    setScale(0.85);
    setPosition({ x: 0, y: 0 });
  };

  // 取得車位即時狀態
  const getSpotStatus = (num: string) => {
    const cleanNum = num.toUpperCase();
    const spot = spots.find(s => {
      const sNum = s.number.toUpperCase().replace('CAR-', '');
      const sId = s.id.toUpperCase().replace('CAR-ZHUGU-', '').replace('CAR-', '');
      return sNum === cleanNum || sId === cleanNum;
    });
    return spot || { id: `CAR-ZHUGU-${num}`, number: `CAR-${num}`, status: 'available' as const, parkingBlockId: 'zhugu' };
  };

  // 渲染單個車位方塊
  const renderSpotBox = (num: string) => {
    const spot = getSpotStatus(num);
    const cat = getSpotCategory(num);
    const isAvailable = spot.status === 'available';
    const isMine = spot.status === 'mine';
    const isOccupied = spot.status === 'occupied';
    const isDisabledSpot = spot.status === 'disabled';

    let bgStyle = 'bg-emerald-500 text-white border-emerald-600 shadow-md hover:bg-emerald-600'; // 綠色空位
    if (isMine) bgStyle = 'bg-[#3B82F6] text-white border-blue-600 shadow-md ring-2 ring-blue-300';
    else if (isOccupied) bgStyle = 'bg-[#EF4444] text-white border-red-600 shadow-md';
    else if (isDisabledSpot) bgStyle = 'bg-slate-400 text-white border-slate-500 opacity-60';
    else if (cat === 'disabled') bgStyle = 'bg-purple-100 text-purple-900 border-purple-300 hover:bg-purple-200';
    else if (cat === 'vice_president') bgStyle = 'bg-amber-100 text-amber-900 border-amber-300 hover:bg-amber-200';
    else if (cat === 'special') bgStyle = 'bg-pink-100 text-pink-900 border-pink-300 hover:bg-pink-200';

    return (
      <button
        key={num}
        onClick={(e) => {
          e.stopPropagation();
          onSpotClick?.(spot);
        }}
        onPointerUp={(e) => {
          e.stopPropagation();
        }}
        className={`relative flex flex-col items-center justify-center border-2 rounded-xl p-1 transition-all active:scale-95 cursor-pointer font-sans select-none shadow-sm ${bgStyle}`}
        style={{ minWidth: '42px', minHeight: '56px' }}
      >
        <span className="text-[10px] font-black tracking-tighter leading-none mb-0.5">
          {num}
        </span>

        {/* 圖示 */}
        {isMine ? (
          <span className="text-[7px] font-black bg-white text-blue-600 px-0.5 rounded shadow-sm">愛車</span>
        ) : isOccupied ? (
          <Car size={13} className="shrink-0" />
        ) : cat === 'disabled' ? (
          <Accessibility size={13} className="shrink-0 text-purple-600" />
        ) : cat === 'vice_president' ? (
          <Crown size={13} className="shrink-0 text-amber-600" />
        ) : cat === 'special' ? (
          <Star size={13} className="shrink-0 text-pink-600" />
        ) : (
          <span className="text-[8px] font-bold opacity-80">空位</span>
        )}

        {cat === 'disabled' && !isOccupied && !isMine && (
          <span className="text-[7px] font-bold text-purple-700 leading-tight scale-90">身障</span>
        )}
        {cat === 'vice_president' && !isOccupied && !isMine && (
          <span className="text-[7px] font-bold text-amber-800 leading-tight scale-90">副校長</span>
        )}
        {cat === 'special' && !isOccupied && !isMine && (
          <span className="text-[7px] font-bold text-pink-800 leading-tight scale-90">特殊</span>
        )}
      </button>
    );
  };

  return (
    <div className="w-full h-full flex flex-col relative select-none overflow-hidden">
      {/* 頂部出入口指引（完全不遮擋地圖） */}
      <div className="flex items-center justify-between px-4 py-2 bg-white/70 backdrop-blur-md border-b border-slate-200/50 shrink-0 z-10">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-extrabold text-[#8B5CF6] tracking-widest uppercase">ZHUGU BASEMENT</span>
          <span className="text-xs font-bold text-slate-600">主顧樓 B1 全覽 (可拖移/縮放)</span>
        </div>

        {/* 出入口指引標示 */}
        <div className="flex items-center gap-4 bg-slate-100/90 px-3 py-1 rounded-xl border border-slate-200">
          <div className="flex items-center gap-1 font-bold text-slate-700 text-[11px]">
            <ArrowDown size={14} className="text-emerald-500" />
            <span>入口 🚗</span>
          </div>
          <div className="w-px h-4 bg-slate-300" />
          <div className="flex items-center gap-1 font-bold text-slate-700 text-[11px]">
            <ArrowUp size={14} className="text-amber-500" />
            <span>出口 🏁</span>
          </div>
        </div>
      </div>

      {/* 可拖移 / 縮放 畫布展區 (去白底，直接融入背景) */}
      <div
        className="flex-1 overflow-hidden relative cursor-grab active:cursor-grabbing touch-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        <div
          className="absolute transition-transform duration-75 origin-top-left p-6"
          style={{
            transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
            transition: isDragging ? 'none' : 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
          }}
        >
          {/* 2D 主平面圖畫布框架 */}
          <div className="flex gap-4 justify-between items-start min-w-[920px]">
            {/* 左側：G 排 (12格 垂直縱向) */}
            <div className="flex flex-col gap-1.5 p-3 bg-white/80 backdrop-blur-sm rounded-3xl shadow-sm border border-slate-200/60">
              <span className="text-[11px] font-black text-center text-slate-700 pb-1 border-b border-slate-200">G排 (12格)</span>
              {['G01', 'G02', 'G03', 'G04', 'G05', 'G06', 'G07', 'G08', 'G09', 'G10', 'G11', 'G12'].map(num => renderSpotBox(num))}
            </div>

            {/* 中央主展區：A排 + 車道1 + B/C島 + 車道2 + D/E島 + 車道3 + F排 */}
            <div className="flex-1 flex flex-col gap-4">
              {/* A 排 (16格 橫向單排) */}
              <div className="p-3 bg-white/80 backdrop-blur-sm rounded-3xl shadow-sm border border-slate-200/60">
                <span className="text-[11px] font-black text-slate-700 mb-1 block">A排 (15格一般 + 1格身障)</span>
                <div className="flex gap-1.5 overflow-x-auto">
                  {['A00', 'A01', 'A02', 'A03', 'A04', 'A05', 'A06', 'A07', 'A08', 'A09', 'A10', 'A11', 'A12', 'A13', 'A14', 'A15'].map(num => renderSpotBox(num))}
                </div>
              </div>

              {/* 🚗 中央車道 Aisle 1 */}
              <div className="h-10 bg-slate-200/70 backdrop-blur-sm rounded-2xl border border-dashed border-slate-300 flex items-center justify-between px-6 text-[11px] font-black text-slate-500 uppercase tracking-widest">
                <span>🚗 車道 LANE 1</span>
                <span className="text-[9px] bg-slate-900 text-white px-3 py-0.5 rounded-full font-sans font-bold">◀ 雙向通行車道 ▶</span>
                <span>LANE 1 🚗</span>
              </div>

              {/* B 排 & C 排 島區 */}
              <div className="p-3 bg-white/80 backdrop-blur-sm rounded-3xl shadow-sm border border-slate-200/60 flex flex-col gap-2.5">
                <div>
                  <span className="text-[11px] font-black text-slate-700 mb-1 block">B排 (8格一般 + 1格身障)</span>
                  <div className="flex gap-1.5 overflow-x-auto">
                    {['B00', 'B01', 'B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B08'].map(num => renderSpotBox(num))}
                  </div>
                </div>
                <div className="pt-2 border-t border-slate-200">
                  <span className="text-[11px] font-black text-slate-700 mb-1 block">C排 (13格一般)</span>
                  <div className="flex gap-1.5 overflow-x-auto">
                    {['C01', 'C02', 'C03', 'C04', 'C05', 'C06', 'C07', 'C08', 'C09', 'C10', 'C11', 'C12', 'C13'].map(num => renderSpotBox(num))}
                  </div>
                </div>
              </div>

              {/* 🚗 中央主車道 Aisle 2 與 I 排 (副校長車位 向上對齊) */}
              <div className="flex gap-3 items-center">
                <div className="flex-1 h-11 bg-slate-300/60 backdrop-blur-sm rounded-2xl border-2 border-dashed border-slate-400 flex items-center justify-between px-6 text-[11px] font-black text-slate-700 uppercase tracking-widest shadow-inner">
                  <span>🚘 主流車道 MAIN AISLE</span>
                  <span className="text-[9px] bg-slate-900 text-white px-3 py-0.5 rounded-full font-sans font-bold">◀ 雙向主要車道 ▶</span>
                </div>

                {/* I 排 (副校長車位 向上對齊) */}
                <div className="p-2 bg-amber-50/90 border border-amber-300 rounded-2xl flex flex-col items-center gap-1 shrink-0 shadow-sm">
                  <span className="text-[8px] font-extrabold text-amber-800">I排 (副校長)</span>
                  <div className="flex gap-1">
                    {renderSpotBox('I01')}
                    {renderSpotBox('I02')}
                  </div>
                </div>
              </div>

              {/* D 排 (9格) & E 排 (9格) 島區 與 J 排 (特殊車位 向上對齊) */}
              <div className="flex gap-3 items-stretch">
                <div className="flex-1 p-3 bg-white/80 backdrop-blur-sm rounded-3xl shadow-sm border border-slate-200/60 flex flex-col gap-2.5">
                  <div>
                    <span className="text-[11px] font-black text-slate-700 mb-1 block">D排 (8格一般 + 1格身障)</span>
                    <div className="flex gap-1.5 overflow-x-auto">
                      {['D00', 'D01', 'D02', 'D03', 'D04', 'D05', 'D06', 'D07', 'D08'].map(num => renderSpotBox(num))}
                    </div>
                  </div>
                  <div className="pt-2 border-t border-slate-200">
                    <span className="text-[11px] font-black text-slate-700 mb-1 block">E排 (8格一般 + 1格身障)</span>
                    <div className="flex gap-1.5 overflow-x-auto">
                      {['E01', 'E02', 'E03', 'E04', 'E05', 'E06', 'E07', 'E08', 'E09'].map(num => renderSpotBox(num))}
                    </div>
                  </div>
                </div>

                {/* J 排 (特殊車位 向上對齊) */}
                <div className="p-2 bg-pink-50/90 border border-pink-300 rounded-2xl flex flex-col justify-center items-center gap-1 shrink-0 shadow-sm">
                  <span className="text-[8px] font-extrabold text-pink-800">J排 (特殊)</span>
                  {renderSpotBox('J01')}
                </div>
              </div>

              {/* 🚗 底部車道 Aisle 3 */}
              <div className="h-10 bg-slate-200/70 backdrop-blur-sm rounded-2xl border border-dashed border-slate-300 flex items-center justify-between px-6 text-[11px] font-black text-slate-500 uppercase tracking-widest">
                <span>🚗 車道 LANE 3</span>
                <span className="text-[9px] bg-slate-900 text-white px-3 py-0.5 rounded-full font-sans font-bold">◀ 雙向通行車道 ▶</span>
                <span>LANE 3 🚗</span>
              </div>

              {/* F 排 (14格 橫向單排) */}
              <div className="p-3 bg-white/80 backdrop-blur-sm rounded-3xl shadow-sm border border-slate-200/60">
                <span className="text-[11px] font-black text-slate-700 mb-1 block">F排 (13格一般 + 1格身障)</span>
                <div className="flex gap-1.5 overflow-x-auto">
                  {['F01', 'F02', 'F03', 'F04', 'F05', 'F06', 'F07', 'F08', 'F09', 'F10', 'F11', 'F12', 'F13', 'F00'].map(num => renderSpotBox(num))}
                </div>
              </div>
            </div>

            {/* 🚗 右側直立車道 (RIGHT AISLE LANE H) */}
            <div className="w-10 self-stretch bg-slate-200/80 backdrop-blur-sm border-2 border-dashed border-slate-300 rounded-2xl flex flex-col items-center justify-around py-5 text-slate-500 font-black text-[9px] uppercase tracking-widest select-none">
              <span>▲</span>
              <span className="[writing-mode:vertical-lr] tracking-widest text-slate-600">RIGHT AISLE 🚗</span>
              <span>▼</span>
            </div>

            {/* 右側：H排 (11格 垂直縱向) */}
            <div className="flex flex-col gap-2.5 shrink-0">
              <div className="p-3 bg-white/80 backdrop-blur-sm rounded-3xl shadow-sm border border-slate-200/60 flex flex-col gap-1.5">
                <span className="text-[11px] font-black text-center text-slate-700 pb-1 border-b border-slate-200">H排 (11格)</span>
                {['H01', 'H02', 'H03', 'H04', 'H06', 'H07', 'H08', 'H09', 'H10', 'H11', 'H12'].map(num => renderSpotBox(num))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 右下角浮動操作按鈕（放大、縮小、一鍵居中） */}
      <div className="absolute bottom-6 right-6 flex flex-col gap-2 z-30">
        <div className="bg-slate-900/90 text-white rounded-full shadow-2xl flex flex-col overflow-hidden w-9 border border-white/10 backdrop-blur-md">
          <button
            onClick={() => handleZoom(0.15)}
            className="h-9 flex items-center justify-center hover:bg-brand-orange transition-colors border-b border-white/10 cursor-pointer active:scale-95"
            title="放大 (+)"
          >
            <Plus size={16} />
          </button>
          <button
            onClick={() => handleZoom(-0.15)}
            className="h-9 flex items-center justify-center hover:bg-brand-orange transition-colors cursor-pointer active:scale-95"
            title="縮小 (-)"
          >
            <Minus size={16} />
          </button>
        </div>

        <button
          onClick={resetView}
          className="bg-white text-slate-800 w-9 h-9 rounded-full shadow-2xl flex items-center justify-center hover:bg-brand-orange hover:text-white transition-all active:scale-95 border border-slate-200 cursor-pointer"
          title="一鍵居中還原"
        >
          <MapPin size={16} />
        </button>
      </div>
    </div>
  );
}
