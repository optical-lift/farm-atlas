"use client";

import { FormEvent, useRef, useState } from "react";

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
const PROMPTS = [
  "What’s happening this weekend?",
  "Anything free for kids Saturday?",
  "Where can I buy local honey?",
  "Who’s accepting new dental patients?",
];

const CONVERSATIONAL_MATCH_LIMIT = 4;

function MatchCard({ match }: { match: AskMatch }) {
  const primaryHref = match.href || match.externalUrl;
  const external = !match.href && Boolean(match.externalUrl);

  return (
    <article className="elm-local-ask-match">
      <div className="elm-local-ask-match__title-row">
        <h3>
          {primaryHref ? (
            <a href={primaryHref} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined}>
              {match.title}
            </a>
          ) : match.title}
        </h3>
        {match.currentState === "stale" ? <span className="elm-local-ask-match__refresh">Needs refresh</span> : null}
      </div>
      {match.subtitle ? <p className="elm-local-ask-match__where">{match.subtitle}</p> : null}
      {match.summary ? <p className="elm-local-ask-match__summary">{match.summary}</p> : null}
      <div className="elm-local-ask-match__actions">
        {match.href ? <a href={match.href}>Details →</a> : null}
        {!match.href && match.externalUrl ? <a href={match.externalUrl} target="_blank" rel="noreferrer">Website ↗</a> : null}
        {match.phone ? <a href={`tel:${match.phone.replace(/[^0-9+]/g, "")}`}>{match.phone}</a> : null}
      </div>
    </article>
  );
}

function conversationalMatches(response: AskResponse) {
  const matches = response.matches ?? [];
  if (!response.intent?.requiresFreshCurrentState) return matches.slice(0, CONVERSATIONAL_MATCH_LIMIT);

  return matches
    .filter((match) => match.currentState === "current" || match.kind === "event" || match.kind === "series")
    .slice(0, CONVERSATIONAL_MATCH_LIMIT);
}

function naturalList(names: string[]) {
  if (!names.length) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function answerCopy(response: AskResponse) {
  if (response.needsClarification) return response.answer;

  const allMatches = response.matches ?? [];
  const visible = conversationalMatches(response);
  if (!visible.length) return response.answer;

  const [first, ...alternatives] = visible;
  const hiddenCount = Math.max(0, allMatches.length - visible.length);
  const isEventAnswer = response.intent?.questionKind === "events";

  let copy: string;
  if (isEventAnswer) {
    copy = `${first.title} is the first one I’d look at.`;
    if (alternatives.length) {
      copy += ` ${naturalList(alternatives.map((match) => match.title))} ${alternatives.length === 1 ? "also fits" : "also fit"}.`;
    }
  } else if (first.city?.toLowerCase() === "marshfield") {
    copy = `${first.title} is right in Marshfield, so I’d start there.`;
    if (alternatives.length) {
      copy += ` ${naturalList(alternatives.map((match) => match.title))} ${alternatives.length === 1 ? "is another nearby option" : "are other nearby options"}.`;
    }
  } else {
    copy = `${first.title} is the first place I’d try.`;
    if (alternatives.length) {
      copy += ` ${naturalList(alternatives.map((match) => match.title))} ${alternatives.length === 1 ? "is another option" : "are other options nearby"}.`;
    }
  }

  if (hiddenCount > 0) copy += ` I found ${hiddenCount} more if you want ${hiddenCount === 1 ? "it" : "them"}.`;
  return copy;
}

export default function AskElm() {
  const [question, setQuestion] = useState("");
  const [response, setResponse] = useState<AskResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const requestId = useRef(0);

  async function ask(value: string) {
    const clean = value.trim();
    if (!clean || loading) return;
    setQuestion(clean);
    setLoading(true);
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
      setResponse(payload.ok ? payload : { ok: false, error: payload.error || "Elm couldn’t answer that just now." });
    } catch {
      if (id !== requestId.current) return;
      setResponse({ ok: false, error: "Elm couldn’t answer that just now. Try again." });
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void ask(question);
  }

  const visibleMatches = response?.ok ? conversationalMatches(response) : [];

  return (
    <div className="elm-local-ask" aria-live="polite">
      <form className="elm-local-ask-form" onSubmit={submit}>
        <label>
          <span className="sr-only">Ask Elm a local question</span>
          <textarea
            name="question"
            rows={1}
            maxLength={600}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Ask Elm anything local…"
          />
        </label>
        <button type="submit" disabled={loading || !question.trim()}>{loading ? "Looking…" : "Ask Elm"}</button>
      </form>

      {!response ? (
        <div className="elm-local-ask-prompts" aria-label="Example questions">
          {PROMPTS.map((prompt) => (
            <button key={prompt} type="button" onClick={() => void ask(prompt)} disabled={loading}>{prompt}</button>
          ))}
        </div>
      ) : null}

      {response ? (
        <section className={`elm-local-ask-answer${response.ok ? "" : " is-error"}`}>
          {response.ok ? (
            <>
              <p className="elm-local-ask-answer__copy">{answerCopy(response)}</p>
              {visibleMatches.length ? (
                <div className="elm-local-ask-match-grid">
                  {visibleMatches.map((match) => <MatchCard key={match.id} match={match} />)}
                </div>
              ) : null}
              {response.calendarHref ? (
                <div className="elm-local-ask-answer__footer">
                  <a href={response.calendarHref}>View on calendar →</a>
                </div>
              ) : null}
            </>
          ) : (
            <p className="elm-local-ask-answer__copy">{response.error}</p>
          )}
        </section>
      ) : null}
    </div>
  );
}
