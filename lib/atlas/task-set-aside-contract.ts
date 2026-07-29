export type AtlasTaskDayConsequence = "not_due" | "due" | "overdue" | "at_risk";

export type AtlasTaskDayDisposition = {
  id: string;
  taskId: string;
  serviceDate: string;
  dueDate: string | null;
  safeBoundaryDate: string | null;
  consequence: AtlasTaskDayConsequence;
  overdueDays: number;
  deferralCount: number;
  returnsOn: string;
  createdAt: string;
  taskTitle: string;
};

export type AtlasTaskSetAsideResult = {
  contractVersion: "task_set_aside_today_v1";
  dispositionId: string;
  workflowEventId?: string | null;
  taskId: string;
  serviceDate: string;
  dueDate: string | null;
  safeBoundaryDate: string | null;
  clockState?: string | null;
  consequence: AtlasTaskDayConsequence;
  overdueDays: number;
  deferralCount: number;
  returnsOn: string;
  message: string;
  taskStatusUnchanged?: boolean;
  dueDateUnchanged?: boolean;
  deduplicated: boolean;
};
