import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const LEGACY_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const SECRET_KEYS = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
const SERVICE_KEY = LEGACY_SERVICE_ROLE ?? SECRET_KEYS.default;

const FARM_ID = "6a503d9f-4008-4ddb-b3f0-cc6ab825dc9f";
const DELIVERY_MEMBERSHIP_ID = "23e98e5e-16ca-40d8-872c-c77e06baa167";
const STATIC_URL = `${SUPABASE_URL}/storage/v1/object/public/anna-worker-day/index.html`;
const COOKIE = "anna_worker_day_pilot";
const COOKIE_PATH = "/functions/v1/anna-worker-day";
const ELM_TIME_ZONE = "America/Chicago";
const MAX_BODY_BYTES = 4096;
const MAX_TITLE_LENGTH = 240;

if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Missing Supabase server configuration.");

const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  db: { schema: "atlas" },
});

const headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
  });
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function elmDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ELM_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function formatElmDay(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: ELM_TIME_ZONE,
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function sessionCookie(request: Request) {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === COOKIE) return decodeURIComponent(value.join("="));
  }
  return null;
}

async function editSession(request: Request) {
  const token = sessionCookie(request);
  if (!token) return null;
  const { data, error } = await db.rpc("worker_delivery_pilot_session_status_v1", {
    p_session_token_hash: await sha256(token),
  });
  if (error || !data?.ok || data.membershipId !== DELIVERY_MEMBERSHIP_ID) return null;
  return { token, ...data };
}

async function workerDay(today = elmDate()) {
  const { data: projectionRows, error: projectionError } = await db
    .from("worker_week_projection")
    .select("id,planned_date,original_planned_date,title,plan_order,rollover_policy,delivery_key,delivery_payload")
    .eq("farm_id", FARM_ID)
    .eq("membership_id", DELIVERY_MEMBERSHIP_ID)
    .lte("planned_date", today)
    .order("planned_date", { ascending: true })
    .order("plan_order", { ascending: true });
  if (projectionError) throw projectionError;

  const eligible = (projectionRows ?? []).filter((row: any) =>
    row.planned_date === today || (row.planned_date < today && row.rollover_policy === "carry")
  );
  const projectionIds = eligible.map((row: any) => row.id);

  let sources: any[] = [];
  if (projectionIds.length) {
    const result = await db
      .from("worker_week_projection_sources")
      .select("projection_id,work_item_id,source_role")
      .in("projection_id", projectionIds);
    if (result.error) throw result.error;
    sources = result.data ?? [];
  }

  const workItemIds = [...new Set(sources.map((source: any) => source.work_item_id))];
  const workState = new Map<string, string>();
  if (workItemIds.length) {
    const result = await db.from("work_items").select("id,work_state").in("id", workItemIds);
    if (result.error) throw result.error;
    for (const work of result.data ?? []) workState.set(work.id, work.work_state);
  }

  let eventQuery = db
    .from("worker_delivery_pilot_events")
    .select("id,projection_id,event_kind,event_seq,effective_at,reported_title")
    .eq("delivery_membership_id", DELIVERY_MEMBERSHIP_ID)
    .order("event_seq", { ascending: true });
  eventQuery = projectionIds.length
    ? eventQuery.or(`projection_id.in.(${projectionIds.join(",")}),projection_id.is.null`)
    : eventQuery.is("projection_id", null);
  const eventResult = await eventQuery;
  if (eventResult.error) throw eventResult.error;

  const completionState = new Map<string, string>();
  const extras: Array<{ id: string; title: string }> = [];
  for (const event of eventResult.data ?? []) {
    if (event.projection_id && (event.event_kind === "done_reported" || event.event_kind === "completion_reopened")) {
      completionState.set(event.projection_id, event.event_kind);
    }
    if (!event.projection_id && event.event_kind === "unscheduled_work_reported" && elmDate(new Date(event.effective_at)) === today) {
      extras.push({ id: event.id, title: event.reported_title });
    }
  }

  const activeResult = await db
    .from("worker_delivery_pilot_active_attention")
    .select("projection_id")
    .eq("delivery_membership_id", DELIVERY_MEMBERSHIP_ID)
    .maybeSingle();
  if (activeResult.error) throw activeResult.error;

  const items = [];
  for (const row of eligible as any[]) {
    const required = sources.filter((source: any) => source.projection_id === row.id && source.source_role === "required");
    const requiredStates = required.map((source: any) => workState.get(source.work_item_id));
    const institutionallyCompleted = required.length > 0 && requiredStates.every((state: any) => state === "completed");
    const noLongerDeliverable = required.length > 0 && requiredStates.every((state: any) => state === "cancelled" || state === "superseded");
    const reportedCompleted = completionState.get(row.id) === "done_reported";
    const completed = institutionallyCompleted || reportedCompleted;

    if (row.planned_date < today && (completed || noLongerDeliverable)) continue;
    if (row.planned_date === today && noLongerDeliverable) continue;

    items.push({
      id: row.id,
      key: row.delivery_key ?? row.id,
      title: row.title,
      details: Array.isArray(row.delivery_payload?.details) ? row.delivery_payload.details : [],
      completed,
      institutionallyCompleted,
      reportedCompleted,
      active: activeResult.data?.projection_id === row.id,
    });
  }

  return { date: today, label: formatElmDay(today), items, extras };
}

Deno.serve(async (request: Request) => {
  try {
    const requestUrl = new URL(request.url);

    if (request.method === "GET" && requestUrl.searchParams.has("edit")) {
      const bootstrap = requestUrl.searchParams.get("edit") ?? "";
      if (bootstrap.length < 32 || bootstrap.length > 256) {
        return new Response("This edit link is invalid or expired.", { status: 403, headers });
      }

      const sessionToken = crypto.randomUUID() + crypto.randomUUID();
      const { data, error } = await db.rpc("redeem_worker_delivery_pilot_capability_v1", {
        p_bootstrap_token_hash: await sha256(bootstrap),
        p_session_token_hash: await sha256(sessionToken),
      });
      if (error || !data?.ok || data.membershipId !== DELIVERY_MEMBERSHIP_ID) {
        return new Response("This edit link is invalid or expired.", { status: 403, headers });
      }

      const responseHeaders = new Headers(headers);
      responseHeaders.set("Location", STATIC_URL);
      responseHeaders.append(
        "Set-Cookie",
        `${COOKIE}=${encodeURIComponent(sessionToken)}; Path=${COOKIE_PATH}; HttpOnly; Secure; SameSite=Strict; Max-Age=1209600`,
      );
      return new Response(null, { status: 303, headers: responseHeaders });
    }

    const session = await editSession(request);

    if (request.method === "GET") {
      const day = await workerDay();
      return json({ ok: true, ...day, canEdit: Boolean(session) });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers });
    }
    if (!session) return json({ ok: false, code: "unauthorized" }, 401);

    const origin = request.headers.get("origin");
    if (origin && origin !== requestUrl.origin) return json({ ok: false, code: "origin_mismatch" }, 403);
    if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
      return json({ ok: false, code: "invalid_content_type" }, 415);
    }

    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      return json({ ok: false, code: "body_too_large" }, 413);
    }

    let body: any;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return json({ ok: false, code: "invalid_json" }, 400);
    }

    const allowed = new Set(["start", "stop", "done", "reopen", "switch_finish", "switch_stop", "report_unscheduled"]);
    if (!allowed.has(body.action)) return json({ ok: false, code: "unsupported_action" }, 400);

    if (body.effectiveAt != null) {
      const effectiveMs = Date.parse(String(body.effectiveAt));
      if (Number.isNaN(effectiveMs) || effectiveMs > Date.now() + 60_000) {
        return json({ ok: false, code: "invalid_effective_at" }, 400);
      }
    }

    if (body.action === "report_unscheduled") {
      const title = String(body.reportedTitle ?? "").trim();
      if (!title) return json({ ok: false, code: "title_required" }, 400);
      if (title.length > MAX_TITLE_LENGTH) return json({ ok: false, code: "title_too_long" }, 400);
      body.reportedTitle = title;
    } else {
      const projectionId = String(body.projectionId ?? "");
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(projectionId)) {
        return json({ ok: false, code: "invalid_projection_id" }, 400);
      }
      const day = await workerDay();
      if (!day.items.some((item: any) => item.id === projectionId)) {
        return json({ ok: false, code: "not_delivered_today" }, 403);
      }
    }

    const { data, error } = await db.rpc("worker_delivery_pilot_transition_v1", {
      p_session_token_hash: await sha256(session.token),
      p_action: body.action,
      p_projection_id: body.projectionId ?? null,
      p_effective_at: body.effectiveAt ?? null,
      p_reported_title: body.reportedTitle ?? null,
    });
    if (error) throw error;

    const status = data?.ok
      ? 200
      : data?.code === "attention_conflict"
        ? 409
        : data?.code === "unauthorized"
          ? 401
          : 400;
    return json(data ?? { ok: false, code: "empty_transition_result" }, status);
  } catch (error) {
    console.error("anna-worker-day", error);
    return json({ ok: false, code: "worker_day_unavailable" }, 500);
  }
});
