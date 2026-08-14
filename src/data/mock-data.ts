export type TaskStatus = "Pending" | "Verified";
export type TaskType = "TA" | "Loan";

export interface Task {
  id: string;
  merchantName: string;
  phoneNumber: string;
  terminalId: string;
  taskType: TaskType;
  humanNotes: string;
  status: TaskStatus;
}

export interface DashboardStats {
  activeTerminals: number;
  dailyVolumeTarget: string;
  pendingTasks: number;
}

export const dashboardStats: DashboardStats = {
  activeTerminals: 128,
  dailyVolumeTarget: "₦4.2M",
  pendingTasks: 14,
};

export const todaysTasks: Task[] = [
  {
    id: "1",
    merchantName: "Adebola Stores",
    phoneNumber: "0803 123 4567",
    terminalId: "20391AB12",
    taskType: "TA",
    humanNotes: "Terminal swapped. Awaiting confirmation.",
    status: "Pending",
  },
  {
    id: "2",
    merchantName: "Kikelomo Mart",
    phoneNumber: "0705 987 6543",
    terminalId: "20482CD34",
    taskType: "Loan",
    humanNotes: "Follow up on repayment plan.",
    status: "Verified",
  },
  {
    id: "3",
    merchantName: "Chuks Electronics",
    phoneNumber: "0818 456 7890",
    terminalId: "20573EF56",
    taskType: "TA",
    humanNotes: "Printer paper roll delivered.",
    status: "Verified",
  },
  {
    id: "4",
    merchantName: "Ngozi Supermarket",
    phoneNumber: "0902 333 4444",
    terminalId: "20664GH78",
    taskType: "Loan",
    humanNotes: "Disbursement scheduled for 2 PM.",
    status: "Pending",
  },
  {
    id: "5",
    merchantName: "Emeka Ventures",
    phoneNumber: "0806 777 8888",
    terminalId: "20755IJ90",
    taskType: "TA",
    humanNotes: "Merchant requested additional POS.",
    status: "Pending",
  },
  {
    id: "6",
    merchantName: "Fatima Boutique",
    phoneNumber: "0701 222 3333",
    terminalId: "20846KL12",
    taskType: "Loan",
    humanNotes: "Account statement reviewed.",
    status: "Verified",
  },
];
