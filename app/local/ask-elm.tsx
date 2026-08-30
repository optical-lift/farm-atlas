"use client";

import { FormEvent, KeyboardEvent, useMemo, useRef, useState } from "react";

type AskIntent = {
  questionKind: "events" | "product" | "service" | "place" | "availability" | "general";
  searchQuery: string;
  objectTypes: Array<"entity" | "offering" | "occurrence">;
  city: string | null;
  dateStart: string | null;
  dateEnd: string | null;
  timeOfDay: "any" | "morning" | "afternoon" | "evening" | "night" | "now";
  eventCategory: string | null;
  requiresFreshCurrentState: boolean;
  clarificationQuestion: string | null;
};

type AskMatch = {
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
};

type AskResponse = {
  ok: boolean;
  question?: string;
  answer?: string;
  intent?: AskIntent;
  matches?: AskMatch[];
  calendarHref?: string | null;
  needsClarification?: boolean;
  error?: string;
};

// Product invariant: Ask Elm answers remain grounded in governed local records.
// That provenance belongs in implementation custody, not as technical chrome on the public conversation.
const ANSWER_MENTION_LIMIT = 3;

function businessName(match: AskMatch) {
  return match.kind === "offering" && match.subtitle ? match.subtitle : match.title;
}

function businessKey(match: AskMatch) {
  return businessName(match)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function broadFlowerQuestion(question: string) {
  const lower = question.toLowerCase();
  return /\bflowers?\b/.test(lower) && !/\b(florist|funeral|sympathy|wedding|bridal|delivery)\b/.test(lower);
}

function flowerScore(match: AskMatch) {
  const name = businessName(match).toLowerCase();
  const haystack = [match.title, match.subtitle, match.summary, match.category].filter(Boolean).join(" ").toLowerCase();
  let score = 0;
  if (name === "elm farm" && /\bflowers?\b|flower farm|cut flower/.test(haystack)) score += 1000;
  if (/flower farm|farm flowers|cut flowers|cut flower/.test(haystack)) score += 500;
  if (/\bfarm\b/.test(haystack) && /\bflowers?\b/.test(haystack)) score += 300;
  if (/florist|floral/.test(haystack)) score += 100;
  return score;
}

function answerMatches(response: AskResponse) {
  const source = response.matches ?? [];
  const eligible = response.intent?.requiresFreshCurrentState
    ? source.filter((match) => match.currentState === "current" || match.kind === "event" || match.kind === "series")
    : source;

  const deduped: AskMatch[] = [];
  const seen = new Set<string>();
  for (const match of eligible) {
    const key = businessKey(match) || match.id;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(match);
  }

  if (!broadFlowerQuestion(response.question ?? "")) return deduped;
  return deduped
    .map((match, index) => ({ match, index, score: flowerScore(match) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ match }) => match);
}

function naturalList(names: string[]) {
  if (!names.length) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function answerCopy(response: AskResponse, eligible: AskMatch[]) {
  if (response.needsClarification) return response.answer;

  const mentioned = eligible.slice(0, ANSWER_MENTION_LIMIT);
  if (!mentioned.length) return response.answer;

  const [first, ...alternatives] = mentioned;
  const hiddenCount = Math.max(0, eligible.length - mentioned.length);
  const isEventAnswer = response.intent?.questionKind === "events";
  const flowerQuestion = broadFlowerQuestion(response.question ?? "");
  const firstName = businessName(first);

  let copy: string;
  if (flowerQuestion && firstName.toLowerCase() === "elm farm") {
    copy = "Elm Farm is the flower farm I’d start with.";
    if (alternatives.length) {
      copy += ` ${naturalList(alternatives.map(businessName))} ${alternatives.length === 1 ? "is another nearby option" : "are other nearby options"}.`;
    }
  } else if (isEventAnswer) {
    copy = `${firstName} is the first one I’d look at.`;
    if (alternatives.length) {
      copy += ` ${naturalList(alternatives.map(businessName))} ${alternatives.length === 1 ? "also fits" : "also fit"}.`;
    }
  } else if (first.city?.toLowerCase() === "marshfield") {
    copy = `${firstName} is right in Marshfield, so I’d start there.`;
    if (alternatives.length) {
      copy += ` ${naturalList(alternatives.map(businessName))} ${alternatives.length === 1 ? "is another nearby option" : "are other nearby options"}.`;
    }
  } else {
    copy = `${firstName} is the first place I’d try.`;
    if (alternatives.length) {
      copy += ` ${naturalList(alternatives.map(businessName))} ${alternatives.length === 1 ? "is another option" : "are other options nearby"}.`;
    }
  }

  if (hiddenCount > 0) copy += ` I found ${hiddenCount} more if you want ${hiddenCount === 1 ? "it" : "them"}.`;
  return copy;
}

function phoneHref(phone: string) {
  return `tel:${phone.replace(/[^0-9+]/g, "")}`;
}

function PrimaryDetail({ match }: { match: AskMatch }) {
  const primaryHref = match.href || match.externalUrl;
  const external = !match.href && Boolean(match.externalUrl);

  return (
    <div className="elm-local-ask-primary">
      <strong>{businessName(match)}</strong>
      <div className="elm-local-ask-primary__actions">
        {match.phone ? <a className="elm-local-ask-primary__phone" href={phoneHref(match.phone)}>{match.phone}</a> : null}
        {primaryHref ? (
          <a href={primaryHref} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined}>
            {match.href ? "Details" : "Website"} →
          </a>
        ) : null}
      </div>
    </div>
  );
}

function MoreDetail({ match }: { match: AskMatch }) {
  const primaryHref = match.href || match.externalUrl;
  const external = !match.href && Boolean(match.externalUrl);

  return (
    <div className="elm-local-ask-more-row">
      <strong>{businessName(match)}</strong>
      <div>
        {match.phone ? <a href={phoneHref(match.phone)}>{match.phone}</a> : null}
        {primaryHref ? (
          <a href={primaryHref} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined}>
            {match.href ? "Details" : "Website"} →
          </a>
        ) : null}
      </div>
    </div>
  );
}

function wantsMore(value: string) {
  return /^(yes|yeah|yep|sure|more|show more|show me more|show the others|show me the others|other options|the others|others)[.!?\s]*$/i.test(value.trim());
}

export default function AskElm() {
  const [draft, setDraft] = useState("");
  const [response, setResponse] = useState<AskResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const requestId = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const followupRef = useRef<HTMLInputElement>(null);

  const eligibleMatches = useMemo(() => response?.ok ? answerMatches(response) : [], [response]);
  const primaryMatch = eligibleMatches[0] ?? null;
  const hiddenMatches = eligibleMatches.slice(ANSWER_MENTION_LIMIT);

  async function ask(value: string) {
    const clean = value.trim();
    if (!clean || loading) return;

    if (response?.ok && hiddenMatches.length && wantsMore(clean)) {
      setShowAll(true);
      setDraft("");
      requestAnimationFrame(() => followupRef.current?.focus());
      return;
    }

    setLoading(true);
    setShowAll(false);
    const id = ++requestId.current;

    try {
      const result = await fetch("/api/local/ask-v2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: clean,
          previousIntent: response?.intent ?? null,
        }),
      });
      const payload = await result.json() as AskResponse;
      if (id !== requestId.current) return;
      setResponse(payload.ok ? payload : { ok: false, question: clean, error: payload.error || "Elm couldn’t answer that just now." });
      setDraft("");
    } catch {
      if (id !== requestId.current) return;
      setResponse({ ok: false, question: clean, error: "Elm couldn’t answer that just now. Try again." });
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void ask(draft);
  }

  function goOnEnter(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void ask(draft);
  }

  return (
    <div className={`elm-local-ask${response ? " has-response" : ""}`} aria-live="polite">
      {!response ? (
        <form className="elm-local-ask-form" onSubmit={submit}>
          <label>
            <span className="sr-only">Ask Elm a local question</span>
            <input
              ref={inputRef}
              name="question"
              type="text"
              inputMode="text"
              enterKeyHint="go"
              autoComplete="off"
              maxLength={600}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={goOnEnter}
              placeholder="Ask Elm anything local…"
            />
          </label>
          <button type="submit" disabled={loading || !draft.trim()}>{loading ? "…" : "Ask Elm"}</button>
        </form>
      ) : (
        <div className="elm-local-ask-query"><span>{response.question}</span></div>
      )}

      {response ? (
        <section className={`elm-local-ask-answer${response.ok ? "" : " is-error"}`}>
          {response.ok ? (
            <>
              {primaryMatch ? <PrimaryDetail match={primaryMatch} /> : null}
              <p className="elm-local-ask-answer__copy">{answerCopy(response, eligibleMatches)}</p>

              {hiddenMatches.length && !showAll ? (
                <button className="elm-local-ask-more-button" type="button" onClick={() => setShowAll(true)}>
                  Show {hiddenMatches.length === 1 ? "the other option" : `the other ${hiddenMatches.length}`}
                </button>
              ) : null}

              {showAll && hiddenMatches.length ? (
                <div className="elm-local-ask-more" aria-label="More local options">
                  {hiddenMatches.map((match) => <MoreDetail key={match.id} match={match} />)}
                </div>
              ) : null}
            </>
          ) : (
            <p className="elm-local-ask-answer__copy">{response.error}</p>
          )}

          <form className="elm-local-ask-followup" onSubmit={submit}>
            <label>
              <span className="sr-only">Ask Elm another question</span>
              <input
                ref={followupRef}
                name="followup"
                type="text"
                inputMode="text"
                enterKeyHint="go"
                autoComplete="off"
                maxLength={600}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={goOnEnter}
                placeholder="Ask another question…"
              />
            </label>
            <button type="submit" aria-label="Go" disabled={loading || !draft.trim()}>{loading ? "…" : "Go"}</button>
          </form>
        </section>
      ) : null}
    </div>
  );
}
