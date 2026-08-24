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
const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 250;
const SUBJECT_SOURCE_LIMIT = 4;
const WORK_MODES = new Set(["balanced", "discovery", "subject"]);

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

function asStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
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

function collectCitationUrls(
  value: unknown,
  found = new Map<string, { url: string; title: string | null }>(),
) {
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
  const unfenced = raw
    .trim()
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
  for (const [rawKey, fieldValue] of Object.entries(object)) {
    const key = rawKey.trim();
    if (!key || fieldValue === null || fieldValue === undefined) continue;
    if (typeof fieldValue === "string") {
      const clean = fieldValue.trim();
      if (clean) result[key] = clean;
    } else if (typeof fieldValue === "number" || typeof fieldValue === "boolean") {
      result[key] = fieldValue;
    } else if (Array.isArray(fieldValue) && fieldValue.length > 0) {
      result[key] = fieldValue;
    } else if (asObject(fieldValue) && Object.keys(fieldValue as JsonObject).length > 0) {
      result[key] = fieldValue;
    }
  }
  return result;
}

function sourceRecordKey(sourceUrl: string, subjectKind: string, fields: JsonObject) {
  return createHash("sha256")
    .update(JSON.stringify({ sourceUrl: canonicalUrl(sourceUrl) ?? sourceUrl, subjectKind, fields }))
    .digest("hex");
}

function mixedBatchPrompt(context: JsonObject, batchSize: number, lane: JsonObject) {
  const requestedFields = asStringArray(context.requested_fields);
  const parameters = asObject(context.parameters) ?? {};
  const loopState = asObject(context.loop_state) ?? {};
  const laneScope = asObject(lane.lane_scope) ?? {};

  return [
    "You are one independently claimable Elm Local vertical-lane evidence gatherer.",
    `Lane key: ${text(lane.lane_key)}`,
    `Lane label: ${text(lane.lane_label)}`,
    `Lane scope: ${JSON.stringify(laneScope)}`,
    "Stay inside this lane's exclusive primary organization vertical. Exclude organizations whose primary vertical belongs to another lane, even when they employ similar roles.",
    "Prefer high-yield official directories, staff pages, team pages, leadership pages, and official PDFs that can yield many explicit contacts from one opened source.",
    "You are the Elm Local mixed-batch evidence gatherer.",
    "Search current public web reality and GATHER explicit evidence. A publisher's downstream-use preference does not determine whether publicly exposed evidence is gathered; preserve relevant notices as source context instead of suppressing collection.",
    "Return only evidence supported by pages you actually opened through web search.",
    "Never infer, construct, guess, complete, or pattern-generate a missing value. Omit missing fields.",
    "Conflicting source-backed values may be separate records; do not silently choose one.",
    "Every record must have one source_url that you actually visited and can cite.",
    "Do not stop merely because one requested field is absent. Gather the supported fields and omit the absent one.",
    `Find up to ${batchSize} useful new source-backed subjects for this batch.`,
    `Search query: ${text(context.query_text)}`,
    `Requested fields: ${JSON.stringify(requestedFields)}`,
    `Query parameters: ${JSON.stringify(parameters)}`,
    `Current loop state: ${JSON.stringify(loopState)}`,
    "Preserve any geographic scope in the parameters exactly. Geography is a search filter only, never a travel-behavior assumption.",
    "Output ONLY one JSON object in this shape:",
    '{"records":[{"source_url":"https://...","source_title":"page title if known","publisher":"publisher if explicit","subject_kind":"person|organization|business|nonprofit|government|other","organization_name":"only if explicit and relevant","fields":{"requested_field_name":"explicit source value"}}]}',
    "The fields object is generic. Use the query's requested field names exactly when supported. You may include directly observed context fields such as role_function, phone, or website when relevant.",
    "For person evidence, fields.name must be explicitly published. fields.title must be the explicitly published current title/role when available. fields.email may be included only when the cited source explicitly publishes that email for the person or role represented by the record.",
  ].join("\n");
}

function subjectResearchPrompt(context: JsonObject, subject: JsonObject) {
  const requestedFields = asStringArray(subject.requested_fields).length
    ? asStringArray(subject.requested_fields)
    : asStringArray(context.requested_fields);
  const parameters = asObject(context.parameters) ?? {};
  const seedContext = asObject(subject.context) ?? {};

  return [
    "You are the Elm Local subject-centric research worker inside a mixed-batch discovery run.",
    "Research EXACTLY the subject described below. Temporary research ownership does not establish or change canonical identity.",
    "If the seed is evidence-bound rather than canonical, do not merge it with another same-named person or organization unless a source explicitly establishes that identity.",
    "Search current public web reality across multiple useful sources and gather every explicit requested fact you can support for this subject.",
    "You may also gather directly observed context fields such as role_function, phone, website, department, organization, or location when useful.",
    "Do not broaden into a list of other people or organizations. Other names may appear only as source context.",
    "Never infer, construct, guess, complete, or pattern-generate a missing value. Omit unsupported fields.",
    "Conflicting source-backed values may be separate records; do not silently reconcile them.",
    "Every record must have one source_url that you actually visited and can cite.",
    `Return at most ${SUBJECT_SOURCE_LIMIT} source-backed records for this one subject.`,
    `Original search query: ${text(context.query_text)}`,
    `Query parameters: ${JSON.stringify(parameters)}`,
    `Requested fields: ${JSON.stringify(requestedFields)}`,
    `Subject kind: ${text(subject.subject_kind)}`,
    `Subject name: ${text(subject.subject_name) || "not separately established"}`,
    `Organization context: ${text(subject.organization_name) || "not separately established"}`,
    `Seed context: ${JSON.stringify(seedContext)}`,
    "Preserve any geographic scope in the query parameters exactly. Geography is a search filter only, never a travel-behavior assumption.",
    "Output ONLY one JSON object in this shape:",
    '{"records":[{"source_url":"https://...","source_title":"page title if known","publisher":"publisher if explicit","subject_kind":"same subject kind","organization_name":"only if explicit and relevant","fields":{"requested_field_name":"explicit source value"}}]}',
  ].join("\n");
}

async function gatewaySearch(prompt: string) {
  const token = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;
  if (!token) {
    throw new Error("Missing AI Gateway authentication (AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN).");
  }

  const response = await fetch("https://ai-gateway.vercel.sh/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-5.6-sol",
      input: [{ type: "message", role: "user", content: prompt }],
      tools: [{ type: "web_search" }],
      tool_choice: "auto",
      max_output_tokens: 30000,
      reasoning: { effort: "medium" },
    }),
    cache: "no-store",
  });

  const payload = (await response.json()) as unknown;
  if (!response.ok) {
    const root = asObject(payload);
    const nestedError = asObject(root?.error);
    throw new Error(
      text(nestedError?.message) || text(root?.error) || `AI Gateway request failed (${response.status}).`,
    );
  }

  const citationUrls = collectCitationUrls(payload);
  const rawText = collectOutputText(payload).join("\n").trim();
  const parsed = parseJsonPayload(rawText);
  const records = Array.isArray(parsed?.records) ? (parsed.records as DiscoveryRecord[]) : [];
  return { records, citationUrls };
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

  const supabase = createAtlasAdminClient().schema("local_intel");
  const { data: contextData, error: contextError } = await supabase.rpc(
    "get_search_discovery_execution_context_v1",
    { p_search_query_id: searchQueryId },
  );
  if (contextError) return discoveryError(contextError, "Elm Local could not read the discovery query.");

  const context = asObject(contextData);
  if (!context) {
    return atlasApiError(404, "elm_local_search_query_not_found", "The Elm Local search query was not found.");
  }
  if (context.status !== "in_process") {
    return privateJson({ ok: true, status: context.status, context });
  }

  const parameters = asObject(context.parameters) ?? {};
  const throughput = asObject(parameters.throughput) ?? {};
  const batchSize = normalizedBatchSize(body.batchSize ?? throughput.discovery_batch_size);
  const requestedMode = text(body.workMode) || "balanced";
  if (!WORK_MODES.has(requestedMode)) {
    return atlasApiError(400, "invalid_elm_local_work_mode", "Elm Local work mode must be balanced, discovery, or subject.");
  }
  const requestedLaneKey = text(body.laneKey) || null;
  const shouldClaimSubject = requestedMode !== "discovery";

  const { data: subjectClaimData, error: subjectClaimError } = shouldClaimSubject
    ? await supabase.rpc(
        "claim_search_discovery_subject_v1",
        { p_search_query_id: searchQueryId },
      )
    : { data: null, error: null };
  if (subjectClaimError) {
    return discoveryError(subjectClaimError, "Elm Local could not claim subject research work.");
  }

  const subjectClaim = asObject(subjectClaimData);
  if (subjectClaim) {
    const subjectWorkId = text(subjectClaim.id);
    const discoveryWorkId = text(subjectClaim.discovery_work_id);
    const fixedEntityId = UUID_PATTERN.test(text(subjectClaim.entity_id)) ? text(subjectClaim.entity_id) : null;
    let gathered = 0;
    let accepted = 0;
    let rejectedUncited = 0;
    let ingestionCandidates = 0;
    let applied = 0;

    try {
      const search = await gatewaySearch(subjectResearchPrompt(context, subjectClaim));
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
        const subjectKind = text(record.subject_kind) || text(subjectClaim.subject_kind) || "other";

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
                subject_work_id: subjectWorkId,
                executor: "vercel_ai_gateway_subject_research_v1",
              },
            },
          },
        );
        if (sourceError || typeof sourceId !== "string") continue;

        const { data: intakeData, error: intakeError } = await supabase.rpc(
          "ingest_search_discovery_evidence_v1",
          {
            p_payload: {
              search_query_id: searchQueryId,
              discovery_work_id: discoveryWorkId || null,
              source_id: sourceId,
              source_record_key: sourceRecordKey(cited.url, subjectKind, fields),
              subject_kind: subjectKind,
              entity_id: fixedEntityId,
              organization_name: text(record.organization_name) || text(subjectClaim.organization_name) || null,
              observed_name: text(fields.name) || text(subjectClaim.subject_name) || null,
              role_title: text(fields.title) || null,
              role_function: text(fields.role_function) || null,
              email: text(fields.email) || null,
              phone: text(fields.phone) || null,
              website_url: text(fields.website) || null,
              fields,
              metadata: {
                executor: "vercel_ai_gateway_subject_research_v1",
                subject_work_id: subjectWorkId,
                subject_key: text(subjectClaim.subject_key),
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

      const { data: finishSubjectData, error: finishSubjectError } = await supabase.rpc(
        "finish_search_discovery_subject_v1",
        {
          p_subject_work_id: subjectWorkId,
          p_stats: {
            gathered_records: gathered,
            accepted_records: accepted,
            rejected_uncited_records: rejectedUncited,
            ingestion_candidates: ingestionCandidates,
            applied_records: applied,
            executor: "vercel_ai_gateway_subject_research_v1",
          },
        },
      );
      if (finishSubjectError) {
        return discoveryError(finishSubjectError, "Elm Local gathered subject evidence but could not release the subject.");
      }

      return privateJson({
        ok: true,
        status: "subject_complete",
        subject: finishSubjectData,
        stats: { gathered, accepted, rejectedUncited, ingestionCandidates, applied },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const { error: requeueSubjectError } = await supabase.rpc(
        "requeue_search_discovery_subject_v1",
        { p_subject_work_id: subjectWorkId, p_error: message },
      );
      console.error("Elm Local subject research failed", {
        searchQueryId,
        subjectWorkId,
        requeueError: requeueSubjectError?.message,
        error: message,
      });
      return atlasApiError(502, "elm_local_subject_research_executor_failed", message);
    }
  }

  if (requestedMode === "subject") {
    return privateJson({ ok: true, status: "no_queued_subject", context });
  }

  const { data: claimData, error: claimError } = await supabase.rpc(
    "claim_search_discovery_lane_v1",
    { p_search_query_id: searchQueryId, p_lane_key: requestedLaneKey },
  );
  if (claimError) return discoveryError(claimError, "Elm Local could not claim a vertical discovery lane.");

  const claim = asObject(claimData);
  if (!claim) return privateJson({ ok: true, status: "no_queued_lane", requestedLaneKey, context });
  if (claim.status === "complete") return privateJson({ ok: true, status: "complete", claim });

  const laneId = text(claim.id);
  const laneKey = text(claim.lane_key);
  const discoveryWorkId = text(claim.discovery_work_id);
  let gathered = 0;
  let accepted = 0;
  let rejectedUncited = 0;
  let ingestionCandidates = 0;
  let applied = 0;
  let subjectWorkSeeded = 0;

  try {
    const search = await gatewaySearch(mixedBatchPrompt(context, batchSize, claim));
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
              executor: "vercel_ai_gateway_vertical_lane_v1",
              lane_key: laneKey,
            },
          },
        },
      );
      if (sourceError || typeof sourceId !== "string") continue;

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
            observed_name: text(fields.name) || null,
            role_title: text(fields.title) || null,
            role_function: text(fields.role_function) || null,
            email: text(fields.email) || null,
            phone: text(fields.phone) || null,
            website_url: text(fields.website) || null,
            fields,
            metadata: {
              executor: "vercel_ai_gateway_vertical_lane_v1",
              lane_key: laneKey,
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

      const entityId = UUID_PATTERN.test(text(intake?.entity_id)) ? text(intake?.entity_id) : null;
      const evidenceId = UUID_PATTERN.test(text(intake?.evidence_id)) ? text(intake?.evidence_id) : null;
      const subjectKey = entityId ? `entity:${entityId}` : evidenceId ? `evidence:${evidenceId}` : "";
      if (subjectKey) {
        const { data: subjectSeedData, error: subjectSeedError } = await supabase.rpc(
          "enqueue_search_discovery_subject_v1",
          {
            p_payload: {
              search_query_id: searchQueryId,
              discovery_work_id: discoveryWorkId || null,
              seed_evidence_id: evidenceId,
              entity_id: entityId,
              subject_key: subjectKey,
              subject_kind: subjectKind,
              subject_name: text(fields.name) || null,
              organization_name: text(record.organization_name) || null,
              requested_fields: asStringArray(context.requested_fields),
              context: {
                seed_source_url: cited.url,
                seed_source_title: text(record.source_title) || cited.title,
                seed_publisher: text(record.publisher) || null,
                seed_fields: fields,
              },
              metadata: {
                seeded_by: "mixed_batch",
                executor: "vercel_ai_gateway_vertical_lane_v1",
                lane_key: laneKey,
              },
            },
          },
        );
        if (!subjectSeedError && asObject(subjectSeedData)) subjectWorkSeeded += 1;
      }
    }

    const { data: finishData, error: finishError } = await supabase.rpc(
      "finish_search_discovery_lane_v1",
      {
        p_lane_id: laneId,
        p_batch_stats: {
          lane_key: laneKey,
          requested_batch_size: batchSize,
          gathered_records: gathered,
          accepted_records: accepted,
          rejected_uncited_records: rejectedUncited,
          ingestion_candidates: ingestionCandidates,
          applied_records: applied,
          subject_work_seeded: subjectWorkSeeded,
          executor: "vercel_ai_gateway_vertical_lane_v1",
        },
      },
    );
    if (finishError) {
      return discoveryError(finishError, "Elm Local gathered evidence but could not close the vertical lane batch.");
    }

    return privateJson({
      ok: true,
      status: "lane_batch_complete",
      laneKey,
      stats: {
        requestedBatchSize: batchSize,
        gathered,
        accepted,
        rejectedUncited,
        ingestionCandidates,
        applied,
        subjectWorkSeeded,
      },
      state: finishData,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const { error: requeueError } = await supabase.rpc(
      "requeue_search_discovery_lane_v1",
      { p_lane_id: laneId, p_error: message },
    );

    console.error("Elm Local vertical lane batch failed", {
      searchQueryId,
      laneId,
      laneKey,
      discoveryWorkId,
      requeueError: requeueError?.message,
      error: message,
    });
    return atlasApiError(502, "elm_local_discovery_executor_failed", message);
  }
}
