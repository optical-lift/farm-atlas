export type AtlasPresentedTask = {
  task_id: string;
  title: string;
  status: "open" | "blocked" | "done" | "archived" | string;
  due_date: string | null;
  priority: string | null;
  note: string | null;
  blocker_text: string | null;
  zone_label: string | null;
  work_lane: "required" | "process_continuation" | "rhythm" | "discretionary" | string;
  commitment_kind: "hard_date" | "dependency" | "persistent" | "floating" | string;
  effort_units: number;
  visibility_scope: string | null;
  assigned_membership_id: string | null;
  metadata: Record<string, unknown>;
};

export type AtlasPresentedWorkEntry = {
  task: AtlasPresentedTask;
  presentationReason: string;
  notificationPlanned: boolean;
  overload: boolean;
};

export type AtlasPresentedWorkMember = {
  displayName: string;
  role: "owner" | "manager" | "farm_hand" | string;
  workerKey: string | null;
};

export type AtlasPresentedWorkSummary = {
  budgetUnits: number;
  presentedUnits: number;
  mandatoryUnits: number;
  overloadUnits: number;
  presentedCount: number;
  attentionCount: number;
  heldCount: number;
  hardDateMissingNotificationCount: number;
};

export type AtlasPresentedWorkPacket = {
  contractVersion: "presented_work_v1" | string;
  farmId: string;
  membershipId: string;
  workDate: string;
  member: AtlasPresentedWorkMember;
  presented: AtlasPresentedWorkEntry[];
  attention: AtlasPresentedWorkEntry[];
  held: AtlasPresentedWorkEntry[];
  summary: AtlasPresentedWorkSummary;
};

export type AtlasReservoirDecisionAction =
  | "keep_now"
  | "choose_date"
  | "return_to_reservoir"
  | "archive";

export type AtlasReservoirDecision = {
  decisionId: string;
  taskId: string;
  title: string;
  status: string;
  dueDate: string | null;
  assignedMembershipId: string | null;
  workLane: string;
  effortUnits: number;
  reason: string;
  suggestedAction: string;
  createdAt: string;
  actions: AtlasReservoirDecisionAction[];
};

export type AtlasTomorrowPreflightSummary = {
  memberCount: number;
  overloadedMemberCount: number;
  hardDateMissingNotificationCount: number;
  presentedCount: number;
  attentionCount: number;
  heldCount: number;
  openDecisionCount: number;
};

export type AtlasTomorrowPreflight = {
  contractVersion: "owner_tomorrow_preflight_v1" | string;
  farmId: string;
  workDate: string;
  members: AtlasPresentedWorkPacket[];
  decisions: AtlasReservoirDecision[];
  summary: AtlasTomorrowPreflightSummary;
};
