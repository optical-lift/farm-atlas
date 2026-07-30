export type AtlasLivingDayPlan = {
  contractVersion: "living_day_plan_v1";
  farmId: string;
  membershipId: string;
  date: string;
  snapshotId: string | null;
  preparedAt: string | null;
  frozen: boolean;
  denominator: number;
  resolvedCount: number;
  openCount: number;
  plannedTaskIds: string[];
  requiredTaskIds: string[];
  flexibleTaskIds: string[];
  withheldFlexibleTaskIds: string[];
  carriedTaskIds: string[];
  addedAfterPlanTaskIds: string[];
  resolvedPlanTaskIds: string[];
  openPlanTaskIds: string[];
  carryoverCount: number;
  carryoverCountAtPreparation: number;
  flexibleReduction: number;
  rules: {
    denominator: "morning_hand_only";
    carriedExcluded: true;
    ownerProblemsExcluded: true;
    partialReturnsExcluded: true;
    addedAfterPlanExcluded: true;
    withheldFlexibleExcluded: true;
    dueDatesChanged: false;
  };
};

export type AtlasLivingDayPlanResponse = {
  ok: boolean;
  plan?: AtlasLivingDayPlan;
  error?: string;
  details?: string;
};
