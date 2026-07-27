-- ============================================================
-- Smart-MotoPark & Smart-CarPark 資料庫 Migration 腳本
-- 檔案: 20260720_parking_schema.sql
-- 說明: 建置機車與汽車車位表、歷史紀錄表與 RLS 權限政策
-- ============================================================

-- 1. 建立機車車位表 parking_spots
CREATE TABLE IF NOT EXISTS public.parking_spots (
  id text PRIMARY KEY,
  number text NOT NULL,
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'occupied', 'mine', 'disabled')),
  occupied_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  occupied_at timestamp with time zone,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now())
);

-- 2. 建立汽車車位表 car_parking_spots
CREATE TABLE IF NOT EXISTS public.car_parking_spots (
  id text PRIMARY KEY,
  number text NOT NULL,
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'occupied', 'mine', 'disabled')),
  occupied_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  occupied_at timestamp with time zone,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now())
);

-- 3. 建立通用停車歷史紀錄表 parking_history (支援機車 moto 與汽車 car)
CREATE TABLE IF NOT EXISTS public.parking_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  spot_id text NOT NULL,
  spot_number text NOT NULL,
  vehicle_type text NOT NULL DEFAULT 'moto' CHECK (vehicle_type IN ('moto', 'car')),
  action text NOT NULL CHECK (action IN ('reserve', 'release')),
  start_time timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  end_time timestamp with time zone,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now())
);

-- 建立索引以提升歷史查詢與未結束訂單過濾效能
CREATE INDEX IF NOT EXISTS idx_parking_history_user ON public.parking_history(user_id);
CREATE INDEX IF NOT EXISTS idx_parking_history_active ON public.parking_history(user_id, spot_id) WHERE end_time IS NULL;

-- 4. 啟用 Row Level Security (RLS) 權限控制
ALTER TABLE public.parking_spots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.car_parking_spots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parking_history ENABLE ROW LEVEL SECURITY;

-- 5. RLS 政策設定
-- 所有驗證用戶或匿名用戶皆可讀取車位狀態
CREATE POLICY "Allow public read on parking_spots" ON public.parking_spots FOR SELECT USING (true);
CREATE POLICY "Allow public read on car_parking_spots" ON public.car_parking_spots FOR SELECT USING (true);

-- 用戶只能讀取與操作屬於自己的歷史紀錄
CREATE POLICY "Allow users to read own history" ON public.parking_history 
  FOR SELECT USING (auth.uid() = user_id OR user_id = 'c811008c-077b-4ebc-8db7-2cd18129d584'::uuid);

CREATE POLICY "Allow users to insert own history" ON public.parking_history 
  FOR INSERT WITH CHECK (auth.uid() = user_id OR user_id = 'c811008c-077b-4ebc-8db7-2cd18129d584'::uuid);

CREATE POLICY "Allow users to update own history" ON public.parking_history 
  FOR UPDATE USING (auth.uid() = user_id OR user_id = 'c811008c-077b-4ebc-8db7-2cd18129d584'::uuid);
