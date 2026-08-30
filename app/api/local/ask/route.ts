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

const MODEL = "openai/gpt-5.6-luna";
const GATEWAY_URL = "https://ai-gateway.vercel.sh/v1/chat/completions";
const MAX_QUESTION_LENGTH = 600;
const MAX_CANDIDATES_FOR_ANSWER = 16;
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

const ANSWER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    answer: { type: "string" },
    selectedIds: {
      type: "array",
      maxItems: MAX_MATCHES,
      uniqueItems: true,
      items: { type: "string" },
    },
  },
  required: ["answer", "selectedIds"],
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

async function callGatewayStructured<T>(name: string, schema: unknown, system: string, user: string): Promise<T> {
  const token = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;
  if (!token) throw new Error("AI Gateway authentication is not configured.");

  const response = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
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
        json_schema: {
          name,
          strict: true,
          schema,
        },
      },
      stream: false,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 500);
    throw new Error(`AI Gateway request failed (${response.status}): ${detail}`);
  }

  const payload = await response.json() as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI Gateway returned no structured content.");
  return JSON.parse(content) as T;
}

function upcomingWeekday(today: string, target: number) {
  const current = dayOfWeek(today);
  const delta = (target - current + 7) % 7;
  return addDays(today, delta);
}

function fallbackIntent(question: string, today: string): AskIntent {
  const lower = question.toLowerCase();
  const city = KNOWN_CITIES.find((name) => lower.includes(name.toLowerCase())) ?? null;
  const eventLike = /\b(event|events|happen|happening|activity|activities|festival|festivals|concert|music|class|classes|workshop|weekend|tonight|tomorrow|saturday|sunday)\b/.test(lower);
  const serviceLike = /\b(dentist|doctor|repair|lesson|lessons|service|services|childcare|preschool|photographer|photography)\b/.test(lower);
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

  const tokens = lower
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token) && !KNOWN_CITIES.some((name) => name.toLowerCase().split(/\s+/).includes(token)))
    .filter((token) => !["today", "tomorrow", "tonight", "weekend", "saturday", "sunday"].includes(token));

  const timeOfDay: TimeOfDay = lower.includes("morning") ? "morning"
    : lower.includes("afternoon") ? "afternoon"
      : lower.includes("evening") ? "evening"
        : lower.includes("tonight") ? "night"
          : lower.includes("right now") || /\bnow\b/.test(lower) ? "now"
            : "any";

  return {
    questionKind: eventLike ? "events" : current ? "availability" : serviceLike ? "service" : "general",
    searchQuery: tokens.slice(0, 5).join(" "),
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

async function interpretQuestion(question: string, previousIntent: AskIntent | null, today: string) {
  const system = `You are the intent interpreter for Elm Local, a governed hyperlocal reality system centered on Marshfield, Missouri.\n\nFOUNDATIONAL RULE: The AI interprets; the database knows. Do not answer the user's question and do not invent local facts. Convert the user's ordinary language into retrieval constraints only.\n\nLocal date: ${today}. Time zone: America/Chicago. Resolve relative dates such as today, tomorrow, Saturday, Sunday, this weekend, and next week into YYYY-MM-DD dates.\n\nUse questionKind=events for things to do, happenings, classes, festivals, concerts, meetings, or other time-bound activities. Use product/service/place/availability for durable local supply and providers. Use availability when the person is explicitly asking who has something now, who is open, who has openings, who is accepting patients, what is in stock, etc.\n\nFor event questions, include occurrence in objectTypes. For product/service/place questions, prefer offering and entity. Mixed questions may include all three.\n\nsearchQuery is a compact high-recall full-text query containing only the essential subject terms. For non-event searches, use web-search-style OR between true synonyms when useful (example: honey OR apiary; dentist OR dental). For broad event questions like “what's happening Saturday?” searchQuery may be empty. Do not put dates, town names, filler language, price limits, or words like local/nearby into searchQuery.\n\nOnly set city when the user names a town. Do not silently default to Springfield or Marshfield.\n\nSet eventCategory only when one of these categories clearly applies: ${CATEGORIES.map((category) => `${category.key} (${category.label})`).join(", ")}.\n\nSet requiresFreshCurrentState=true when the requested answer would be misleading without fresh current evidence.\n\nUse clarificationQuestion only when one missing detail makes meaningful retrieval impossible. Most questions should be answered without clarification.\n\nIf a previous intent is supplied, use it only when the new message is clearly a follow-up. A standalone new question replaces the previous topic.`;

  const user = JSON.stringify({
    question,
    previousIntent,
  });

  try {
    const raw = await callGatewayStructured<AskIntent>("elm_local_intent", INTENT_SCHEMA, system, user);
    return { intent: normalizeIntent(raw, question, today), aiAvailable: true };
  } catch (error) {
    console.error("Elm Local intent interpreter unavailable", error);
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

function dateInIntentRange(event: CalendarEvent, intent: AskIntent, today: string) {
  const key = localDateKey(new Date(event.starts_at));
  const start = intent.dateStart ?? today;
  const end = intent.dateEnd ?? (intent.dateStart ? intent.dateStart : addDays(today, 90));
  return key >= start && key <= end;
}

function seriesCandidate(events: CalendarEvent[], score: number): PublicMatch {
  const first = events[0];
  const title = first.series_title || first.title;
  const dates = events.length;
  return {
    id: `series:${first.series_key}`,
    kind: "series",
    title,
    subtitle: [first.venue_name || first.host_name, first.city].filter(Boolean).join(" · ") || null,
    summary: first.series_summary || eventDetail(first),
    status: `${dates} matching ${dates === 1 ? "date" : "dates"}; next ${timeLabel(first)}`,
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

function eventCandidate(event: CalendarEvent, score: number): PublicMatch {
  const cost = costLabel(event);
  return {
    id: `event:${event.public_id}`,
    kind: "event",
    title: event.title,
    subtitle: [event.venue_name || event.host_name, event.city].filter(Boolean).join(" · ") || null,
    summary: eventDetail(event) || event.series_summary,
    status: [timeLabel(event), cost].filter(Boolean).join(" · ") || null,
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

async function eventCandidates(intent: AskIntent, today: string) {
  if (!intent.objectTypes.includes("occurrence") && intent.questionKind !== "events") return [] as PublicMatch[];
  const { events } = await loadEvents(120);
  const filtered = events.filter((event) => {
    if (intent.city && event.city?.toLowerCase() !== intent.city.toLowerCase()) return false;
    if (intent.eventCategory && !event.categories.includes(intent.eventCategory)) return false;
    if (!dateInIntentRange(event, intent, today)) return false;
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
    if (group.length > 1 && group[0].series_key) matches.push(seriesCandidate(group, score));
    else matches.push(eventCandidate(group[0], score));
  }

  return matches
    .sort((a, b) => b.score - a.score || (a.title.localeCompare(b.title)))
    .slice(0, 12);
}

function currentAvailabilitySummary(value: unknown) {
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
  if (!objectTypes.length) return [] as PublicMatch[];
  const query = intent.searchQuery.trim();
  if (!query) return [] as PublicMatch[];

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) return [] as PublicMatch[];
  const { url } = getAtlasSupabaseConfig();
  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    db: { schema: "local_intel" },
  });

  const { data, error } = await supabase.rpc("search_local_answers_v2", {
    p_query: query,
    p_object_types: objectTypes,
    p_city: intent.city,
    p_start_at: null,
    p_end_at: null,
    p_limit: 24,
  });

  if (error) {
    console.error("Elm Local answer inventory search failed", error.message);
    return [];
  }

  return ((data ?? []) as LocalAnswerRow[]).map((row) => {
    const fresh = row.availability_freshness === "current" ? "current"
      : row.availability_freshness === "stale" ? "stale"
        : "unknown";
    const currentSummary = fresh === "current" ? currentAvailabilitySummary(row.current_availability) : null;
    const status = currentSummary
      || (intent.requiresFreshCurrentState
        ? fresh === "stale"
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
      currentState: fresh,
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

function candidateFacts(matches: PublicMatch[]) {
  return matches.map((match) => ({
    id: match.id,
    kind: match.kind,
    title: match.title,
    place: match.subtitle,
    city: match.city,
    category: match.category,
    summary: match.summary,
    status: match.status,
    currentState: match.currentState,
    sourceChecked: match.sourceChecked,
  }));
}

function fallbackAnswer(question: string, intent: AskIntent, candidates: PublicMatch[]) {
  if (!candidates.length) {
    if (intent.requiresFreshCurrentState) {
      return "I don’t have a fresh, verified local match for that right now. I’d rather say that than turn an old listing into current availability.";
    }
    return "I don’t have a verified local match for that yet. Try phrasing it another way, or tell me one more thing that matters and I’ll narrow it down.";
  }

  if (intent.requiresFreshCurrentState) {
    const current = candidates.filter((candidate) => candidate.currentState === "current" || candidate.kind === "event" || candidate.kind === "series");
    if (!current.length) {
      return `I found ${candidates.length} possible ${candidates.length === 1 ? "source" : "sources"}, but I don’t have fresh availability confirmation for them right now.`;
    }
    const names = current.slice(0, 3).map((candidate) => candidate.title).join(", ");
    return `I found ${current.length} current ${current.length === 1 ? "match" : "matches"}. ${names}${current.length > 3 ? " and a few more" : ""}.`;
  }

  const names = candidates.slice(0, 3).map((candidate) => candidate.title).join(", ");
  return `I found ${candidates.length} good local ${candidates.length === 1 ? "match" : "matches"} for “${question}.” The strongest are ${names}${candidates.length > 3 ? " and a few more" : ""}.`;
}

async function composeAnswer(question: string, intent: AskIntent, candidates: PublicMatch[]) {
  if (!candidates.length) return { answer: fallbackAnswer(question, intent, candidates), selectedIds: [] as string[], aiAvailable: true };

  const system = `You are Elm Local's public answer voice. The database records supplied to you are the only local facts you may use.\n\nFOUNDATIONAL RULE: The AI interprets and explains; the database knows. Never add a business, product, event, price, time, availability claim, recommendation fact, or status that is not present in the candidate records.\n\nAnswer the user's actual question in ordinary, concise language. Keep the answer under 70 words. Do not use markdown bullets.\n\nIf requiresFreshCurrentState is true, only describe something as currently available/open/accepting/in stock when currentState=current and the status explicitly supports that claim. A durable offering with currentState=unknown or stale may be described as a possible known source, but you must clearly say Elm does not have fresh confirmation.\n\nFuture published event/series records may be described as scheduled upcoming happenings.\n\nChoose up to ${MAX_MATCHES} candidate IDs that directly support the answer. Never output an ID that is not supplied.`;

  try {
    const generated = await callGatewayStructured<{ answer: string; selectedIds: string[] }>(
      "elm_local_answer",
      ANSWER_SCHEMA,
      system,
      JSON.stringify({ question, intent, candidates: candidateFacts(candidates) }),
    );
    const allowed = new Set(candidates.map((candidate) => candidate.id));
    const selectedIds = Array.isArray(generated.selectedIds)
      ? [...new Set(generated.selectedIds.filter((id) => allowed.has(id)))].slice(0, MAX_MATCHES)
      : [];
    return {
      answer: safeString(generated.answer, 700) || fallbackAnswer(question, intent, candidates),
      selectedIds,
      aiAvailable: true,
    };
  } catch (error) {
    console.error("Elm Local answer composer unavailable", error);
    return {
      answer: fallbackAnswer(question, intent, candidates),
      selectedIds: candidates.slice(0, Math.min(MAX_MATCHES, candidates.length)).map((candidate) => candidate.id),
      aiAvailable: false,
    };
  }
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

  const body = await request.json().catch(() => null) as {
    question?: unknown;
    previousIntent?: AskIntent | null;
  } | null;
  const question = safeString(body?.question, MAX_QUESTION_LENGTH);
  if (!question) return json({ ok: false, error: "Ask Elm a question first." }, 400);

  const today = localDateKey(new Date());
  const previousIntent = body?.previousIntent && typeof body.previousIntent === "object" ? body.previousIntent : null;
  const interpreted = await interpretQuestion(question, previousIntent, today);
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

  const [events, local] = await Promise.all([
    eventCandidates(intent, today),
    localCandidates(intent),
  ]);
  const candidates = [...events, ...local]
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, MAX_CANDIDATES_FOR_ANSWER);

  const composed = await composeAnswer(question, intent, candidates);
  const selectedSet = new Set(composed.selectedIds);
  const selected = composed.selectedIds.length
    ? candidates.filter((candidate) => selectedSet.has(candidate.id))
    : candidates.slice(0, Math.min(MAX_MATCHES, candidates.length));

  return json({
    ok: true,
    question,
    answer: composed.answer,
    intent,
    matches: selected.map(({ score: _score, ...match }) => match),
    calendarHref: calendarHref(intent, today, candidates),
    aiAvailable: interpreted.aiAvailable && composed.aiAvailable,
    needsClarification: false,
  });
}
