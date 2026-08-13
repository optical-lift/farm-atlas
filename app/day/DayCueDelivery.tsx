"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

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
  cueKind: string;
  anchorKind: string;
  anchorTaskId?: string | null;
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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function cueTaskId(cue: Cue) {
  const payloadTaskId = typeof cue.payload.taskId === "string" ? cue.payload.taskId.trim() : "";
  if (UUID_PATTERN.test(payloadTaskId)) return payloadTaskId;
  const anchorTaskId = typeof cue.anchorTaskId === "string" ? cue.anchorTaskId.trim() : "";
  return UUID_PATTERN.test(anchorTaskId) ? anchorTaskId : null;
}

export default function DayCueDelivery() {
  const pathname = usePathname();
  const router = useRouter();
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

  const targetSource = response?.target?.source ?? null;
  const isOperatorPreview = targetSource === "operator_lens";
  const currentCue = useMemo(() => {
    if (targetSource !== "worker_self" && targetSource !== "operator_lens") return null;
    return (response?.choreography?.cues ?? []).find((cue) => cueIsDue(cue) && !dismissedForSession.has(cue.cueId)) ?? null;
  }, [dismissedForSession, response, targetSource]);

  const allQuestions = useMemo(() => currentCue ? questions(currentCue.payload.questions) : [], [currentCue]);
  const visibleQuestions = useMemo(() => allQuestions.filter((question) => !question.when || answers[question.when.key] === question.when.equals), [allQuestions, answers]);
  const currentQuestion = visibleQuestions.find((question) => answers[question.key] === undefined) ?? null;
  const simpleChoices = currentCue ? choices(currentCue.payload.choices) : [];

  function hideCueForSession() {
    if (!currentCue) return;
    setAnswers({});
    setDismissedForSession((current) => new Set(current).add(currentCue.cueId));
  }

  async function resolveCue(extraResponse: Record<string, string> = {}) {
    if (!currentCue || saving) return;

    if (isOperatorPreview) {
      hideCueForSession();
      return;
    }

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
      // Keep the cue available so the worker can retry. Atlas never manufactures
      // an acknowledgement when the write did not persist.
    } finally {
      setSaving(false);
    }
  }

  async function openCueTask() {
    if (!currentCue || !dateIso || saving) return;
    const taskId = cueTaskId(currentCue);
    if (!taskId) {
      await resolveCue();
      return;
    }

    if (!isOperatorPreview) await resolveCue({ opened: "true" });
    const returnTo = `/day?date=${dateIso}`;
    router.push(`/task-focus/${taskId}?returnTo=${encodeURIComponent(returnTo)}`);
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
  const targetTaskId = cueTaskId(currentCue);

  return (
    <aside
      aria-label={currentCue.title}
      data-atlas-day-cue-delivery="true"
      data-atlas-cue-preview={isOperatorPreview ? "owner" : "worker"}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 160,
        display: "grid",
        alignItems: "end",
        padding: "max(12px, env(safe-area-inset-top)) 12px max(78px, calc(env(safe-area-inset-bottom) + 64px))",
        pointerEvents: "none",
      }}
    >
      <section style={{
        position: "relative",
        width: "min(100%, 520px)",
        maxHeight: "min(62vh, 520px)",
        overflowY: "auto",
        overscrollBehavior: "contain",
        margin: "0 auto",
        borderRadius: 22,
        padding: "18px 18px 16px",
        background: "#f8f5e9",
        boxShadow: "0 18px 60px rgba(34,45,36,.24)",
        border: "1px solid rgba(50,72,56,.16)",
        pointerEvents: "auto",
      }}>
        <button
          type="button"
          aria-label="Close cue for now"
          disabled={saving}
          onClick={hideCueForSession}
          style={{ position: "absolute", top: 10, right: 10, width: 34, height: 34, border: 0, borderRadius: 17, background: "rgba(55,61,49,.07)", color: "#4c5148", font: "inherit", fontSize: 20, lineHeight: 1, cursor: "pointer" }}
        >
          ×
        </button>
        {isOperatorPreview ? (
          <small style={{ display: "block", margin: "0 38px 8px 0", paddingBottom: 8, borderBottom: "1px solid rgba(50,72,56,.12)", fontSize: 9.5, fontWeight: 950, letterSpacing: ".1em", textTransform: "uppercase", color: "#665d91" }}>
            Owner cue preview · testing will not clear this for the worker
          </small>
        ) : null}
        <small style={{ display: "block", paddingRight: 38, fontSize: 10, fontWeight: 900, letterSpacing: ".11em", textTransform: "uppercase", opacity: .5 }}>
          {currentCue.cueKind === "briefing" || currentCue.cueKind === "hard_stop_sowing" ? "Today at Elm" : currentCue.cueKind === "observation" ? "Quick check" : "Before we keep going"}
        </small>
        <strong style={{ display: "block", marginTop: 5, paddingRight: 30, fontSize: 19, lineHeight: 1.15 }}>{currentCue.title}</strong>
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
          <button type="button" disabled={saving} onClick={() => void (targetTaskId ? openCueTask() : resolveCue())} style={{ width: "100%", marginTop: 14, border: 0, borderRadius: 13, padding: "11px 12px", background: "#e8e43c", color: "#293126", font: "inherit", fontSize: 12.5, fontWeight: 900 }}>
            {saving ? "Saving…" : actionLabel(currentCue)}
          </button>
        )}
      </section>
    </aside>
  );
}
