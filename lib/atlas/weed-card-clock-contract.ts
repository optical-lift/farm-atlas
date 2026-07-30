import type { AtlasRhythmClockState } from "./rhythm-clock-contract";

export type AtlasWeedCardClockRule = {
  ruleId: string;
  ruleKey: string;
  version: number;
  label: string;
  validityIntervalSeconds: number;
  warningWindowSeconds: number;
  graceWindowSeconds: number;
  ownerReason: string | null;
};

export type AtlasWeedCardClock = {
  contractVersion: "weed_card_clock_v1";
  cardId: string;
  enrolled: boolean;
  asOf?: string;
  stateId?: string;
  state?: AtlasRhythmClockState;
  leaseStartedAt?: string | null;
  warningAt?: string | null;
  dueAt?: string | null;
  failureAt?: string | null;
  nextBoundaryAt?: string | null;
  currentTaskId?: string | null;
  currentOccurrenceId?: string | null;
  rule?: AtlasWeedCardClockRule;
  binding?: {
    bindingId: string;
    bindingKey: string;
    inheritanceLayer: "subject_override";
    active: boolean;
  };
  physicalCondition: {
    known: boolean;
    value: string | null;
    reportedAt: string | null;
    source?: string | null;
    inferredFromClock: false;
  };
  explanation?: {
    governedBy: "owner_authored_rule";
    basis: "latest_qualifying_satisfaction_plus_existing_weed_card_interval";
    legacyGenericRecurrenceActive: boolean;
    laborTimeGovernsClock: false;
    physicalConditionAuthority: "observation_only";
  };
};
