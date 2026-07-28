import type { AtlasJournalDay, AtlasJournalEvent, AtlasJournalUnlock } from "./journal-contract";

export type AtlasLivingDayRequirementState = "satisfied" | "partial" | "waiting" | "unmet";
export type AtlasLivingDayGoalState = "locked" | "tracking" | "nearly_unlocked" | "in_production" | "realized";

export type AtlasLivingDayTaskRef = {
  taskId: string;
  title: string;
  status: string;
  dueDate: string | null;
  taskType: string;
  actionKey: string | null;
  workClass: string | null;
  priority: string;
  blockerText: string | null;
};

export type AtlasLivingDayRequirement = {
  requirementKey: string;
  label: string;
  state: AtlasLivingDayRequirementState;
  detail?: string | null;
  sourceKind: string;
  sourceId: string | null;
  task?: AtlasLivingDayTaskRef | null;
};

export type AtlasLivingDayGoal = {
  goalKey:
    | "elm_eb1_eb6_procut_open_v1"
    | "elm_fr11_fr14_october_sunflowers_v1"
    | "elm_fr15_procut_horizon_stand_v1"
    | "elm_fr4_fr6_first_zinnia_cut_v1";
  title: string;
  summary: string;
  state: AtlasLivingDayGoalState;
  progress: {
    satisfied: number;
    total: number;
    label: string;
  };
  requirements: AtlasLivingDayRequirement[];
  nextMove: AtlasLivingDayTaskRef | null;
  blocker: string | null;
  window?: {
    kind: "germination" | "harvest_watch";
    start: string | null;
    end: string | null;
    state: "unknown" | "waiting" | "open" | "passed_without_observation" | "satisfied";
  } | null;
  excludedFromDenominator: true;
  playability: "existing_task_only" | "waiting_for_canonical_observation_move";
  explanation: {
    basis: string;
    doesNotReleaseTask: true;
    configuration: "elm_living_day_goal_pilot_v1";
    [key: string]: unknown;
  };
};

export type AtlasLivingDayCarriedRhythm = {
  entryKey: string;
  entryKind: "rhythm";
  stateId: string;
  rhythmKey: string;
  state: "fallen_out_of_rhythm" | "recovering";
  title: string;
  detail: string;
  objectId: string;
  objectKey: string;
  objectLabel: string;
  dueAt: string | null;
  failureAt: string | null;
  currentTask: AtlasLivingDayTaskRef | null;
  excludedFromDenominator: true;
  physicalConditionClaim: "not_inferred_from_time";
};

export type AtlasLivingDayOwnerDecision = {
  entryKey: string;
  entryKind: "owner_decision";
  taskId: string;
  title: string;
  detail: string;
  status: string;
  dueDate: string | null;
  excludedFromDenominator: boolean;
};

export type AtlasLivingDayCompletionSummary = {
  readyToShow: boolean;
  plannedOpen: number;
  plannedDone: number;
  completed: number;
  partial: number;
  migrated: number;
  blocked: number;
  restored: number;
  advanced: number;
  unlocked: number;
};

export type AtlasLivingDay = {
  contractVersion: "living_day_v1";
  farmId: string;
  date: string;
  journal: AtlasJournalDay;
  carriedRhythms: AtlasLivingDayCarriedRhythm[];
  ownerDecisions: AtlasLivingDayOwnerDecision[];
  goals: AtlasLivingDayGoal[];
  unlockedToday: AtlasJournalUnlock[];
  completionSummary: AtlasLivingDayCompletionSummary;
  rules: {
    denominator: "bounded_day_plan_only";
    carriedExcluded: true;
    goalsExcluded: true;
    unlockedTodayExcluded: true;
    timeMayExpireStewardshipButNotClaimPhysicalCondition: true;
  };
};

export type AtlasLivingDayResponse = {
  ok: boolean;
  livingDay?: AtlasLivingDay;
  error?: string;
  details?: string;
};

export type AtlasLivingDayJournalEvent = AtlasJournalEvent;
