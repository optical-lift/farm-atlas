export type AtlasBellImportance = "quiet" | "normal" | "attention" | "critical";

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
  payload: Record<string, unknown>;
};

export type AtlasBell = {
  contractVersion: "atlas_bell_v1";
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
  items: AtlasBellItem[];
  eventTruth: "journal_event_index";
  receiptTruth: "bell_event_receipts";
};

export type AtlasBellAction = "read" | "acknowledge" | "visit";
