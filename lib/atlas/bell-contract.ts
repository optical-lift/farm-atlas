export type AtlasBellImportance = "quiet" | "normal" | "attention" | "critical";
export type AtlasBellSection = "needs_you" | "rhythms" | "farm_movement";

export type AtlasBellBaselineSummary = {
  startedAt: string;
  totalCount: number;
  dueCount: number;
  failureCount: number;
  label: string;
};

export type AtlasBellItem = {
  eventId: string;
  eventKey: string;
  eventKind: string;
  sourceKind: string;
  sourceId: string;
  sourceEvent: string;
  title: string;
  detail: string | null;
  occurredAt: string;
  journalDate: string;
  importance: AtlasBellImportance;
  symbol: "!" | "~" | "◆" | "?" | "✓" | "–";
  deepLink: string;
  taskId: string | null;
  objectId: string | null;
  projectId: string | null;
  trailBindingId: string | null;
  unread: boolean;
  acknowledged: boolean;
  requiresAction: boolean;
  whileAway: boolean;
  baseline: boolean;
  obligationKey: string;
  section: AtlasBellSection;
  why: string;
  payload: Record<string, unknown>;
};

export type AtlasBell = {
  contractVersion: "atlas_bell_v2";
  farmId: string;
  effectiveUserId: string;
  effectiveMembershipId: string;
  effectiveRole: string;
  preparedAt: string;
  lastVisitAt: string | null;
  whileAwaySinceAt: string;
  whileAwayCount: number;
  unreadCount: number;
  badgeCount: number;
  baselineSummary: AtlasBellBaselineSummary;
  items: AtlasBellItem[];
  eventTruth: "journal_event_index";
  receiptTruth: "bell_event_receipts";
  obligationTruth: "latest_worthy_event_per_obligation";
};

export type AtlasBellAction = "read" | "acknowledge" | "visit";
