import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

type DeliveryRow = {
  delivery_id: string;
  outbox_id: string;
  subscription_id: string;
  endpoint: string;
  p256dh: string;
  auth_key: string;
  payload: Record<string, unknown>;
  urgency: "very-low" | "low" | "normal" | "high";
  ttl_seconds: number;
  topic: string;
};

type DispatchConfig = {
  vapidSubject: string;
  vapidPublicKey: string;
  vapidPrivateKey: string;
};

const jsonHeaders = { "Content-Type": "application/json", "Cache-Control": "no-store" };

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function errorStatus(error: unknown) {
  if (!error || typeof error !== "object") return 0;
  const value = error as { statusCode?: unknown; status?: unknown };
  const candidate = Number(value.statusCode ?? value.status ?? 0);
  return Number.isFinite(candidate) ? candidate : 0;
}

function errorBody(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "Web Push delivery failed.";
  }
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ ok: false, error: "POST required." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const dispatchToken = request.headers.get("x-atlas-dispatch-token")?.trim() ?? "";
  if (!supabaseUrl || !serviceRoleKey || !dispatchToken) {
    return json({ ok: false, error: "Dispatcher authentication failed." }, 401);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: configData, error: configError } = await supabase.rpc(
    "web_push_dispatch_config_v1",
    { p_dispatch_token: dispatchToken },
  );
  const config = configData as DispatchConfig | null;
  if (configError || !config?.vapidPrivateKey || !config?.vapidPublicKey || !config?.vapidSubject) {
    return json({ ok: false, error: "Dispatcher authentication failed." }, 401);
  }

  let requestedLimit = 25;
  try {
    const body = await request.json() as { limit?: unknown };
    const value = Number(body.limit);
    if (Number.isInteger(value)) requestedLimit = Math.min(Math.max(value, 1), 50);
  } catch {
    // An empty body uses the bounded default.
  }

  webpush.setVapidDetails(
    config.vapidSubject,
    config.vapidPublicKey,
    config.vapidPrivateKey,
  );

  const { data: claimedData, error: claimError } = await supabase.rpc(
    "claim_notification_delivery_batch_v1",
    { p_limit: requestedLimit, p_lease_seconds: 120 },
  );
  if (claimError) {
    console.error("Atlas push claim failed", claimError);
    return json({ ok: false, error: "Notification deliveries could not be claimed." }, 500);
  }

  const deliveries = (claimedData ?? []) as DeliveryRow[];
  let sent = 0;
  let stale = 0;
  let retried = 0;
  let failed = 0;

  for (const delivery of deliveries) {
    try {
      await webpush.sendNotification(
        {
          endpoint: delivery.endpoint,
          keys: {
            p256dh: delivery.p256dh,
            auth: delivery.auth_key,
          },
        },
        JSON.stringify(delivery.payload),
        {
          TTL: Math.min(Math.max(Number(delivery.ttl_seconds) || 86_400, 60), 604_800),
          urgency: delivery.urgency || "normal",
          topic: delivery.topic || undefined,
        },
      );

      sent += 1;
      await supabase.rpc("record_notification_delivery_result_v1", {
        p_delivery_id: delivery.delivery_id,
        p_success: true,
        p_status_code: 201,
        p_response_body: "Accepted by push service.",
        p_stale: false,
        p_retryable: false,
      });
    } catch (caught) {
      const status = errorStatus(caught);
      const isStale = status === 404 || status === 410;
      const retryable = status === 0 || status === 408 || status === 429 || status >= 500;
      if (isStale) stale += 1;
      else if (retryable) retried += 1;
      else failed += 1;

      const { error: recordError } = await supabase.rpc(
        "record_notification_delivery_result_v1",
        {
          p_delivery_id: delivery.delivery_id,
          p_success: false,
          p_status_code: status || null,
          p_response_body: errorBody(caught).slice(0, 2000),
          p_stale: isStale,
          p_retryable: retryable,
        },
      );
      if (recordError) console.error("Atlas push result recording failed", recordError);
    }
  }

  return json({
    ok: true,
    claimed: deliveries.length,
    sent,
    stale,
    retried,
    failed,
  });
});
