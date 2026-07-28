export const atlasJournalEventKinds = [
  "task_result",
  "field_log",
  "field_action",
  "observation",
  "maintenance_result",
  "state_change",
  "crop_cycle_change",
  "production_change",
  "trail_evidence",
  "unlock",
  "rhythm_warning",
  "rhythm_due",
  "rhythm_failure",
  "rhythm_recovery",
  "migration",
  "owner_action",
  "system_event",
] as const;

export type AtlasJournalEventKind = (typeof atlasJournalEventKinds)[number];

export const atlasJournalVisibilityScopes = [
  "owner",
  "management",
  "assigned_worker",
  "farm_shared",
  "project_shared",
  "system_internal",
] as const;

export type AtlasJournalVisibilityScope = (typeof atlasJournalVisibilityScopes)[number];

export type AtlasJournalImportance = "quiet" | "normal" | "attention" | "critical";

export type AtlasJournalProvenance = {
  adapter: string;
  source_table: string;
  canonical_source_kind: string;
  canonical_source_id: string;
  canonical_source_event: string;
  workflow_event_id?: string;
  workflow_event_key?: string;
  [key: string]: unknown;
};

export type AtlasJournalEvent = {
  eventId: string;
  eventKey: string;
  eventKind: AtlasJournalEventKind;
  sourceKind: string;
  sourceId: string;
  sourceEvent: string;
  occurredAt: string;
  journalDate: string;
  title: string;
  detail: string | null;
  importance: AtlasJournalImportance;
  taskId: string | null;
  objectId: string | null;
  cropCycleId: string | null;
  projectId: string | null;
  trailBindingId: string | null;
  provenance: AtlasJournalProvenance;
};

export type AtlasJournalTask = {
  taskId: string;
  title: string;
  status: string;
  dueDate: string | null;
  taskType: string;
  workClass: string | null;
  priority: string;
  zoneId: string | null;
};

export type AtlasJournalUnlock = {
  eventId: string;
  eventKey: string;
  title: string;
  occurredAt: string;
  taskId: string | null;
  projectId: string | null;
  trailBindingId: string | null;
};

export type AtlasJournalDay = {
  contractVersion: "journal_day_v1";
  farmId: string;
  date: string;
  carried: AtlasJournalTask[];
  planned: AtlasJournalTask[];
  events: AtlasJournalEvent[];
  unlocks: AtlasJournalUnlock[];
  summary: {
    open: number;
    done: number;
    events: number;
    unlocks: number;
  };
};

export function isAtlasJournalEventKind(value: string): value is AtlasJournalEventKind {
  return (atlasJournalEventKinds as readonly string[]).includes(value);
}
