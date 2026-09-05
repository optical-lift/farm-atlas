import "server-only";

import { createHash } from "node:crypto";
import { cookies } from "next/headers";

import { ANNA_FARM_MEMBERSHIP_ID } from "@/lib/worker-delivery";
import { createAtlasAdminClient } from "@/lib/supabase/admin";

export const ANNA_WORKER_DAY_PILOT_COOKIE = "anna_worker_day_pilot";

type PilotSessionStatus = {
  ok?: boolean;
  sessionId?: string;
  membershipId?: string;
  expiresAt?: string;
  code?: string;
};

export function hashAnnaPilotToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function getAnnaPilotSessionToken() {
  const cookieStore = await cookies();
  return cookieStore.get(ANNA_WORKER_DAY_PILOT_COOKIE)?.value ?? null;
}

export async function getAnnaPilotEditState() {
  const rawToken = await getAnnaPilotSessionToken();
  if (!rawToken) {
    return { canEdit: false };
  }

  const supabase = createAtlasAdminClient();
  const { data, error } = await supabase.rpc(
    "worker_delivery_pilot_session_status_v1",
    {
      p_session_token_hash: hashAnnaPilotToken(rawToken),
    },
  );

  if (error) {
    console.error("Anna Worker Day pilot session read failed:", error);
    return { canEdit: false };
  }

  const status = (data ?? {}) as PilotSessionStatus;
  return {
    canEdit:
      status.ok === true &&
      status.membershipId === ANNA_FARM_MEMBERSHIP_ID,
  };
}
