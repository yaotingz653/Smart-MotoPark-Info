/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ParkingSpot {
  id: string;
  status: 'available' | 'occupied' | 'mine' | 'disabled';
  number: string;
  parkingBlockId: string;
}

export type ViewState = 'login' | 'vehicle-select' | 'map' | 'status' | 'profile' | 'ai-creator' | 'community';

export type VehicleMode = 'motorcycle' | 'car';

export interface UserProfile {
  id: string;
  name: string;
  avatar: string;
  role: string;
  plate_number: string;
}

export interface ParkingBlock {
  id: string;
  startX: number;
  startY: number;
  rotation: number;
  rows: number;
  cols: number;
}

export interface CommunityMessage {
  id: string;
  user_id: string;
  user_name: string;
  user_avatar: string;
  role: 'student' | 'admin' | 'ai';
  content: string;
  created_at: string;
}

export interface EntryNotice {
  id: string;
  plateNumber: string;
  entryTime: string;
  remainingSeconds: number; // 預設 300 秒 (5 分鐘)
  status: 'pending' | 'completed' | 'expired';
}

