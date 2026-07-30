import { NextResponse } from "next/server";

import type { AtlasPushApiResponse, AtlasPushSetup } from "@/lib/atlas/push-contract";
import { atlasApiError, readAtlasJsonBody } from "@/lib/atlas/api-access";
import { getAtlasSession } from "@/lib/atlas/session";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function privateJson(body: AtlasPushApiResponse, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Atlas-Write-Path": "web-push-v1",
    },
  });
}

async function actualUserFarmId() {
  const session = await getAtlasSession();
  if (!session) return null;
  return session.activeFarmId ?? session.memberships[0]?.farmId ?? null;
}

async function readSetup(farmId: string) {
  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("web_push_setup_v1", { p_farm_id: farmId });
  if (error) throw error;
  return data as AtlasPushSetup;
}

function text(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

export async function GET() {
  const farmId = await actualUserFarmId();
  if (!farmId) return privateJson({ ok: false, error: "Sign in to an active farm first." }, 401);

  try {
    return privateJson({ ok: true, setup: await readSetup(farmId) });
  } catch (error) {
    console.error("Atlas Web Push setup read failed:", error);
    return privateJson({ ok: false, error: "Farm Alert setup could not be loaded." }, 500);
  }
}

export async function POST(request: Request) {
  if (request.headers.get("x-atlas-intent") !== "web-push-v1") {
    return atlasApiError(400, "push_intent_required", "A valid Farm Alert intent is required.");
  }

  const farmId = await actualUserFarmId();
  if (!farmId) return atlasApiError(401, "sign_in_required", "Sign in to an active farm first.");

  let body: Record<string, unknown>;
  try {
    body = await readAtlasJsonBody(request);
  } catch {
    return atlasApiError(400, "invalid_push_request", "The Farm Alert request is invalid.");
  }

  const action = text(body.action, 32);
  const supabase = await createAtlasServerClient();

  try {
    if (action === "register") {
      const subscription = body.subscription && typeof body.subscription === "object"
        ? body.subscription as Record<string, unknown>
        : null;
      const keys = subscription?.keys && typeof subscription.keys === "object"
        ? subscription.keys as Record<string, unknown>
        : null;
      const endpoint = text(subscription?.endpoint, 4096);
      const p256dh = text(keys?.p256dh, 512);
      const authKey = text(keys?.auth, 512);
      if (!endpoint || !p256dh || !authKey) {
        return atlasApiError(400, "push_subscription_incomplete", "This device did not provide a complete push subscription.");
      }

      const expirationValue = subscription?.expirationTime;
      const expirationTime = typeof expirationValue === "number" && Number.isFinite(expirationValue)
        ? new Date(expirationValue).toISOString()
        : null;
      const { data, error } = await supabase.rpc("register_push_subscription_v1", {
        p_farm_id: farmId,
        p_endpoint: endpoint,
        p_expiration_time: expirationTime,
        p_p256dh: p256dh,
        p_auth_key: authKey,
        p_device_label: text(body.deviceLabel, 120) || null,
        p_user_agent: text(body.userAgent, 1000) || null,
        p_time_zone: text(body.timeZone, 100) || "America/Chicago",
        p_send_test: body.sendTest !== false,
      });
      if (error) throw error;
      return privateJson({ ok: true, result: data as Record<string, unknown>, setup: await readSetup(farmId) });
    }

    if (action === "revoke") {
      const endpoint = text(body.endpoint, 4096);
      if (!endpoint) return atlasApiError(400, "push_endpoint_required", "The device endpoint is required.");
      const { data, error } = await supabase.rpc("revoke_push_subscription_v1", {
        p_farm_id: farmId,
        p_endpoint: endpoint,
      });
      if (error) throw error;
      return privateJson({ ok: true, result: data as Record<string, unknown>, setup: await readSetup(farmId) });
    }

    if (action === "preferences") {
      const categories = body.categories && typeof body.categories === "object" && !Array.isArray(body.categories)
        ? body.categories
        : {};
      const quietEnabled = body.quietEnabled === true;
      const { data, error } = await supabase.rpc("update_notification_preferences_v1", {
        p_farm_id: farmId,
        p_enabled: body.enabled !== false,
        p_categories: categories,
        p_quiet_start: quietEnabled ? text(body.quietStart, 8) || null : null,
        p_quiet_end: quietEnabled ? text(body.quietEnd, 8) || null : null,
        p_time_zone: text(body.timeZone, 100) || "America/Chicago",
      });
      if (error) throw error;
      return privateJson({ ok: true, result: data as Record<string, unknown>, setup: await readSetup(farmId) });
    }

    if (action === "test") {
      const { data, error } = await supabase.rpc("send_push_test_v1", { p_farm_id: farmId });
      if (error) throw error;
      return privateJson({ ok: true, result: data as Record<string, unknown>, setup: await readSetup(farmId) });
    }

    return atlasApiError(400, "invalid_push_action", "Choose register, revoke, preferences, or test.");
  } catch (error) {
    const rpc = error as { code?: string; message?: string };
    if (rpc.code === "42501") return atlasApiError(403, "push_forbidden", rpc.message || "Farm Alerts are not available for this account.");
    if (rpc.code === "22023") return atlasApiError(400, "push_rejected", rpc.message || "Atlas rejected that Farm Alert change.");
    console.error("Atlas Web Push mutation failed:", error);
    return atlasApiError(500, "push_failed", "Atlas could not update Farm Alerts.");
  }
}
