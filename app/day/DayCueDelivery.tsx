"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

type Choice = {
  value: string;
  label: string;
};

type Question = {
  key: string;
  prompt: string;
  choices?: Choice[];
  input?: "number" | "text";
  placeholder?: string;
  when?: { key: string; equals: string };
};

type Cue = {
  cueId: string;
  cueKind: "briefing" | "requirement" | "observation" | "somatic" | "result";
  anchorKind: "first_open" | "before_task" | "after_task" | "at_time";
  title: string;
  body: string | null;
  payload: Record<string, unknown>;
  status: "waiting" | "available" | "unseen" | "stale" | "resolved" | "dismissed";
  recoveryPolicy: "refresh" | "expire" | "persist" | "block";
  availableFrom: string | null;
  expiresAt: string | null;
  scheduledAt: string | null;
};

type ChoreographyResponse = {
  ok?: boolean;
  target?: { source?: "worker_self" | "owner_direct" | "operator_lens" } | null;
  choreography?: { cues?: Cue[] } | null;
};

function validDate(value: string | null) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function choices(value: unknown): Choice[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const row = object(entry);
    return row && typeof row.value === "string" && typeof row.label === "string"
      ? [{ value: row.value, label: row.label }]
      : [];
  });
}

function questions(value: unknown): Question[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const row = object(entry);
    if (!row || typeof row.key !== "string" || typeof row.prompt !== "string") return [];
    const when = object(row.when);
    return [{
      key: row.key,
      prompt: row.prompt,
      choices: choices(row.choices),
      input: row.input === "number" ? "number" : row.input === "text" ? "text" : undefined,
      placeholder: typeof row.placeholder === "string" ? row.placeholder : undefined,
      when: when && typeof when.key === "string" && typeof when.equals === "string"
        ? { key: when.key, equals: when.equals }
        : undefined,
    }];
  });
}

function cueIsDue(cue: Cue) {
  if (!["available", "unseen", "stale"].includes(cue.status)) return false;
  const now = Date.now();
  if (cue.availableFrom && new Date(cue.availableFrom).getTime() > now) return false;
  if (cue.scheduledAt && cue.anchorKind === "at_time" && new Date(cue.scheduledAt).getTime() > now) return false;
  if (cue.expiresAt && new Date(cue.expiresAt).getTime() < now && cue.recoveryPolicy === "expire") return false;
  return cue.anchorKind === "first_open" || cue.anchorKind === "at_time";
}

function actionLabel(cue: Cue) {
  const value = cue.payload.actionLabel;
  if (typeof value === "string" && value.trim()) return value;
  if (cue.cueKind === "briefing") return "Start today";
  return "Continue";
}

export default function DayCueDelivery() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedDate = searchParams.get("date");
  const dateIso = pathname === "/day" && validDate(requestedDate) ? requestedDate as string : null;
  const [response, setResponse] = useState<ChoreographyResponse | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [dismissedForSession, setDismissedForSession] = useState<Set<string>>(new Set());

  async function load(signal?: AbortSignal) {
    if (!dateIso) return;
    try {
      const request = await fetch(`/api/atlas/day-choreography?date=${encodeURIComponent(dateIso)}`, {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        signal,
      });
      const body = await request.json() as ChoreographyResponse;
      if (!signal?.aborted) setResponse(request.ok && body.ok ? body : null);
    } catch {
      if (!signal?.aborted) setResponse(null);
    }
  }

  useEffect(() => {
    setResponse(null);
    setAnswers({});
    setDismissedForSession(new Set());
    if (!dateIso) return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [dateIso]);

  const currentCue = useMemo(() => {
    // Owner can inspect cues in purple Day Edit without being interrupted by the
    // worker's first-open experience. Automatic cue delivery belongs to the worker.
    if (response?.target?.source !== "worker_self") return null;
    return (response.choreography?.cues ?? []).find((cue) => cueIsDue(cue) && !dismissedForSession.has(cue.cueId)) ?? null;
  }, [dismissedForSession, response]);

  const allQuestions = useMemo(() => currentCue ? questions(currentCue.payload.questions) : [], [currentCue]);
  const visibleQuestions = useMemo(() => allQuestions.filter((question) => !question.when || answers[question.when.key] === question.when.equals), [allQuestions, answers]);
  const currentQuestion = visibleQuestions.find((question) => answers[question.key] === undefined) ?? null;
  const simpleChoices = currentCue ? choices(currentCue.payload.choices) : [];

  async function resolveCue(extraResponse: Record<string, string> = {}) {
    if (!currentCue || saving) return;
    setSaving(true);
    try {
      const request = await fetch("/api/atlas/day-cue-response", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "x-atlas-intent": "day-cue-response-v1",
        },
        body: JSON.stringify({ cueId: currentCue.cueId, response: { ...answers, ...extraResponse } }),
      });
      if (!request.ok) throw new Error("Cue response failed");
      setAnswers({});
      setDismissedForSession((current) => new Set(current).add(currentCue.cueId));
      await load();
    } catch {
      // Keep the cue on screen so the worker can try again; do not manufacture a
      // resolved state when Atlas did not persist the answer.
    } finally {
      setSaving(false);
    }
  }

  function answerQuestion(question: Question, value: string) {
    const next = { ...answers, [question.key]: value };
    setAnswers(next);
    const stillPending = allQuestions.some((candidate) => {
      if (candidate.key === question.key) return false;
      if (candidate.when && next[candidate.when.key] !== candidate.when.equals) return false;
      return next[candidate.key] === undefined;
    });
    if (!stillPending) void resolveCue({ [question.key]: value });
  }

  if (!currentCue) return null;

  const prompt = currentQuestion?.prompt
    ?? (typeof currentCue.payload.prompt === "string" ? currentCue.payload.prompt : null)
    ?? currentCue.body;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={currentCue.title}
      data-atlas-day-cue-delivery="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 160,
        display: "grid",
        alignItems: "end",
        background: "rgba(31,42,35,.18)",
        padding: "max(12px, env(safe-area-inset-top)) 12px max(14px, env(safe-area-inset-bottom))",
      }}
    >
      <section style={{
        width: "min(100%, 520px)",
        margin: "0 auto",
        borderRadius: 22,
        padding: "18px 18px 16px",
        background: "#f8f5e9",
        boxShadow: "0 18px 60px rgba(34,45,36,.22)",
        border: "1px solid rgba(50,72,56,.13)",
      }}>
        <small style={{ display: "block", fontSize: 10, fontWeight: 900, letterSpacing: ".11em", textTransform: "uppercase", opacity: .5 }}>
          {currentCue.cueKind === "briefing" ? "Today at Elm" : currentCue.cueKind === "observation" ? "Quick check" : "Before we keep going"}
        </small>
        <strong style={{ display: "block", marginTop: 5, fontSize: 19, lineHeight: 1.15 }}>{currentCue.title}</strong>
        {prompt ? <p style={{ margin: "8px 0 0", fontSize: 13.5, lineHeight: 1.45, opacity: .78 }}>{prompt}</p> : null}

        {currentQuestion?.choices?.length ? (
          <div style={{ display: "grid", gap: 7, marginTop: 14 }}>
            {currentQuestion.choices.map((choice) => (
              <button key={choice.value} type="button" disabled={saving} onClick={() => answerQuestion(currentQuestion, choice.value)} style={{ border: "1px solid rgba(50,72,56,.15)", borderRadius: 13, padding: "11px 12px", background: "rgba(255,255,255,.72)", font: "inherit", fontSize: 12.5, fontWeight: 800, textAlign: "left" }}>
                {choice.label}
              </button>
            ))}
          </div>
        ) : currentQuestion?.input ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const value = String(form.get("cue-value") ?? "").trim();
              if (value) answerQuestion(currentQuestion, value);
            }}
            style={{ display: "grid", gap: 7, marginTop: 14 }}
          >
            <input name="cue-value" type={currentQuestion.input} inputMode={currentQuestion.input === "number" ? "numeric" : undefined} placeholder={currentQuestion.placeholder} required style={{ border: "1px solid rgba(50,72,56,.16)", borderRadius: 12, padding: "11px 12px", background: "rgba(255,255,255,.76)", font: "inherit", fontSize: 13 }} />
            <button type="submit" disabled={saving} style={{ border: 0, borderRadius: 13, padding: "11px 12px", background: "#e8e43c", color: "#293126", font: "inherit", fontSize: 12.5, fontWeight: 900 }}>Continue</button>
          </form>
        ) : simpleChoices.length ? (
          <div style={{ display: "grid", gap: 7, marginTop: 14 }}>
            {simpleChoices.map((choice) => (
              <button key={choice.value} type="button" disabled={saving} onClick={() => void resolveCue({ choice: choice.value })} style={{ border: "1px solid rgba(50,72,56,.15)", borderRadius: 13, padding: "11px 12px", background: "rgba(255,255,255,.72)", font: "inherit", fontSize: 12.5, fontWeight: 800, textAlign: "left" }}>
                {choice.label}
              </button>
            ))}
          </div>
        ) : (
          <button type="button" disabled={saving} onClick={() => void resolveCue()} style={{ width: "100%", marginTop: 14, border: 0, borderRadius: 13, padding: "11px 12px", background: "#e8e43c", color: "#293126", font: "inherit", fontSize: 12.5, fontWeight: 900 }}>
            {saving ? "Saving…" : actionLabel(currentCue)}
          </button>
        )}
      </section>
    </div>
  );
}
