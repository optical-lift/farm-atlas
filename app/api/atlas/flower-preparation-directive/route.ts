import { NextRequest, NextResponse } from "next/server";

import { requireAtlasApiAccess } from "@/lib/atlas/api-access";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OUTPUT_KINDS = new Set(["bundle", "bouquet", "posy", "lobby_arrangement"]);

type RpcError = { code?: string; message?: string };
type LineBody = {
  cropProfileId?: unknown;
  productLabel?: unknown;
  outputKind?: unknown;
  requestedQuantity?: unknown;
  stemsPerUnit?: unknown;
  note?: unknown;
};
type Body = {
  taskId?: unknown;
  lines?: unknown;
  note?: unknown;
  idempotencyKey?: unknown;
};

function clean(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function integer(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value);
  return null;
}
function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, max-age=0, must-revalidate", "X-Atlas-Write-Path": "flower-preparation-directive-v1" } });
}
function rpcFailure(error: RpcError) {
  if (error.code === "42501") return privateJson({ ok: false, error: error.message || "Owner authority is required." }, 403);
  if (error.code === "P0002") return privateJson({ ok: false, error: "Direct Harvest task was not found." }, 404);
  if (["22023", "22P02", "55000"].includes(error.code || "")) return privateJson({ ok: false, error: error.message || "Harvest direction was rejected." }, 400);
  console.error("Flower preparation directive failed.", error);
  return privateJson({ ok: false, error: "Harvest direction failed." }, 500);
}

export async function POST(request: NextRequest) {
  const requestOrigin = request.headers.get("origin");
  if (!requestOrigin || requestOrigin !== request.nextUrl.origin) return privateJson({ ok: false, error: "Harvest direction requires a same-origin Atlas request." }, 403);

  const authorized = await requireAtlasApiAccess({ allowedRoles: ["owner", "manager"] });
  if (!authorized.ok) return authorized.response;

  let body: Body;
  try { body = await request.json() as Body; }
  catch { return privateJson({ ok: false, error: "A JSON harvest direction is required." }, 400); }

  const taskId = clean(body.taskId);
  const idempotencyKey = clean(body.idempotencyKey);
  const directiveNote = clean(body.note) || null;
  if (!UUID_PATTERN.test(taskId)) return privateJson({ ok: false, error: "A valid Direct Harvest task is required." }, 400);
  if (!idempotencyKey || idempotencyKey.length > 160) return privateJson({ ok: false, error: "A valid directive idempotency key is required." }, 400);
  if (directiveNote && directiveNote.length > 4000) return privateJson({ ok: false, error: "Directive note must be 4000 characters or fewer." }, 400);
  if (!Array.isArray(body.lines) || body.lines.length < 1 || body.lines.length > 12) return privateJson({ ok: false, error: "Add between 1 and 12 order lines." }, 400);

  const lines = [] as Array<Record<string, unknown>>;
  for (const raw of body.lines) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return privateJson({ ok: false, error: "Every order line must be an object." }, 400);
    const line = raw as LineBody;
    const productLabel = clean(line.productLabel);
    const outputKind = clean(line.outputKind).toLowerCase();
    const requestedQuantity = integer(line.requestedQuantity);
    const note = clean(line.note) || null;
    const cropProfileId = clean(line.cropProfileId) || null;
    const stemsPerUnit = line.stemsPerUnit === null || line.stemsPerUnit === undefined ? null : integer(line.stemsPerUnit);

    if (!productLabel || productLabel.length > 160) return privateJson({ ok: false, error: "Each order needs a flower / product name." }, 400);
    if (["fq", "florist quality", "sp", "spent"].includes(productLabel.toLowerCase())) return privateJson({ ok: false, error: "FQ/SP are harvest condition labels, not flower identity." }, 400);
    if (!OUTPUT_KINDS.has(outputKind)) return privateJson({ ok: false, error: "Pack as Bunch, Bouquet, Posy, or Arrangement." }, 400);
    if (requestedQuantity === null || requestedQuantity < 1 || requestedQuantity > 10000) return privateJson({ ok: false, error: "QTY must be a whole number between 1 and 10000." }, 400);
    if (cropProfileId && !UUID_PATTERN.test(cropProfileId)) return privateJson({ ok: false, error: "Harvest crop identity is invalid." }, 400);
    if (outputKind === "bundle" && (stemsPerUnit === null || stemsPerUnit < 1 || stemsPerUnit > 1000)) return privateJson({ ok: false, error: "Bunches need a valid stems-per-bunch count." }, 400);
    if (outputKind !== "bundle" && stemsPerUnit !== null) return privateJson({ ok: false, error: "Only bunches use stems per bunch." }, 400);
    if (note && note.length > 1000) return privateJson({ ok: false, error: "Order-line notes must be 1000 characters or fewer." }, 400);

    lines.push({ cropProfileId, productLabel, outputKind, requestedQuantity, stemsPerUnit, note });
  }

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("record_flower_preparation_directive_v1", {
    p_owner_review_task_id: taskId,
    p_lines: lines,
    p_note: directiveNote,
    p_idempotency_key: idempotencyKey,
  });
  if (error) return rpcFailure(error as RpcError);
  if (!data || typeof data !== "object" || Array.isArray(data)) return privateJson({ ok: false, error: "Atlas returned an invalid harvest direction result." }, 500);
  return privateJson({ ...(data as Record<string, unknown>), ok: true });
}
