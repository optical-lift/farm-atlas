export type AtlasWorkerActivityLog = {
  activityLogId: string;
  actorMembershipId: string;
  rawText: string;
  loggedAt: string;
  activityDate: string;
  source: "worker_manual_log";
  clockNowTaskId: string | null;
  clockNowStartAt: string | null;
  clockNowEndAt: string | null;
  clockProjectionRevision: string | null;
};

export type AtlasWorkerActivityTimelineEvent = {
  eventId: string;
  eventKind: string;
  sourceKind: string;
  sourceId: string;
  sourceEvent: string;
  occurredAt: string;
  title: string;
  detail: string | null;
  importance: string;
  taskId: string | null;
};

export type AtlasWorkerActivityDay = {
  date: string;
  farmId: string;
  membershipId: string;
  activityLogs: AtlasWorkerActivityLog[];
  journalEvents: AtlasWorkerActivityTimelineEvent[];
  plannedOpen: number;
  plannedDone: number;
};

export type AtlasWorkerActivityWriteResult = {
  activityLogId: string;
  actorMembershipId: string;
  loggedAt: string;
  replayed: boolean;
};
