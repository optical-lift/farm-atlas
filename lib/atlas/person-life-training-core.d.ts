export const FIVE_K_REQUIREMENT_KEY: "complete_5k";

export type PersonLifeSubject = {
  domain?: string;
  kind?: string;
  id?: string;
};

export type PersonLifeBuilderResult = {
  ok: boolean;
  error?: string;
  value?: any;
};

export function isFiveKGoal(definition: unknown): boolean;
export function hasFiveKRequirement(definition: unknown): boolean;
export function getFiveKRunSubject(definition: unknown): PersonLifeSubject | null;

export function buildFiveKRequirementCapture(input: {
  goalSubject: unknown;
  sourceKey: unknown;
  observedAt: unknown;
}): PersonLifeBuilderResult;

export function buildFiveKRhythmPlanCapture(input: {
  goalDefinitionId: unknown;
  goalSubject: unknown;
  runSubject: unknown;
  sourceKey: unknown;
  acceptedAt: unknown;
  timezone: unknown;
  weekdays?: unknown;
  localStartTime?: unknown;
  windowMinutes?: unknown;
}): PersonLifeBuilderResult;

export function buildFiveKGuardrailCapture(input: {
  ownerUserId: unknown;
  goalDefinitionId: unknown;
  sourceKey: unknown;
  acceptedAt: unknown;
}): PersonLifeBuilderResult;

export function buildRunDistanceCapture(input: {
  runSubject: unknown;
  sourceKey: unknown;
  observedAt: unknown;
  distanceKm: unknown;
}): PersonLifeBuilderResult;

export function fiveKGuardrailDefinitionForGoal(
  definitions: unknown,
  goalDefinitionId: unknown,
): any | null;
