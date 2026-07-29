import "server-only";

import { cookies } from "next/headers";

import { getAtlasSession } from "@/lib/atlas/session";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const ATLAS_OPERATOR_COOKIE = "atlas_operator_membership";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AtlasOperatorIdentity = {
  userId: string;
  membershipId: string;
  role: "owner" | "manager" | "farm_hand";
  workerKey: string | null;
  displayName: string;
  permissions?: Record<string, unknown>;
};

export type AtlasOperatorOption = {
  membershipId: string;
  farmId: string;
  role: "owner" | "manager" | "farm_hand";
  workerKey: string | null;
  displayName: string;
  isActor: boolean;
};

export type AtlasOwnerOperatorContext = {
  available: true;
  isOperating: boolean;
  farmId: string;
  farmKey: string | null;
  farmName: string;
  actor: AtlasOperatorIdentity;
  effective: AtlasOperatorIdentity;
  options: AtlasOperatorOption[];
};

type OperatorRpcError = { code?: string; message?: string };

function isUuid(value: string | null | undefined): value is string {
  return Boolean(value && UUID_PATTERN.test(value));
}

function normalizeContext(value: unknown): AtlasOwnerOperatorContext | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const context = value as Partial<AtlasOwnerOperatorContext>;
  if (!context.available || !context.actor || !context.effective || !context.farmId) return null;
  return {
    ...context,
    available: true,
    isOperating: Boolean(context.isOperating),
    farmKey: context.farmKey ?? null,
    options: Array.isArray(context.options) ? context.options : [],
  } as AtlasOwnerOperatorContext;
}

async function callOperatorContext(requestedMembershipId: string | null) {
  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("owner_operator_context_v1", {
    p_effective_membership_id: requestedMembershipId,
  });
  return { context: normalizeContext(data), error: error as OperatorRpcError | null };
}

export async function resolveAtlasOwnerOperatorContext(
  requestedMembershipId?: string | null,
): Promise<AtlasOwnerOperatorContext | null> {
  const session = await getAtlasSession();
  if (!session?.memberships.some((membership) => membership.role === "owner")) return null;

  let candidate: string | null;
  if (requestedMembershipId === undefined) {
    const cookieStore = await cookies();
    const cookieValue = cookieStore.get(ATLAS_OPERATOR_COOKIE)?.value ?? null;
    candidate = isUuid(cookieValue) ? cookieValue : null;
  } else {
    candidate = isUuid(requestedMembershipId) ? requestedMembershipId : null;
  }

  const first = await callOperatorContext(candidate);
  if (first.context) return first.context;

  if (candidate && first.error?.code === "42501") {
    const fallback = await callOperatorContext(null);
    return fallback.context;
  }

  return null;
}

export async function readAtlasOwnerOperatorContext() {
  return resolveAtlasOwnerOperatorContext(undefined);
}

export function effectiveOperatorMembershipId(context: AtlasOwnerOperatorContext | null) {
  return context?.isOperating ? context.effective.membershipId : null;
}
