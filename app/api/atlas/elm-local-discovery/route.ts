import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import {
  atlasApiError,
  readAtlasJsonBody,
  requireAtlasApiAccess,
} from "@/lib/atlas/api-access";
import { createAtlasAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BATCH_SIZE = 40;
const DEFAULT_BATCH_SIZE = 24;

type JsonObject = Record<string, unknown>;
type RpcError = { code?: string; message?: string };

type DiscoveryRecord = {
  source_url?: unknown;
  source_title?: unknown;
  publisher?: unknown;
  subject_kind?: unknown;
  organization_name?: unknown;
  fields?: unknown;
};

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function discoveryError(error: RpcError, fallback: string) {
  if (error.code === "42501") {
    return atlasApiError(403, "elm_local_discovery_forbidden", error.message || fallback);
  }
  if (error.code === "P0002") {
    return atlasApiError(404, "elm_local_discovery_not_found", error.message || fallback);
  }
  if (error.code === "22023") {
    return atlasApiError(400, "elm_local_discovery_rejected", error.message || fallback);
  }
  return atlasApiError(500, "elm_local_discovery_failed", error.message || fallback);
}

function normalizedBatchSize(value: unknown) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_BATCH_SIZE;
  return Math.min(parsed, MAX_BATCH_SIZE);
}

function canonicalUrl(raw: string) {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith("utm_")) url.searchParams.delete(key);
    }
    if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.slice(0, -1);
    }
    return url.toString();
  } catch {
    return null;
  }
}

function collectCitationUrls(value: unknown, found = new Map<string, { url: string; title: string | null }>()) {
  if (Array.isArray(value)) {
    for (const item of value) collectCitationUrls(item, found);
    return found;
  }
  if (!value || typeof value !== "object") return found;

  const object = value as JsonObject;
  const annotationType = text(object.type);
  const rawUrl = text(object.url);
  if (annotationType.includes("url_citation") && rawUrl) {
    const key = canonicalUrl(rawUrl);
    if (key) found.set(key, { url: rawUrl, title: text(object.title) || null });
  }

  for (const nested of Object.values(object)) collectCitationUrls(nested, found);
  return found;
}

function collectOutputText(value: unknown): string[] {
  const output: string[] = [];
  if (Array.isArray(value)) {
    for (const item of value) output.push(...collectOutputText(item));
    return output;
  }
  if (!value || typeof value !== "object") return output;

  const object = value as JsonObject;
  if (object.type === "output_text" && typeof object.text === "string") {
    output.push(object.text);
  }
  for (const nested of Object.values(object)) output.push(...collectOutputText(nested));
  return output;
}

function parseJsonPayload(raw: string) {
  const trimmed = raw.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const firstBrace = unfenced.indexOf("{");
  const lastBrace = unfenced.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) return null;
  try {
    return asObject(JSON.parse(unfenced.slice(firstBrace, lastBrace + 1)));
  } catch {
    return null;
  }
}

function explicitFields(value: unknown) {
  const object = asObject(value);
  if (!object) return {} as JsonObject;
  const result: JsonObject = {};
  for (const [key, fieldValue] of Object.entries(object)) {
    const cleanKey = key.trim();
    if (!cleanKey || fieldValue === null || fieldValue === undefined) continue;
    if (typeof fieldValue === "string") {
      const cleanValue = fieldValue.trim();
      if (!cleanValue) continue;
      result[cleanKey] = cleanValue;
      continue;
    }
    if (typeof fieldValue === "number" || typeof fieldValue === "boolean") {
      result[cleanKey] = fieldValue;
      continue;
    }
    if (Array.isArray(fieldValue) && fieldValue.length > 0) {
      result[cleanKey] = fieldValue;
      continue;
    }
    if (asObject(fieldValue) && Object.keys(fieldValue as JsonObject).length > 0) {
      result[cleanKey] = fieldValue;
    }
  }
  return result;
}

function sourceRecordKey(sourceUrl: string, subjectKind: string, fields: JsonObject) {
  return createHash("sha256")
    .update(JSON.stringify({ sourceUrl: canonicalUrl(sourceUrl) ?? sourceUrl, subjectKind, fields }))
    .digest("hex");
}

function gatewayPrompt(context: JsonObject, batchSize: number) {
  const requestedFields = Array.isArray(context.requested_fields)
    ? context.requested_fields.filter((value): value is string => typeof value === "string")
    : [];
  const parameters = asObject(context.parameters) ?? {};
  const loopState = asObject(context.loop_state) ?? {};

  return [
    "You are the Elm Local mixed-batch evidence gatherer.",
    "Your job is to search current public web reality and GATHER explicit evidence. Do not decide whether a publisher wants the information used later; source-use notices are metadata, not collection filters.",
    "Return only evidence actually supported by pages you opened through web search. Never infer, construct, guess, or pattern-generate a missing value.",
    "Missing fields must be omitted. Conflicts may be returned as separate source-backed records; do not silently choose one.",
    "Every record must have exactly one source_url that you actually visited and can cite.",
    "Prefer current first-party/current authoritative sources when they are productive, but do not exclude other public sources merely because of source class.",
    "Do not stop because a requested field such as email is absent; gather the supported identity/role evidence and omit the absent field.",
    `Find up to ${batchSize} useful NEW source-backed subjects for this batch.`,
    `Search query: ${text(context.query_text)}`,
    `Requested fields: ${JSON.stringify(requestedFields)}`,
    `Query parameters: ${JSON.stringify(parameters)}`,
    `Current loop state: ${JSON.stringify(loopState)}`,
    "For this query, preserve the requested geographic scope exactly. Geography is a search filter only; do not infer travel behavior.",
    "Output ONLY one JSON object with this shape:",
    '{"records":[{"source_url":"https://...","source_title":"published page title if known","publisher":"publisher if explicit","subject_kind":"person|organization|business|nonprofit|government|other","organization_name":"only if explicit and relevant","fields":{"requested_field_name":"explicit source value"}}]}',
    "The fields object is generic: use the query's requested field names exactly when the source supports them. You may also include directly observed context fields such as role_function, phone, or website when relevant, but never manufacture them.",
    "For a person result, fields.name must be the person's explicitly published name. fields.title must be the explicitly published current title/role when available. fields.email must appear explicitly on the cited source if included.",
  ].join("\n");
}

async function gatewaySearch(context: JsonObject, batchSize: number) {
  const token = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;
  if (!token) throw new Error("Missing AI Gateway authentication (AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN).");

  const response = await fetch("https://ai-gateway.vercel.sh/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-5.6-sol",
      input: [
        {
          type: "message",
          role: "user",
          content: gatewayPrompt(context, batchSize),
        },
      ],
      tools: [{ type: "web_search" }],
      tool_choice: "auto",
      max_output_tokens: 12000,
      reasoning: { effort: "medium" },
    }),
    cache: "no-store",
  });

  const payload = (await response.json()) as unknown;
  if (!response.ok) {
    const errorObject = asObject(payload);
    throw new Error(text(errorObject?.error) || text(asObject(errorObject?.error)?.message) || `AI Gateway request failed (${response.status}).`);
  }

  const citationUrls = collectCitationUrls(payload);
  const rawText = collectOutputText(payload).join("\n").trim();
  const parsed = parseJsonPayload(rawText);
  const records = Array.isArray(parsed?.records) ? (parsed.records as DiscoveryRecord[]) : [];

  return { records, citationUrls, rawTextLength: rawText.length };
}

async function authorizeDiscovery(request: Request) {
  const internalSecret = process.env.ELM_LOCAL_DISCOVERY_SECRET || process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (internalSecret && authorization === `Bearer ${internalSecret}`) return true;

  const authorized = await requireAtlasApiAccess({ allowedRoles: ["owner", "manager"] });
  if (!authorized.ok) return authorized.response;
  return true;
}

export async function POST(request: Request) {
  if (request.headers.get("x-atlas-intent") !== "elm-local-discovery-v1") {
    return atlasApiError(400, "elm_local_discovery_intent_required", "A valid Elm Local discovery intent is required.");
  }

  const authorization = await authorizeDiscovery(request);
  if (authorization !== true) return authorization;

  let body: Record<string, unknown>;
  try {
    body = await readAtlasJsonBody(request);
  } catch {
    return atlasApiError(400, "invalid_elm_local_discovery_request", "The Elm Local discovery request is invalid.");
  }

  const searchQueryId = text(body.searchQueryId);
  if (!UUID_PATTERN.test(searchQueryId)) {
    return atlasApiError(400, "invalid_elm_local_search_query", "A valid search query is required.");
  }
  const batchSize = normalizedBatchSize(body.batchSize);
  const supabase = createAtlasAdminClient().schema("local_intel");

  const { data: contextData, error: contextError } = await supabase.rpc(
    "get_search_discovery_execution_context_v1",
    { p_search_query_id: searchQueryId },
  );
  if (contextError) return discoveryError(contextError, "Elm Local could not read the discovery query.");
  const context = asObject(contextData);
  if (!context) return atlasApiError(404, "elm_local_search_query_not_found", "The Elm Local search query was not found.");
  if (context.status !== "in_process") {
    return privateJson({ ok: true, status: context.status, context });
  }

  const { data: claimData, error: claimError } = await supabase.rpc(
    "claim_search_discovery_batch_v1",
    { p_search_query_id: searchQueryId },
  );
  if (claimError) return discoveryError(claimError, "Elm Local could not claim discovery work.");
  const claim = asObject(claimData);
  if (!claim) {
    return privateJson({ ok: true, status: "no_queued_batch", context });
  }
  if (claim.status === "complete") {
    return privateJson({ ok: true, status: "complete", claim });
  }

  const discoveryWorkId = text(claim.id);
  let gathered = 0;
  let accepted = 0;
  let rejectedUncited = 0;
  let ingestionCandidates = 0;
  let applied = 0;

  try {
    const search = await gatewaySearch(context, batchSize);
    gathered = search.records.length;

    for (const record of search.records) {
      const sourceUrl = text(record.source_url);
      const sourceKey = canonicalUrl(sourceUrl);
      if (!sourceKey) continue;
      const cited = search.citationUrls.get(sourceKey);
      if (!cited) {
        rejectedUncited += 1;
        continue;
      }

      const fields = explicitFields(record.fields);
      if (Object.keys(fields).length === 0) continue;
      const subjectKind = text(record.subject_kind) || "other";

      const { data: sourceId, error: sourceError } = await supabase.rpc(
        "register_search_discovery_source_v1",
        {
          p_payload: {
            source_url: cited.url,
            source_kind: "web_source",
            publisher: text(record.publisher) || null,
            title: text(record.source_title) || cited.title,
            metadata: {
              search_query_id: searchQueryId,
              discovery_work_id: discoveryWorkId || null,
              executor: "vercel_ai_gateway_web_search_v1",
            },
          },
        },
      );
      if (sourceError || typeof sourceId !== "string") continue;

      const name = text(fields.name);
      const title = text(fields.title);
      const email = text(fields.email);
      const phone = text(fields.phone);
      const website = text(fields.website);
      const roleFunction = text(fields.role_function);

      const { data: intakeData, error: intakeError } = await supabase.rpc(
        "ingest_search_discovery_evidence_v1",
        {
          p_payload: {
            search_query_id: searchQueryId,
            discovery_work_id: discoveryWorkId || null,
            source_id: sourceId,
            source_record_key: sourceRecordKey(cited.url, subjectKind, fields),
            subject_kind: subjectKind,
            organization_name: text(record.organization_name) || null,
            observed_name: name || null,
            role_title: title || null,
            role_function: roleFunction || null,
            email: email || null,
            phone: phone || null,
            website_url: website || null,
            fields,
            metadata: {
              executor: "vercel_ai_gateway_web_search_v1",
              cited_source_url: cited.url,
              gateway_citation_verified: true,
            },
          },
        },
      );
      if (intakeError) continue;

      accepted += 1;
      const intake = asObject(intakeData);
      if (intake?.status === "candidate") ingestionCandidates += 1;
      if (intake?.status === "applied") applied += 1;
    }

    const { data: finishData, error: finishError } = await supabase.rpc(
      "finish_search_discovery_batch_v1",
      {
        p_search_query_id: searchQueryId,
        p_batch_stats: {
          requested_batch_size: batchSize,
          gathered_records: gathered,
          accepted_records: accepted,
          rejected_uncited_records: rejectedUncited,
          ingestion_candidates: ingestionCandidates,
          applied_records: applied,
          executor: "vercel_ai_gateway_web_search_v1",
        },
      },
    );
    if (finishError) return discoveryError(finishError, "Elm Local gathered evidence but could not close the discovery batch.");

    return privateJson({
      ok: true,
      status: "batch_complete",
      stats: {
        requestedBatchSize: batchSize,
        gathered,
        accepted,
        rejectedUncited,
        ingestionCandidates,
        applied,
      },
      state: finishData,
    });
  } catch (error) {
    const { error: requeueError } = await supabase
      .from("search_discovery_queue")
      .update({ status: "queued", claimed_at: null, updated_at: new Date().toISOString() })
      .eq("search_query_id", searchQueryId)
      .eq("status", "in_process");

    console.error("Elm Local discovery batch failed", {
      searchQueryId,
      discoveryWorkId,
      requeueError: requeueError?.message,
      error: error instanceof Error ? error.message : String(error),
    });
    return atlasApiError(502, "elm_local_discovery_executor_failed", error instanceof Error ? error.message : "Elm Local discovery execution failed.");
  }
}
