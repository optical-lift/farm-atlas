import type {
  AtlasRhythmSubjectKind,
} from "./rulebook-contract";

export const atlasRhythmClockStates = [
  "uninitialized",
  "resting",
  "coming_due",
  "due",
  "fallen_out_of_rhythm",
  "recovering",
  "paused",
] as const;

export type AtlasRhythmClockState = (typeof atlasRhythmClockStates)[number];

export const atlasRhythmTransitionKinds = [
  "initialized",
  "warning",
  "due",
  "failed",
  "recovering",
  "restored",
  "renewed",
  "paused",
  "reactivated",
  "rule_changed",
] as const;

export type AtlasRhythmTransitionKind =
  (typeof atlasRhythmTransitionKinds)[number];

export const atlasRhythmSatisfactionKinds = [
  "full",
  "conditional",
  "modifier",
  "game_master",
] as const;

export type AtlasRhythmSatisfactionKind =
  (typeof atlasRhythmSatisfactionKinds)[number];

export type AtlasRhythmTouchPolicy = {
  sourceKind?: string;
  sourceKinds?: string[];
  sourceEvent?: string;
  sourceEvents?: string[];
  taskType?: string;
  actionKey?: string;
  workClass?: string;
  payloadContains?: Record<string, unknown>;
  effect?: AtlasRhythmSatisfactionKind | "partial";
  renewalIntervalSeconds?: number;
};

export type AtlasRhythmTaskTemplate = {
  title: string;
  taskType?: string;
  actionKey?: string;
  workClass?: string;
  priority?: string;
  note?: string;
  unlockText?: string;
  zoneId?: string;
  assignedMembershipId?: string;
  visibilityScope?:
    | "owner"
    | "management"
    | "assigned_worker"
    | "farm_shared"
    | "project_shared"
    | "system_internal";
};

export type AtlasRhythmState = {
  id: string;
  farmId: string;
  rhythmBindingId: string;
  rhythmRuleId: string;
  rhythmKey: string;
  subjectKind: Extract<
    AtlasRhythmSubjectKind,
    "farm" | "zone" | "growing_object" | "crop_cycle" | "project"
  >;
  subjectId: string;
  state: AtlasRhythmClockState;
  leaseStartedAt: string | null;
  warningAt: string | null;
  dueAt: string | null;
  failureAt: string | null;
  recoveryStartedAt: string | null;
  lastQualifyingSatisfactionId: string | null;
  currentTaskId: string | null;
  currentOccurrenceId: string | null;
  effectiveRuleVersion: number;
  lastEvaluatedAt: string | null;
  lastTransitionAt: string | null;
};

export type AtlasRhythmSatisfaction = {
  id: string;
  rhythmStateId: string;
  rhythmBindingId: string;
  rhythmRuleId: string;
  satisfactionKey: string;
  satisfactionKind: AtlasRhythmSatisfactionKind;
  satisfiedAt: string;
  renewalIntervalSeconds: number | null;
  sourceKind: string;
  sourceId: string;
  sourceEvent: string;
  sourceWorkflowEventId: string | null;
  policyMatch: Record<string, unknown>;
  evidence: Record<string, unknown>;
};

export type AtlasRhythmTransition = {
  id: string;
  rhythmStateId: string;
  transitionKey: string;
  transitionKind: AtlasRhythmTransitionKind;
  fromState: AtlasRhythmClockState;
  toState: AtlasRhythmClockState;
  boundaryKind:
    | "initialization"
    | "warning"
    | "due"
    | "failure"
    | "satisfaction"
    | "partial_result"
    | "pause"
    | "reactivation"
    | "rule_change";
  boundaryAt: string;
  evaluatedAt: string;
  satisfactionId: string | null;
  taskId: string | null;
  plannedOccurrenceId: string | null;
  journalEventId: string | null;
  evaluatorVersion: "rhythm_clock_v1";
};

export type AtlasRhythmEvaluation = {
  contractVersion: "rhythm_evaluation_v1";
  stateId: string;
  changed: boolean;
  transitionCount: number;
  transitions: string[];
  state: AtlasRhythmClockState;
  warningAt?: string | null;
  dueAt?: string | null;
  failureAt?: string | null;
  asOf: string;
};

export type AtlasRhythmTick = {
  contractVersion: "farm_rhythm_tick_v1";
  asOf: string;
  farmId: string | null;
  scanned: number;
  changed: number;
  unchanged: number;
  failed: number;
  farmScanCounts: Record<string, number>;
  evaluatorVersion: "rhythm_clock_v1";
};
