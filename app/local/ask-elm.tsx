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

const PROMPTS = [
  "What’s happening this weekend?",
  "Anything free for kids Saturday?",
  "Where can I buy local honey?",
  "Who’s accepting new dental patients?",
];

function matchLabel(match: AskMatch) {
  if (match.kind === "event") return "Event";
  if (match.kind === "series") return "Recurring series";
  if (match.kind === "offering") return "Local offering";
  return "Local place";
}

function MatchCard({ match }: { match: AskMatch }) {
  const primaryHref = match.href || match.externalUrl;
  const external = !match.href && Boolean(match.externalUrl);

  return (
    <article className="elm-local-ask-match">
      <div className="elm-local-ask-match__topline">
        <span>{matchLabel(match)}</span>
        {match.currentState === "stale" ? <strong className="is-muted">Needs refresh</strong> : null}
      </div>
      <h3>
        {primaryHref ? (
          <a href={primaryHref} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined}>
            {match.title}
          </a>
        ) : match.title}
      </h3>
      {match.subtitle ? <p className="elm-local-ask-match__where">{match.subtitle}</p> : null}
      {match.status ? <p className="elm-local-ask-match__status">{match.status}</p> : null}
      {!match.status && match.summary ? <p>{match.summary}</p> : null}
      {match.category ? (
        <div className="elm-local-ask-match__meta">
          <span>{match.category}</span>
        </div>
      ) : null}
      <div className="elm-local-ask-match__actions">
        {match.href ? <a href={match.href}>Details →</a> : null}
        {!match.href && match.externalUrl ? <a href={match.externalUrl} target="_blank" rel="noreferrer">Official site ↗</a> : null}
        {match.phone ? <a href={`tel:${match.phone.replace(/[^0-9+]/g, "")}`}>Call {match.phone}</a> : null}
      </div>
    </article>
  );
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
      setResponse({ ok: false, error: "Elm couldn’t reach the local answer layer just now. Try again." });
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void ask(question);
  }

  return (
    <div className="elm-local-ask" aria-live="polite">
      <form className="elm-local-ask-form" onSubmit={submit}>
        <label>
          <span className="sr-only">Ask Elm a local question</span>
          <textarea
            name="question"
            rows={2}
            maxLength={600}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Ask about what’s happening, what’s available, or where to find something nearby…"
          />
        </label>
        <button type="submit" disabled={loading || !question.trim()}>{loading ? "Looking…" : "Ask Elm"}</button>
      </form>

      <div className="elm-local-ask-prompts" aria-label="Example questions">
        {PROMPTS.map((prompt) => (
          <button key={prompt} type="button" onClick={() => void ask(prompt)} disabled={loading}>{prompt}</button>
        ))}
      </div>

      {response ? (
        <section className={`elm-local-ask-answer${response.ok ? "" : " is-error"}`}>
          {response.ok ? (
            <>
              <div className="elm-local-ask-answer__heading">
                <div>
                  <p className="elm-local-kicker">Elm says</p>
                  {response.question ? <span>{response.question}</span> : null}
                </div>
              </div>
              <p className="elm-local-ask-answer__copy">{response.answer}</p>
              {response.matches?.length ? (
                <div className="elm-local-ask-match-grid">
                  {response.matches.map((match) => <MatchCard key={match.id} match={match} />)}
                </div>
              ) : null}
              {response.calendarHref ? (
                <div className="elm-local-ask-answer__footer">
                  <a href={response.calendarHref}>Show this on the calendar →</a>
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
