import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

import { ANNA_FARM_MEMBERSHIP_ID } from "@/lib/worker-delivery";
import { createAtlasAdminClient } from "@/lib/supabase/admin";

export const ANNA_WORKER_DAY_PILOT_COOKIE = "anna_worker_day_pilot";
export const ANNA_WORK_PASS_COOKIE = "elm_anna_work_pass";
export const ANNA_WORK_PASS_EXPIRES_AT = "2026-09-14T04:59:59.000Z";

const ANNA_WORK_PASS_HASH_SALT = "elm-worker-work-pass-v1";
const ANNA_WORK_PASS_HASH =
  "d38fa3d2faee0f9d6d3ca29e78dc69af506b91713a0c3357b9a8bfb8acec1243";

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

export function hashAnnaWorkPassToken(token: string) {
  return createHash("sha256")
    .update(`${ANNA_WORK_PASS_HASH_SALT}:${token}`)
    .digest("hex");
}

export function isAnnaWorkPassToken(token: string) {
  if (!token || Date.now() > new Date(ANNA_WORK_PASS_EXPIRES_AT).getTime()) {
    return false;
  }

  const candidate = Buffer.from(hashAnnaWorkPassToken(token), "hex");
  const expected = Buffer.from(ANNA_WORK_PASS_HASH, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export async function getAnnaPilotSessionToken() {
  const cookieStore = await cookies();
  return cookieStore.get(ANNA_WORKER_DAY_PILOT_COOKIE)?.value ?? null;
}

export async function getAnnaPilotEditState() {
  const cookieStore = await cookies();
  const workPassToken = cookieStore.get(ANNA_WORK_PASS_COOKIE)?.value ?? null;

  if (workPassToken && isAnnaWorkPassToken(workPassToken)) {
    return {
      canEdit: true,
      access: "elm_work_pass" as const,
      expiresAt: ANNA_WORK_PASS_EXPIRES_AT,
    };
  }

  const rawToken = cookieStore.get(ANNA_WORKER_DAY_PILOT_COOKIE)?.value ?? null;
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
