import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import {
  buildPersonalReminderCapture,
  buildPersonalReminderCompletionCapture,
} from "@/lib/atlas/personal-reminder-core.js";
import { getAtlasSession } from "@/lib/atlas/session";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type RpcError = { code?: string; message?: string };
type ReminderRequest = {
  action?: unknown;
  label?: unknown;
  note?: unknown;
  dueDate?: unknown;
  reminderId?: unknown;
};

type PersonClaim = {
  claimId?: string;
  claimType?: string;
  lifecycleState?: string;
  subject?: { domain?: string; kind?: string; id?: string };
  value?: Record<string, unknown> | null;
};

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
  });
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isReminderClaim(claim: PersonClaim, reminderId: string) {
  return claim.claimType === "personal_reminder"
    && claim.subject?.domain === "personal"
    && claim.subject?.kind === "reminder"
    && claim.subject?.id === reminderId
    && !["superseded", "expired", "rejected"].includes(claim.lifecycleState ?? "");
}

function rpcFailure(error: RpcError) {
  if (error.code === "42501") return privateJson({ ok: false, error: "Sign in required." }, 401);
  if (error.code === "22023" || error.code === "23514") {
    return privateJson({ ok: false, error: error.message ?? "Atlas rejected this private reminder." }, 400);
  }
  if (error.code === "23505" || error.code === "40001") {
    return privateJson({ ok: false, error: error.message ?? "This reminder changed. Refresh and try again." }, 409);
  }
  if (error.code === "PGRST202" || error.code === "42883" || error.code === "42P01") {
    return privateJson({ ok: false, error: "Private person reminders are not live in this database yet." }, 503);
  }
  console.error("Atlas private reminder RPC failed:", error);
  return privateJson({ ok: false, error: "Atlas could not update this private reminder." }, 500);
}

export async function POST(request: Request) {
  const session = await getAtlasSession();
  if (!session) return privateJson({ ok: false, error: "Sign in required." }, 401);

  let body: ReminderRequest;
  try {
    body = await request.json() as ReminderRequest;
  } catch {
    return privateJson({ ok: false, error: "Reminder payload must be valid JSON." }, 400);
  }

  const action = text(body.action);
  const supabase = await createAtlasServerClient();

  if (action === "create") {
    const reminderId = randomUUID();
    const dueDate = text(body.dueDate);
    const built = buildPersonalReminderCapture({
      reminderId,
      label: text(body.label),
      note: text(body.note),
      dueDate: dueDate || null,
      recordedAt: new Date().toISOString(),
    });
    if (!built.ok || !built.value) {
      return privateJson({ ok: false, error: built.error ?? "Invalid private reminder." }, 400);
    }

    const { data, error } = await supabase.rpc("record_person_claim_evidence_api_v1", {
      p_payload: built.value,
    });
    if (error) return rpcFailure(error as RpcError);
    return privateJson({ ok: true, action, reminderId, result: data }, 201);
  }

  if (action === "complete") {
    const reminderId = text(body.reminderId);
    if (!reminderId) return privateJson({ ok: false, error: "reminderId is required." }, 400);

    const { data, error } = await supabase.rpc("person_claim_evidence_state_api_v1");
    if (error) return rpcFailure(error as RpcError);
    const envelope = data && typeof data === "object" && !Array.isArray(data)
      ? data as { currentClaims?: PersonClaim[] }
      : {};
    const reminderClaims = (envelope.currentClaims ?? []).filter((claim) => isReminderClaim(claim, reminderId));
    const alreadyDone = reminderClaims.find((claim) => ["done", "completed", "dismissed"].includes(text(claim.value?.state)));
    if (alreadyDone) {
      return privateJson({ ok: true, action, reminderId, replayed: true });
    }

    const current = reminderClaims.find((claim) => !["done", "completed", "dismissed"].includes(text(claim.value?.state)));
    if (!current?.claimId || !current.value) {
      return privateJson({ ok: false, error: "That open private reminder was not found." }, 404);
    }

    const built = buildPersonalReminderCompletionCapture({
      reminderId,
      currentClaimId: current.claimId,
      currentValue: current.value,
      completedAt: new Date().toISOString(),
    });
    if (!built.ok || !built.value) {
      return privateJson({ ok: false, error: built.error ?? "Atlas could not complete this reminder." }, 400);
    }

    const completion = await supabase.rpc("record_person_claim_evidence_api_v1", {
      p_payload: built.value,
    });
    if (completion.error) return rpcFailure(completion.error as RpcError);
    return privateJson({ ok: true, action, reminderId, result: completion.data });
  }

  return privateJson({ ok: false, error: "Unsupported private reminder action." }, 400);
}
