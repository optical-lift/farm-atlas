import "server-only";

import { cookies } from "next/headers";

import type { AtlasFarmRole, AtlasOrganizationRole } from "@/lib/atlas/session";
import { getAtlasSession } from "@/lib/atlas/session";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const ATLAS_OPERATOR_COOKIE = "atlas_operator_account";
export const LEGACY_ATLAS_OPERATOR_COOKIE = "atlas_operator_membership";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AtlasOperatorIdentity = {
  accountId: string;
  userId: string;
  membershipId: string | null;
  farmMembershipId: string | null;
  farmId: string | null;
  farmKey: string | null;
  farmName: string | null;
  role: AtlasFarmRole | AtlasOrganizationRole | null;
  farmRole: AtlasFarmRole | null;
  workerKey: string | null;
  organizationMembershipId: string | null;
  organizationId: string | null;
  organizationKey: string | null;
  organizationName: string | null;
  organizationRole: AtlasOrganizationRole | null;
  displayName: string;
  scopeKind: "farm" | "organization" | "universal";
  permissions?: Record<string, unknown>;
};

export type AtlasOperatorOption = {
  accountId: string;
  membershipId: string | null;
  farmMembershipId: string | null;
  organizationMembershipId: string | null;
  displayName: string;
  scopeKind: "farm" | "organization" | "universal";
  isActor: boolean;
};

export type AtlasOwnerOperatorContext = {
  available: true;
  isOperating: boolean;
  actor: AtlasOperatorIdentity;
  effective: AtlasOperatorIdentity;
  options: AtlasOperatorOption[];
};

type OperatorRpcError = { code?: string; message?: string };

function isUuid(value: string | null | undefined): value is string {
  return Boolean(value && UUID_PATTERN.test(value));
}

function normalizeIdentity(value: unknown): AtlasOperatorIdentity | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const identity = value as Partial<AtlasOperatorIdentity>;
  const accountId = identity.accountId ?? identity.userId;
  if (!accountId || !identity.userId || !identity.displayName) return null;
  return {
    accountId,
    userId: identity.userId,
    membershipId: identity.membershipId ?? null,
    farmMembershipId: identity.farmMembershipId ?? null,
    farmId: identity.farmId ?? null,
    farmKey: identity.farmKey ?? null,
    farmName: identity.farmName ?? null,
    role: identity.role ?? null,
    farmRole: identity.farmRole ?? null,
    workerKey: identity.workerKey ?? null,
    organizationMembershipId: identity.organizationMembershipId ?? null,
    organizationId: identity.organizationId ?? null,
    organizationKey: identity.organizationKey ?? null,
    organizationName: identity.organizationName ?? null,
    organizationRole: identity.organizationRole ?? null,
    displayName: identity.displayName,
    scopeKind: identity.scopeKind ?? (identity.farmMembershipId ? "farm" : "organization"),
    permissions: identity.permissions ?? {},
  };
}

function normalizeContext(value: unknown): AtlasOwnerOperatorContext | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as {
    available?: unknown;
    isOperating?: unknown;
    actor?: unknown;
    effective?: unknown;
    options?: unknown;
  };
  const actor = normalizeIdentity(raw.actor);
  const effective = normalizeIdentity(raw.effective);
  if (!raw.available || !actor || !effective) return null;
  const options = Array.isArray(raw.options)
    ? raw.options.filter((option): option is AtlasOperatorOption => Boolean(
        option
        && typeof option === "object"
        && !Array.isArray(option)
        && typeof (option as AtlasOperatorOption).accountId === "string"
        && typeof (option as AtlasOperatorOption).displayName === "string",
      ))
    : [];
  return {
    available: true,
    isOperating: Boolean(raw.isOperating),
    actor,
    effective,
    options,
  };
}

async function callOperatorContext(requestedAccountId: string | null) {
  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("owner_operator_accounts_v1", {
    p_effective_account_id: requestedAccountId,
  });
  return { context: normalizeContext(data), error: error as OperatorRpcError | null };
}

export async function resolveAtlasOwnerOperatorContext(
  requestedAccountId?: string | null,
): Promise<AtlasOwnerOperatorContext | null> {
  const session = await getAtlasSession();
  const canOperate = Boolean(session?.memberships.some((membership) => membership.role === "owner")
    || session?.organizationMemberships.some((membership) => membership.role === "owner"));
  if (!session || !canOperate) return null;

  let candidate: string | null;
  if (requestedAccountId === undefined) {
    const cookieStore = await cookies();
    const cookieValue = cookieStore.get(ATLAS_OPERATOR_COOKIE)?.value
      ?? cookieStore.get(LEGACY_ATLAS_OPERATOR_COOKIE)?.value
      ?? null;
    candidate = isUuid(cookieValue) ? cookieValue : null;
  } else {
    candidate = isUuid(requestedAccountId) ? requestedAccountId : null;
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

export function effectiveOperatorAccountId(context: AtlasOwnerOperatorContext | null) {
  return context?.isOperating ? context.effective.accountId : null;
}

export function effectiveOperatorMembershipId(context: AtlasOwnerOperatorContext | null) {
  return context?.isOperating ? context.effective.farmMembershipId : null;
}
