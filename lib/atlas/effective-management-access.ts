import "server-only";

import { redirect } from "next/navigation";

import { readAtlasOwnerOperatorContext } from "@/lib/atlas/operator-context";
import { getAtlasSession, type AtlasFarmRole } from "@/lib/atlas/session";

export type AtlasEffectiveManagementAccess = {
  farmId: string;
  farmName: string;
  role: "owner" | "manager";
  displayName: string;
  operatorMode: boolean;
};

function isManagementRole(role: AtlasFarmRole | null | undefined): role is "owner" | "manager" {
  return role === "owner" || role === "manager";
}

export async function requireAtlasEffectiveManagementAccess(): Promise<AtlasEffectiveManagementAccess> {
  const [session, operatorContext] = await Promise.all([
    getAtlasSession(),
    readAtlasOwnerOperatorContext(),
  ]);
  if (!session) redirect("/login");

  if (operatorContext?.isOperating) {
    const effective = operatorContext.effective;
    if (!effective.farmId || !effective.farmName || !isManagementRole(effective.farmRole)) redirect("/");
    return {
      farmId: effective.farmId,
      farmName: effective.farmName,
      role: effective.farmRole,
      displayName: effective.displayName,
      operatorMode: true,
    };
  }

  const membership = session.memberships.find((row) => row.farmId === session.activeFarmId && isManagementRole(row.role))
    ?? session.memberships.find((row) => isManagementRole(row.role));
  if (!membership?.farmName) redirect("/");
  return {
    farmId: membership.farmId,
    farmName: membership.farmName,
    role: membership.role,
    displayName: session.displayName,
    operatorMode: false,
  };
}
