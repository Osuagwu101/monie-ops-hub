export const COMPANY_TARGET_PERCENT = 72 as const;
export const TEAM_STANDARD_PERCENT = 77 as const;
export const ROLLING_WEEKLY_TA_TARGET_NAIRA = 100_000 as const;
export const DAILY_REQUIRED_CONTACTS = 7 as const;
export const DAILY_CONTACT_CAPACITY = 15 as const;
export const DAILY_CALL_TARGET = DAILY_REQUIRED_CONTACTS;
export const TA_CALL_SHARE_MIN = 0.6 as const;
export const TA_CALL_SHARE_MAX = 0.8 as const;

export type UserRole = "director" | "assistant";

export type TaskType = "TA" | "LOAN" | "FOLLOW_UP";

export type TaskStatus =
  | "assigned"
  | "in_progress"
  | "postponed"
  | "completed"
  | "pending_verification"
  | "verified"
  | "discrepancy"
  | "deferred"
  | "unverifiable";

export type VerificationState = "verified" | "discrepancy" | "deferred" | "unverifiable";

export interface Merchant {
  id: string;
  businessName: string;
  phoneNumber: string | null;
  accountNumber: string | null;
  isActive: boolean;
}

export interface Terminal {
  id: string;
  terminalId: string;
  serialNumber: string | null;
  merchantId: string | null;
  assignedAt: string | null;
  isFaulty: boolean;
}

export interface TerminalPerformanceSnapshot {
  id: string;
  terminalId: string;
  reportDate: string;
  periodStart: string;
  periodEnd: string;
  paymentValue: number;
  paymentVolume: number;
  transferValue: number;
  transferVolume: number;
  officialTargetValue: number;
  officialTargetMet: boolean;
  daysSinceLastTransaction: number;
  sourceReportId: string;
}

export interface OperationsTask {
  id: string;
  taskDate: string;
  taskType: TaskType;
  status: TaskStatus;
  priority: number;
  merchantId: string | null;
  terminalId: string | null;
  assignedTo: string;
  dueAt: string | null;
  rolledFromTaskId: string | null;
}

export interface TaskOutcome {
  taskId: string;
  assistantId: string;
  reachedMerchant: boolean | null;
  commitmentReceived: boolean | null;
  expectedAmount: number | null;
  expectedBy: string | null;
  postponementReason: string | null;
  notes: string | null;
}
