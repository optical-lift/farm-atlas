"use client";

import { FormEvent, useRef, useState } from "react";

type AskEvidence = {
  id: string;
  kind: string;
  label: string;
  detail: string;
  href: string | null;
};

type AskResponse = {
  ok: boolean;
  question?: string;
  answer?: string;
  evidence?: AskEvidence[];
  limitations?: string | null;
  answeredForDate?: string;
  readOnly?: boolean;
  error?: string;
};

const PROMPTS = [
  "What has fallen through the cracks?",
  "What is blocked right now?",
  "What is Anna doing this week?",
  "What needs my attention first?",
];

export default function AskAtlasOwner() {
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
      const result = await fetch("/api/owner/ask-atlas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: clean }),
      });
      const payload = await result.json() as AskResponse;
      if (id !== requestId.current) return;
      setResponse(payload.ok ? payload : { ok: false, error: payload.error || "Atlas couldn’t answer that just now." });
    } catch {
      if (id !== requestId.current) return;
      setResponse({ ok: false, error: "Atlas couldn’t answer that just now. Try again." });
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void ask(question);
  }

  return (
    <section className="atlas-owner-ask" aria-live="polite">
      <div className="atlas-owner-ask__heading">
        <div>
          <span>Read Atlas</span>
          <strong>Ask Atlas</strong>
        </div>
        <small>Read-only</small>
      </div>

      <form className="atlas-owner-ask__form" onSubmit={submit}>
        <label>
          <span className="sr-only">Ask Atlas about the current farm record</span>
          <textarea
            rows={1}
            maxLength={600}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="What do I need to know?"
          />
        </label>
        <button type="submit" disabled={loading || !question.trim()}>{loading ? "Reading…" : "Ask"}</button>
      </form>

      {!response ? (
        <div className="atlas-owner-ask__prompts" aria-label="Example Ask Atlas questions">
          {PROMPTS.map((prompt) => (
            <button key={prompt} type="button" onClick={() => void ask(prompt)} disabled={loading}>{prompt}</button>
          ))}
        </div>
      ) : null}

      {response ? (
        <div className={`atlas-owner-ask__answer${response.ok ? "" : " is-error"}`}>
          {response.ok ? (
            <>
              <p>{response.answer}</p>
              {response.evidence?.length ? (
                <div className="atlas-owner-ask__evidence">
                  <span>Atlas records used</span>
                  {response.evidence.map((item) => {
                    const content = (
                      <>
                        <strong>{item.label}</strong>
                        <small>{item.detail}</small>
                      </>
                    );
                    return item.href ? <a href={item.href} key={item.id}>{content}</a> : <div key={item.id}>{content}</div>;
                  })}
                </div>
              ) : null}
              {response.limitations ? <small className="atlas-owner-ask__limits">{response.limitations}</small> : null}
            </>
          ) : <p>{response.error}</p>}
        </div>
      ) : null}
    </section>
  );
}
