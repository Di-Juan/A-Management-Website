export type UserRole = 'admin' | 'member';

export interface User {
  id: number;
  username: string;
  displayName: string;
  role: UserRole;
  status: string;
  mustChangePassword: boolean;
  canIncome: boolean;
  canExpense: boolean;
  perms: string[];
  studentNo: string;
  department: string;
  phone: string;
  joinedAt: string;
  wxBound: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface LoginResult {
  token: string;
  expiresIn: number;
  user: User;
}

export type EquipmentCategory = 'printer' | 'instrument' | 'other';
export type EquipmentStatus = 'available' | 'maintenance' | 'retired';

export interface Equipment {
  id: number;
  code: string;
  name: string;
  category: EquipmentCategory;
  typeName: string;
  location: string;
  status: EquipmentStatus;
  requiresApproval: boolean;
  note: string;
}

export interface EquipmentSummary {
  available: number;
  maintenance: number;
  retired: number;
  pendingBookings: number;
}

export type BookingStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'completed';

export interface Booking {
  id: number;
  equipmentId: number;
  equipmentName: string;
  equipmentCode: string;
  userId: number;
  userName: string;
  startAt: string;
  endAt: string;
  purpose: string;
  status: BookingStatus;
  reviewerName: string;
  rejectReason: string;
  createdAt: string;
}

export interface Consumable {
  id: number;
  name: string;
  spec: string;
  unit: string;
  stock: number;
  warnThreshold: number;
  lowStock: boolean;
  note: string;
}

export interface InventoryItem {
  id: number;
  name: string;
  spec: string;
  package: string;
  location: string;
  quantity: number;
  unit: string;
  warnThreshold: number;
  lowStock: boolean;
  note: string;
}

export interface DutyShift {
  id: number;
  startTime: string;
  endTime: string;
  location: string;
  capacity: number;
  note: string;
  assignees: string[];
  mine: boolean;
}

export interface OperationsSummary {
  pendingBookings: number;
  pendingAccess: number;
  openActivities: number;
  lowStock: number;
  lowStockPreview: Array<{
    name: string;
    quantity: number;
    unit: string;
    warn: number;
    kind: 'consumable' | 'item';
  }>;
  myBorrowed: number;
  myOverdue: number;
  todayDuty: {
    total: number;
    mine: boolean;
    shifts: DutyShift[];
  };
}

export type ActivityStatus = 'draft' | 'open' | 'closed' | 'finished' | 'cancelled';

export interface Activity {
  id: number;
  title: string;
  description: string;
  location: string;
  startAt: string;
  endAt: string | null;
  signupDeadline: string | null;
  capacity: number | null;
  feeCents: number;
  status: ActivityStatus;
  creatorName: string;
  signupCount: number;
  checkedInCount: number;
  mySignupStatus: 'confirmed' | 'cancelled' | null;
}
