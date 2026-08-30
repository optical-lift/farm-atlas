import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import {
  CATEGORIES,
  addDays,
  categoryLabel,
  costLabel,
  dayOfWeek,
  discoveryIdentity,
  eventDetail,
  eventHref,
  loadEvents,
  localDateKey,
  seriesHref,
  timeLabel,
  verifiedLabel,
  weekendRange,
  type CalendarEvent,
} from "@/app/local/public-events";
import { getAtlasSupabaseConfig } from "@/lib/supabase/config";

const MODEL = "openai/gpt-5.6-sol";
const GATEWAY_URL = "https://ai-gateway.vercel.sh/v1/chat/completions";
const MAX_QUESTION_LENGTH = 600;
const MAX_MATCHES = 6;

const KNOWN_CITIES = [
  "Marshfield",
  "Strafford",
  "Fair Grove",
  "Springfield",
  "Nixa",
  "Republic",
  "Rogersville",
  "Fordland",
  "Seymour",
  "Niangua",
  "Ozark",
  "Lebanon",
  "Bolivar",
  "Branson",
  "Buffalo",
  "Mountain Grove",
];

const STOP_WORDS = new Set([
  "a", "an", "and", "any", "are", "around", "at", "can", "do", "for", "from", "get", "have", "i", "in", "is",
  "it", "local", "looking", "me", "my", "near", "nearby", "of", "on", "or", "something", "that", "the", "there", "this",
  "to", "what", "where", "who", "with",
]);

const CENTRAL_HOUR = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  hour: "2-digit",
  hourCycle: "h23",
});

const buckets = new Map<string, { count: number; resetAt: number }>();

type QuestionKind = "events" | "product" | "service" | "place" | "availability" | "general";
type ObjectType = "entity" | "offering" | "occurrence";
type TimeOfDay = "any" | "morning" | "afternoon" | "evening" | "night" | "now";

type AskIntent = {
  questionKind: QuestionKind;
  searchQuery: string;
  objectTypes: ObjectType[];
  city: string | null;
  dateStart: string | null;
  dateEnd: string | null;
  timeOfDay: TimeOfDay;
  eventCategory: string | null;
  requiresFreshCurrentState: boolean;
  clarificationQuestion: string | null;
};

type PublicMatch = {
  id: string;
  kind: "event" | "series" | "place" | "offering";
  title: string;
  subtitle: string | null;
  summary: string | null;
  status: string | null;
  currentState: "current" | "stale" | "unknown" | null;
  href: string | null;
  externalUrl: string | null;
  phone: string | null;
  city: string | null;
  category: string | null;
  sourceChecked: string | null;
  score: number;
};

type LocalAnswerRow = {
  object_type: "entity" | "offering";
  object_id: string;
  stable_key: string | null;
  entity_id: string | null;
  entity_name: string | null;
  title: string;
  description: string | null;
  category: string | null;
  current_status: string | null;
  public_url: string | null;
  website_url: string | null;
  phone: string | null;
  last_verified_at: string | null;
  availability_freshness: "current" | "stale" | "unknown" | null;
  current_availability: unknown;
  latest_current_observation_at: string | null;
  rank: number | null;
};

const INTENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    questionKind: { type: "string", enum: ["events", "product", "service", "place", "availability", "general"] },
    searchQuery: { type: "string" },
    objectTypes: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      uniqueItems: true,
      items: { type: "string", enum: ["entity", "offering", "occurrence"] },
    },
    city: { anyOf: [{ type: "string" }, { type: "null" }] },
    dateStart: { anyOf: [{ type: "string" }, { type: "null" }] },
    dateEnd: { anyOf: [{ type: "string" }, { type: "null" }] },
    timeOfDay: { type: "string", enum: ["any", "morning", "afternoon", "evening", "night", "now"] },
    eventCategory: {
      anyOf: [
        { type: "string", enum: CATEGORIES.map((category) => category.key) },
        { type: "null" },
      ],
    },
    requiresFreshCurrentState: { type: "boolean" },
    clarificationQuestion: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
  required: [
    "questionKind",
    "searchQuery",
    "objectTypes",
    "city",
    "dateStart",
    "dateEnd",
    "timeOfDay",
    "eventCategory",
    "requiresFreshCurrentState",
    "clarificationQuestion",
  ],
} as const;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function safeString(value: unknown, maxLength = 1000) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function validDateKey(value: unknown) {
  const text = safeString(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function requestKey(request: Request) {
  return (request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? "anonymous")
    .split(",")[0]
    .trim()
    .slice(0, 100);
}

function withinRateLimit(request: Request) {
  const now = Date.now();
  const key = requestKey(request);
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (existing.count >= 12) return false;
  existing.count += 1;
  return true;
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function gatewayToken(request: Request) {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (apiKey) return { token: apiKey, source: "api_key" as const };

  // Vercel Functions receive the deployment OIDC token on the request object.
  // The first Ask Elm route incorrectly checked only process.env, which is not
  // where production function executions expose this credential.
  const oidc = request.headers.get("x-vercel-oidc-token") || process.env.VERCEL_OIDC_TOKEN;
  return oidc ? { token: oidc, source: "oidc" as const } : null;
}

async function callGatewayStructured<T>(
  request: Request,
  name: string,
  schema: unknown,
  system: string,
  user: string,
): Promise<T> {
  const auth = gatewayToken(request);
  if (!auth) throw new Error("AI Gateway authentication is unavailable on this request.");

  const response = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name, strict: true, schema },
      },
      stream: false,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 400);
    throw new Error(`AI Gateway request failed (${response.status}, ${auth.source}): ${detail}`);
  }

  const payload = await response.json() as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error(`AI Gateway returned no structured content (${auth.source}).`);
  return JSON.parse(content) as T;
}

function upcomingWeekday(today: string, target: number) {
  const current = dayOfWeek(today);
  return addDays(today, (target - current + 7) % 7);
}

function fallbackSearchQuery(question: string) {
  const tokens = question
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token))
    .filter((token) => !KNOWN_CITIES.some((name) => name.toLowerCase().split(/\s+/).includes(token)))
    .filter((token) => !["today", "tomorrow", "tonight", "weekend", "saturday", "sunday"].includes(token));
  return [...new Set(tokens)].slice(0, 6).join(" OR ");
}

function fallbackIntent(question: string, today: string): AskIntent {
  const lower = question.toLowerCase();
  const city = KNOWN_CITIES.find((name) => lower.includes(name.toLowerCase())) ?? null;
  const eventLike = /\b(event|events|happen|happening|activity|activities|festival|festivals|concert|music|class|classes|workshop|weekend|tonight|tomorrow|saturday|sunday)\b/.test(lower);
  const serviceLike = /\b(dentist|doctor|repair|lesson|lessons|service|services|childcare|preschool|photographer|photography|printing)\b/.test(lower);
  const current = /\b(now|today|tonight|current|currently|available|availability|open|opening|openings|accepting|in stock|restocked)\b/.test(lower);

  let dateStart: string | null = null;
  let dateEnd: string | null = null;
  if (lower.includes("today") || lower.includes("tonight")) dateStart = dateEnd = today;
  else if (lower.includes("tomorrow")) dateStart = dateEnd = addDays(today, 1);
  else if (lower.includes("weekend")) ({ start: dateStart, end: dateEnd } = weekendRange(today));
  else if (lower.includes("saturday")) dateStart = dateEnd = upcomingWeekday(today, 6);
  else if (lower.includes("sunday")) dateStart = dateEnd = upcomingWeekday(today, 0);

  let eventCategory: string | null = null;
  if (/\b(kid|kids|child|children|family|families)\b/.test(lower)) eventCategory = "kids-family";
  else if (/\b(free)\b/.test(lower)) eventCategory = "free";
  else if (/\b(outdoor|outside|park|parks)\b/.test(lower)) eventCategory = "outdoors";
  else if (/\b(music|concert|band)\b/.test(lower)) eventCategory = "music";
  else if (/\b(food|eat|restaurant|truck)\b/.test(lower)) eventCategory = "food";
  else if (/\b(sport|sports|game|games)\b/.test(lower)) eventCategory = "sports";
  else if (/\b(market|festival|fair)\b/.test(lower)) eventCategory = "markets-festivals";
  else if (/\b(theater|theatre|art|arts)\b/.test(lower)) eventCategory = "arts-theater";
  else if (/\b(class|classes|workshop|workshops|lesson|lessons)\b/.test(lower)) eventCategory = "classes-workshops";

  const timeOfDay: TimeOfDay = lower.includes("morning") ? "morning"
    : lower.includes("afternoon") ? "afternoon"
      : lower.includes("evening") ? "evening"
        : lower.includes("tonight") ? "night"
          : lower.includes("right now") || /\bnow\b/.test(lower) ? "now"
            : "any";

  return {
    questionKind: eventLike ? "events" : current ? "availability" : serviceLike ? "service" : "general",
    searchQuery: fallbackSearchQuery(question),
    objectTypes: eventLike ? ["occurrence"] : ["offering", "entity"],
    city,
    dateStart,
    dateEnd,
    timeOfDay,
    eventCategory,
    requiresFreshCurrentState: current,
    clarificationQuestion: null,
  };
}

function normalizeIntent(raw: AskIntent, question: string, today: string): AskIntent {
  const fallback = fallbackIntent(question, today);
  const validKinds: QuestionKind[] = ["events", "product", "service", "place", "availability", "general"];
  const validTypes: ObjectType[] = ["entity", "offering", "occurrence"];
  const validTimes: TimeOfDay[] = ["any", "morning", "afternoon", "evening", "night", "now"];
  const validCategories = new Set(CATEGORIES.map((category) => category.key));
  const types = Array.isArray(raw.objectTypes)
    ? raw.objectTypes.filter((value): value is ObjectType => validTypes.includes(value as ObjectType))
    : [];

  return {
    questionKind: validKinds.includes(raw.questionKind) ? raw.questionKind : fallback.questionKind,
    searchQuery: safeString(raw.searchQuery, 180) || fallback.searchQuery,
    objectTypes: types.length ? [...new Set(types)] : fallback.objectTypes,
    city: safeString(raw.city, 100) || null,
    dateStart: validDateKey(raw.dateStart),
    dateEnd: validDateKey(raw.dateEnd),
    timeOfDay: validTimes.includes(raw.timeOfDay) ? raw.timeOfDay : fallback.timeOfDay,
    eventCategory: raw.eventCategory && validCategories.has(raw.eventCategory) ? raw.eventCategory : null,
    requiresFreshCurrentState: Boolean(raw.requiresFreshCurrentState),
    clarificationQuestion: safeString(raw.clarificationQuestion, 220) || null,
  };
}

async function interpretQuestion(request: Request, question: string, previousIntent: AskIntent | null, today: string) {
  const system = `You are the intent interpreter for Elm Local, a governed hyperlocal reality system centered on Marshfield, Missouri.\n\nFOUNDATIONAL RULE: The AI interprets; the database knows. Do not answer the user's question and do not invent local facts. Convert ordinary language into retrieval constraints only.\n\nLocal date: ${today}. Time zone: America/Chicago. Resolve relative dates into YYYY-MM-DD.\n\nUse questionKind=events for happenings, activities, classes, festivals, concerts, meetings, sports, or other time-bound things to do. Use product/service/place/availability for durable local supply and providers. Use availability only when the person asks who has something now, who is open, who has openings, who is accepting patients, what is in stock, etc.\n\nFor event questions include occurrence. For product/service/place questions prefer offering and entity.\n\nsearchQuery must be a compact high-recall web-search-style query containing only essential subject terms. Add true synonyms when they materially improve retrieval. For example, “tshirt printing” should become something like “t-shirt OR tshirt OR screen printing”; “local honey” can become “honey OR apiary OR beekeeper”; “dentist” can become “dentist OR dental”. Do not add a business name unless the user supplied it. For broad event questions searchQuery may be empty. Do not put dates, town names, filler words, price limits, local, or nearby into searchQuery.\n\nOnly set city when the user names a town.\n\nSet eventCategory only when one of these clearly applies: ${CATEGORIES.map((category) => `${category.key} (${category.label})`).join(", ")}.\n\nSet requiresFreshCurrentState=true only when answering would be misleading without fresh current evidence.\n\nUse clarificationQuestion only when one missing detail makes retrieval impossible. Most questions should not require clarification.\n\nIf previousIntent is supplied, use it only when the new message is clearly a follow-up. A standalone new question replaces the prior topic.`;

  try {
    const raw = await callGatewayStructured<AskIntent>(
      request,
      "elm_local_intent_v2",
      INTENT_SCHEMA,
      system,
      JSON.stringify({ question, previousIntent }),
    );
    return { intent: normalizeIntent(raw, question, today), aiAvailable: true };
  } catch (error) {
    console.error("Elm Local v2 intent interpreter unavailable", error);
    return { intent: fallbackIntent(question, today), aiAvailable: false };
  }
}

function hourInCentral(value: string) {
  const hour = Number(CENTRAL_HOUR.format(new Date(value)));
  return Number.isFinite(hour) ? hour : null;
}

function matchesTimeOfDay(event: CalendarEvent, timeOfDay: TimeOfDay) {
  if (timeOfDay === "any") return true;
  if (timeOfDay === "now") {
    if (event.time_precision !== "exact") return false;
    const now = Date.now();
    const start = new Date(event.starts_at).getTime();
    const end = event.ends_at ? new Date(event.ends_at).getTime() : start + 2 * 60 * 60 * 1000;
    return start <= now && now <= end;
  }
  if (event.time_precision !== "exact") return true;
  const hour = hourInCentral(event.starts_at);
  if (hour === null) return true;
  if (timeOfDay === "morning") return hour >= 5 && hour < 12;
  if (timeOfDay === "afternoon") return hour >= 12 && hour < 17;
  if (timeOfDay === "evening") return hour >= 17 && hour < 21;
  return hour >= 18 || hour < 5;
}

function searchTokens(searchQuery: string) {
  return searchQuery
    .toLowerCase()
    .replace(/\b(or|and|not)\b/g, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function eventScore(event: CalendarEvent, intent: AskIntent) {
  const tokens = searchTokens(intent.searchQuery);
  const haystack = [
    event.title,
    event.series_title,
    event.series_summary,
    event.host_name,
    event.venue_name,
    event.city,
    event.event_kind,
    ...event.categories,
    ...event.categories.map(categoryLabel),
    eventDetail(event),
  ].filter(Boolean).join(" ").toLowerCase();

  let score = tokens.length ? tokens.reduce((sum, token) => sum + (haystack.includes(token) ? 2 : 0), 0) : 1;
  if (intent.eventCategory && event.categories.includes(intent.eventCategory)) score += 5;
  if (event.featured_rank !== null) score += Math.max(0, 4 - Math.min(event.featured_rank, 4));
  return score;
}

function eventInRange(event: CalendarEvent, intent: AskIntent, today: string) {
  const key = localDateKey(new Date(event.starts_at));
  const start = intent.dateStart ?? today;
  const end = intent.dateEnd ?? (intent.dateStart ? intent.dateStart : addDays(today, 90));
  return key >= start && key <= end;
}

function eventMatch(event: CalendarEvent, score: number): PublicMatch {
  return {
    id: `event:${event.public_id}`,
    kind: "event",
    title: event.title,
    subtitle: [event.venue_name || event.host_name, event.city].filter(Boolean).join(" · ") || null,
    summary: eventDetail(event) || event.series_summary,
    status: [timeLabel(event), costLabel(event)].filter(Boolean).join(" · ") || null,
    currentState: null,
    href: eventHref(event),
    externalUrl: event.public_url,
    phone: null,
    city: event.city,
    category: event.categories[0] ? categoryLabel(event.categories[0]) : null,
    sourceChecked: verifiedLabel(event),
    score,
  };
}

function seriesMatch(events: CalendarEvent[], score: number): PublicMatch {
  const first = events[0];
  return {
    id: `series:${first.series_key}`,
    kind: "series",
    title: first.series_title || first.title,
    subtitle: [first.venue_name || first.host_name, first.city].filter(Boolean).join(" · ") || null,
    summary: first.series_summary || eventDetail(first),
    status: `${events.length} matching ${events.length === 1 ? "date" : "dates"}; next ${timeLabel(first)}`,
    currentState: null,
    href: first.series_key ? seriesHref(first.series_key) : eventHref(first),
    externalUrl: null,
    phone: null,
    city: first.city,
    category: first.categories[0] ? categoryLabel(first.categories[0]) : null,
    sourceChecked: verifiedLabel(first),
    score,
  };
}

async function eventCandidates(intent: AskIntent, today: string) {
  if (!intent.objectTypes.includes("occurrence") && intent.questionKind !== "events") return [] as PublicMatch[];
  const { events, error } = await loadEvents(120);
  if (error) console.error("Elm Local v2 calendar search failed", error);

  const filtered = events.filter((event) => {
    if (intent.city && event.city?.toLowerCase() !== intent.city.toLowerCase()) return false;
    if (intent.eventCategory && !event.categories.includes(intent.eventCategory)) return false;
    if (!eventInRange(event, intent, today)) return false;
    if (!matchesTimeOfDay(event, intent.timeOfDay)) return false;
    return eventScore(event, intent) > 0;
  });

  const groups = new Map<string, CalendarEvent[]>();
  for (const event of filtered) {
    const identity = discoveryIdentity(event);
    const group = groups.get(identity) ?? [];
    group.push(event);
    groups.set(identity, group);
  }

  const matches: PublicMatch[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    const score = Math.max(...group.map((event) => eventScore(event, intent)));
    matches.push(group.length > 1 && group[0].series_key ? seriesMatch(group, score) : eventMatch(group[0], score));
  }
  return matches.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, 12);
}

function availabilitySummary(value: unknown) {
  if (!Array.isArray(value)) return null;
  const summaries = value
    .map((item) => item && typeof item === "object" ? safeString((item as Record<string, unknown>).summary, 500) : "")
    .filter(Boolean);
  return summaries.length ? summaries.slice(0, 2).join(" ") : null;
}

function verifiedDate(value: string | null) {
  if (!value) return null;
  try {
    return `Source checked ${new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(value))}`;
  } catch {
    return null;
  }
}

async function localCandidates(intent: AskIntent) {
  const objectTypes = intent.objectTypes.filter((value): value is "entity" | "offering" => value !== "occurrence");
  const query = intent.searchQuery.trim();
  if (!objectTypes.length || !query) return [] as PublicMatch[];

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    console.error("Elm Local v2 server search unavailable: service role key missing");
    return [];
  }

  const { url } = getAtlasSupabaseConfig();
  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const { data, error } = await supabase.rpc("elm_local_search_answers_v1", {
    p_query: query,
    p_object_types: objectTypes,
    p_city: intent.city,
    p_limit: 24,
  });
  if (error) {
    console.error("Elm Local v2 answer inventory search failed", error.message);
    return [];
  }

  return ((data ?? []) as LocalAnswerRow[]).map((row) => {
    const freshness = row.availability_freshness === "current" ? "current"
      : row.availability_freshness === "stale" ? "stale"
        : "unknown";
    const currentSummary = freshness === "current" ? availabilitySummary(row.current_availability) : null;
    const status = currentSummary || (intent.requiresFreshCurrentState
      ? freshness === "stale"
        ? "Elm has older availability evidence, but it is no longer current."
        : "Elm does not have fresh availability confirmation right now."
      : row.description || row.current_status);

    return {
      id: `local:${row.object_type}:${row.object_id}`,
      kind: row.object_type === "entity" ? "place" as const : "offering" as const,
      title: row.title,
      subtitle: row.entity_name && row.entity_name !== row.title ? row.entity_name : null,
      summary: row.description,
      status,
      currentState: freshness,
      href: null,
      externalUrl: row.public_url || row.website_url,
      phone: row.phone,
      city: intent.city,
      category: row.category,
      sourceChecked: verifiedDate(row.last_verified_at),
      score: typeof row.rank === "number" ? row.rank * 100 : 0,
    } satisfies PublicMatch;
  }).slice(0, 12);
}

function answerFromRecords(question: string, intent: AskIntent, candidates: PublicMatch[]) {
  if (!candidates.length) {
    if (intent.requiresFreshCurrentState) {
      return "I don’t have a fresh, verified local match for that right now. I’d rather say that than turn an old listing into current availability.";
    }
    return "I don’t have a verified local match for that yet. Try phrasing it another way, or tell me one more thing that matters and I’ll narrow it down.";
  }

  if (intent.requiresFreshCurrentState) {
    const current = candidates.filter((candidate) => candidate.currentState === "current" || candidate.kind === "event" || candidate.kind === "series");
    if (!current.length) {
      const names = candidates.slice(0, 3).map((candidate) => candidate.title).join(", ");
      return `I found ${candidates.length} possible ${candidates.length === 1 ? "source" : "sources"} — ${names} — but Elm does not have fresh availability confirmation for ${candidates.length === 1 ? "it" : "them"} right now.`;
    }
    const names = current.slice(0, 3).map((candidate) => candidate.title).join(", ");
    return `I found ${current.length} current ${current.length === 1 ? "match" : "matches"}: ${names}${current.length > 3 ? " and a few more" : ""}.`;
  }

  if (intent.questionKind === "events") {
    const names = candidates.slice(0, 3).map((candidate) => candidate.title).join(", ");
    return `I found ${candidates.length} ${candidates.length === 1 ? "thing" : "things"} that fit: ${names}${candidates.length > 3 ? " and a few more" : ""}.`;
  }

  const names = candidates.slice(0, 3).map((candidate) => candidate.title).join(", ");
  return `I found ${candidates.length} local ${candidates.length === 1 ? "match" : "matches"} for “${question}”: ${names}${candidates.length > 3 ? " and a few more" : ""}.`;
}

function calendarHref(intent: AskIntent, today: string, candidates: PublicMatch[]) {
  if (!candidates.some((candidate) => candidate.kind === "event" || candidate.kind === "series")) return null;
  const params = new URLSearchParams();
  const tomorrow = addDays(today, 1);
  const weekend = weekendRange(today);
  let view = "all";
  if (intent.dateStart === today && intent.dateEnd === today) view = "today";
  else if (intent.dateStart === tomorrow && intent.dateEnd === tomorrow) view = "tomorrow";
  else if (intent.dateStart === weekend.start && intent.dateEnd === weekend.end) view = "weekend";
  else if (intent.dateStart && intent.dateStart >= today && (intent.dateEnd ?? intent.dateStart) <= addDays(today, 6)) view = "next7";
  params.set("view", view);
  if (intent.city) params.set("city", intent.city);
  if (intent.eventCategory) params.set("category", intent.eventCategory);
  return `/local?${params.toString()}#calendar`;
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ ok: false, error: "Origin not allowed." }, 403);
  if (!withinRateLimit(request)) return json({ ok: false, error: "Too many questions. Try again in a minute." }, 429);

  const body = await request.json().catch(() => null) as { question?: unknown; previousIntent?: AskIntent | null } | null;
  const question = safeString(body?.question, MAX_QUESTION_LENGTH);
  if (!question) return json({ ok: false, error: "Ask Elm a question first." }, 400);

  const today = localDateKey(new Date());
  const previousIntent = body?.previousIntent && typeof body.previousIntent === "object" ? body.previousIntent : null;
  const interpreted = await interpretQuestion(request, question, previousIntent, today);
  const intent = interpreted.intent;

  if (intent.clarificationQuestion) {
    return json({
      ok: true,
      question,
      answer: intent.clarificationQuestion,
      intent,
      matches: [],
      calendarHref: null,
      aiAvailable: interpreted.aiAvailable,
      needsClarification: true,
    });
  }

  const [events, local] = await Promise.all([eventCandidates(intent, today), localCandidates(intent)]);
  const candidates = [...events, ...local]
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, MAX_MATCHES);

  return json({
    ok: true,
    question,
    answer: answerFromRecords(question, intent, candidates),
    intent,
    matches: candidates.map(({ score: _score, ...match }) => match),
    calendarHref: calendarHref(intent, today, candidates),
    aiAvailable: interpreted.aiAvailable,
    needsClarification: false,
  });
}
