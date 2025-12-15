
export enum AppStatus {
  IDLE = 'IDLE',
  LOADING = 'LOADING',
  SUCCESS = 'SUCCESS',
  ERROR = 'ERROR',
}

export interface UploadedImage {
  base64: string;
  mimeType: string;
}

export interface GenerationResult {
  imageUrl?: string;
  text?: string;
}

export interface Preset {
  id: string;
  label: string;
  subtitle: string;
  thSubtitle: string;
  prompt: string;
  children?: Preset[];
}

// --- AUTH TYPES ---
export type UserRole = 'ADMIN' | 'MEMBER';

export interface User {
  id: string;
  username: string;
  password: string; // ในระบบจริงควรเข้ารหัส แต่เพื่อการจัดการแบบเรียลไทม์ตามโจทย์ จะเก็บเป็น text
  role: UserRole;
  expiryDate?: string; // ISO String format
  createdAt: number;
}

export interface AuthState {
  isAuthenticated: boolean;
  currentUser: User | null;
}
