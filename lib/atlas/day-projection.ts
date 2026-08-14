import type { AtlasDaySequence } from "@/lib/atlas/day-sequence";

export type AtlasWorkerDayProjectionLens = "operator_lens" | "owner_direct" | "worker_self";

export type AtlasWorkerDayProjectionIdentity = {
  contractVersion: "atlas_projection_identity_v1";
  projectionType: "worker_day";
  farmId: string;
  membershipId: string;
  serviceDate: string;
  lens: AtlasWorkerDayProjectionLens;
  key: string;
};

export type AtlasWorkerDayProjection<TSequence extends AtlasDaySequence = AtlasDaySequence> = {
  contractVersion: "atlas_worker_day_projection_v1";
  identity: AtlasWorkerDayProjectionIdentity;
  revision: string;
  sequence: TSequence;
};

function stableProjectionValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableProjectionValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableProjectionValue(child)]),
  );
}

function projectionFingerprint(value: unknown) {
  const serialized = JSON.stringify(stableProjectionValue(value));
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < serialized.length; index += 1) {
    const code = serialized.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ code, 0x85ebca6b) >>> 0;
    second = (second + 0x9e3779b9 + index) >>> 0;
  }
  return `${first.toString(36).padStart(7, "0")}${second.toString(36).padStart(7, "0")}${serialized.length.toString(36)}`;
}

export function buildAtlasWorkerDayProjectionIdentity(input: {
  farmId: string;
  membershipId: string;
  serviceDate: string;
  lens: AtlasWorkerDayProjectionLens;
}): AtlasWorkerDayProjectionIdentity {
  const key = ["worker_day", input.farmId, input.membershipId, input.serviceDate, input.lens].join(":");
  return {
    contractVersion: "atlas_projection_identity_v1",
    projectionType: "worker_day",
    farmId: input.farmId,
    membershipId: input.membershipId,
    serviceDate: input.serviceDate,
    lens: input.lens,
    key,
  };
}

export function buildAtlasWorkerDayProjection<TSequence extends AtlasDaySequence>(input: {
  farmId: string;
  membershipId: string;
  serviceDate: string;
  lens: AtlasWorkerDayProjectionLens;
  sequence: TSequence;
}): AtlasWorkerDayProjection<TSequence> {
  const identity = buildAtlasWorkerDayProjectionIdentity(input);
  const { generatedAt: _generatedAt, ...revisionSequence } = input.sequence;
  return {
    contractVersion: "atlas_worker_day_projection_v1",
    identity,
    revision: `r1-${projectionFingerprint({ identity, sequence: revisionSequence })}`,
    sequence: input.sequence,
  };
}
