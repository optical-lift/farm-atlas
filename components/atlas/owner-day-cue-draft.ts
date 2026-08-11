export type OwnerDayCueKind = "briefing" | "requirement" | "observation" | "somatic" | "result";
export type OwnerDayCueAnchorKind = "first_open" | "before_task" | "after_task" | "at_time";
export type OwnerDayCueRecoveryPolicy = "refresh" | "expire" | "persist" | "block";

export type OwnerDayCueDraftPayload = {
  cueId?: string;
  serviceDate: string;
  cueKind: OwnerDayCueKind;
  anchorKind: OwnerDayCueAnchorKind;
  anchorTaskId: string | null;
  scheduledAt: string | null;
  title: string;
  body: string | null;
  payload: Record<string, unknown>;
  resultContract: Record<string, unknown>;
  recoveryPolicy: OwnerDayCueRecoveryPolicy;
};

export type OwnerDayCueDraftEdit =
  | { draftKey: string; kind: "upsert"; cue: OwnerDayCueDraftPayload }
  | { draftKey: string; kind: "delete"; cueId: string };

export function cueDraftKey(cueId: string) {
  return cueId.startsWith("draft:") ? cueId : `cue:${cueId}`;
}
