import { NextResponse } from "next/server";

import {
  atlasApiError,
  readAtlasJsonBody,
  requireAtlasApiAccess,
} from "@/lib/atlas/api-access";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type RpcError = { code?: string; message?: string };
type NotificationAction = "done" | "snooze";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function rpcError(error: RpcError) {
  if (error.code === "42501") {
    return atlasApiError(403, "notification_action_forbidden", "This notification can no longer be changed by this account.");
  }
  if (error.code === "P0002") {
    return atlasApiError(404, "notification_not_found", "The Atlas notification was not found.");
  }
  if (error.code === "22023") {
    return atlasApiError(400, "notification_action_rejected", "The notification action was rejected.");
  }
  return atlasApiError(500, "notification_action_failed", "Atlas could not complete the notification action.");
}

export async function POST(request: Request) {
  if (request.headers.get("x-atlas-intent") !== "notification-action-v1") {
    return atlasApiError(400, "notification_action_intent_required", "A valid Atlas notification intent is required.");
  }

  let body: Record<string, unknown>;
  try {
    body = await readAtlasJsonBody(request);
  } catch {
    return atlasApiError(400, "invalid_notification_action", "The notification action request is invalid.");
  }

  const momentId = typeof body.notificationMomentId === "string"
    ? body.notificationMomentId.trim()
    : "";
  const action = body.action === "done" || body.action === "snooze"
    ? body.action as NotificationAction
    : null;
  const requestedDelay = Number(body.delayMinutes);
  const delayMinutes = action === "snooze" && Number.isFinite(requestedDelay)
    ? Math.max(15, Math.min(Math.round(requestedDelay), 1440))
    : 300;

  if (!uuidPattern.test(momentId) || !action) {
    return atlasApiError(400, "invalid_notification_action", "A notification, and either Done or Remind Later, are required.");
  }

  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("handle_task_notification_action_v1", {
    p_moment_id: momentId,
    p_action: action,
    p_delay_minutes: delayMinutes,
  });

  if (error) return rpcError(error);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return atlasApiError(500, "invalid_notification_action_result", "Atlas returned an invalid notification result.");
  }

  return privateJson({ ...(data as Record<string, unknown>), ok: true });
}
