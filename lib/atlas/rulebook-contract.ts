export const atlasRhythmRuleStatuses = [
  "draft",
  "active",
  "superseded",
  "paused",
  "retired",
] as const;

export type AtlasRhythmRuleStatus = (typeof atlasRhythmRuleStatuses)[number];

export const atlasRhythmInheritanceLayers = [
  "farm_default",
  "object_class",
  "zone_modifier",
  "contents_stage",
  "subject_override",
  "temporary_exception",
] as const;

export type AtlasRhythmInheritanceLayer =
  (typeof atlasRhythmInheritanceLayers)[number];

export const atlasRhythmSubjectKinds = [
  "farm",
  "zone",
  "growing_object",
  "object_class",
  "crop_profile",
  "crop_stage",
  "crop_cycle",
  "room_state",
  "project",
  "project_stage",
] as const;

export type AtlasRhythmSubjectKind = (typeof atlasRhythmSubjectKinds)[number];

export type AtlasEffectiveRhythmRule = {
  bindingId: string;
  bindingKey: string;
  inheritanceLayer: AtlasRhythmInheritanceLayer;
  bindingSubjectKind: AtlasRhythmSubjectKind;
  bindingSubjectId: string | null;
  bindingSubjectKey: string | null;
  priority: number;
  layerRank: number;
  matchedOn: string;
  ruleId: string;
  ruleKey: string;
  rhythmKey: string;
  version: number;
  label: string;
  applicability: Record<string, unknown>;
  validityIntervalSeconds: number;
  warningWindowSeconds: number;
  graceWindowSeconds: number;
  qualifyingTouches: Array<Record<string, unknown>>;
  failureConsequence: Record<string, unknown>;
  playerRouting: Record<string, unknown>;
};

export type AtlasEffectiveRhythmResolution = {
  contractVersion: "effective_rhythm_rule_v1";
  resolvedAt: string;
  farmId: string;
  organizationId: string;
  subject: {
    kind: "farm" | "zone" | "growing_object" | "crop_cycle" | "project";
    id: string;
    zoneId: string | null;
    objectId: string | null;
    objectType: string | null;
    objectMode: string | null;
    cropProfileId: string | null;
    stageKey: string | null;
  };
  rhythmKey: string;
  effectiveRule: AtlasEffectiveRhythmRule | null;
  explanation: {
    candidateCount: number;
    winnerLayer: AtlasRhythmInheritanceLayer | null;
    matchedOn: string | null;
    resolutionRule: "nearest_active_explicit_rule_wins";
    inheritanceOrder: AtlasRhythmInheritanceLayer[];
    noMatch: boolean;
  };
};
