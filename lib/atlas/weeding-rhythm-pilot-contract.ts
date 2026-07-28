import type { AtlasRhythmState } from "./rhythm-clock-contract";

export type AtlasWeedingPilotRuleClass =
  | "fast_production_soil"
  | "mulched_ornamental";

export type AtlasWeedingPilotTask = {
  taskId: string;
  title: string;
  status: string;
  dueDate: string | null;
  priority: string;
  actionKey: string | null;
  workClass: string | null;
};

export type AtlasWeedingPilotSubject = {
  stateId: string;
  objectId: string;
  objectKey: "fr_8" | "fr_15" | "redbud_island_right";
  objectLabel: string;
  zoneId: string | null;
  zoneKey: string | null;
  zoneLabel: string | null;
  state: AtlasRhythmState;
  leaseStartedAt: string | null;
  warningAt: string | null;
  dueAt: string | null;
  failureAt: string | null;
  nextBoundaryAt: string | null;
  lastEvaluatedAt: string | null;
  rule: {
    ruleId: string;
    ruleKey: string;
    version: number;
    label: string;
    class: AtlasWeedingPilotRuleClass;
    validityIntervalSeconds: number;
    warningWindowSeconds: number;
    graceWindowSeconds: number;
    timezoneName: "America/Chicago";
    boundaryMode: "exact_timestamp" | "local_wall_clock";
    qualifyingTouches: Array<Record<string, unknown>>;
    failureConsequence: Record<string, unknown>;
    playerRouting: Record<string, unknown>;
  };
  lastSatisfaction: null | {
    satisfactionId: string;
    kind: "full" | "conditional" | "modifier" | "game_master";
    satisfiedAt: string;
    renewalIntervalSeconds: number | null;
    sourceKind: string;
    sourceId: string;
    sourceEvent: string;
    evidence: Record<string, unknown>;
  };
  currentTask: AtlasWeedingPilotTask | null;
  consequence: {
    active: boolean;
    restoreRequired: boolean;
    blockScope: "same_subject" | "none";
    blockedActionKeys: string[];
    physicalConditionClaim: "unknown_until_observed";
  };
  physicalCondition: {
    value: string | null;
    reportedAt: string | null;
    source: string | null;
    authority: "separate_observation_state";
    inferredFromClock: false;
  };
  explanation: {
    governedBy: "owner_authored_rule";
    effectiveBindingId: string;
    effectiveBindingKey: string;
    inheritanceLayer: "subject_override";
    basis: "latest_qualifying_satisfaction_plus_owner_interval";
    notBasedOn: Array<
      "generic_recurrence" | "task_title" | "unobserved_physical_condition"
    >;
    pilotKey: "elm_weeding_pilot_v1";
  };
};

export type AtlasWeedingRhythmPilot = {
  contractVersion: "weeding_rhythm_pilot_v1";
  farmId: string;
  rhythmKey: "weed_stewardship";
  evaluatedAt: string;
  selectionRule: "owner_authored_rulebook_clock";
  physicalConditionRule: "observation_only";
  subjects: AtlasWeedingPilotSubject[];
};
