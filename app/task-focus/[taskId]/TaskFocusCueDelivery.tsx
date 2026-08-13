"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type Choice = { value: string; label: string };
type Cue = {
  cueId: string;
  serviceDate: string;
  cueKind: string;
  anchorKind: "before_task" | "after_task";
  title: string;
  body: string | null;
  payload: Record<string, unknown>;
  status: string;
  recoveryPolicy: string;
  availableFrom: string | null;
  expiresAt: string | null;
};

type CueResponse = {
  ok?: boolean;
  targetSource?: "worker_self" | "owner_view" | "operator_lens";
  cues?: Cue[];
};

type CompletionDetail = {
  taskId: string;
  returnTo: string;
};

function centralDateIso() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function validDate(value: string | null) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function taskDay(searchParams: URLSearchParams) {
  const direct = searchParams.get("date");
  if (validDate(direct)) return direct as string;
  const returnTo = searchParams.get("returnTo");
  if (returnTo?.startsWith("/")) {
    try {
      const nested = new URL(returnTo, "https://atlas.local").searchParams.get("date");
      if (validDate(nested)) return nested as string;
    } catch {
      // Fall through to the farm's current date.
    }
  }
  return centralDateIso();
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

function items(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
}

function cueDue(cue: Cue) {
  const now = Date.now();
  if (!["available", "unseen", "stale"].includes(cue.status)) return false;
  if (cue.availableFrom && new Date(cue.availableFrom).getTime() > now) return false;
  if (cue.expiresAt && new Date(cue.expiresAt).getTime() < now && cue.recoveryPolicy === "expire") return false;
  return true;
}

function completionReturn(detail: CompletionDetail | null, fallback: string) {
  const value = detail?.returnTo;
  return value && value.startsWith("/") && !value.startsWith("//") ? value : fallback;
}

export default function TaskFocusCueDelivery({ taskId }: { taskId: string }) {
  const searchParams = useSearchParams();
  const dateIso = useMemo(() => taskDay(searchParams), [searchParams]);
  const [response, setResponse] = useState<CueResponse | null>(null);
  const [activeAfter, setActiveAfter] = useState<Cue | null>(null);
  const [completion, setCompletion] = useState<CompletionDetail | null>(null);
  const [saving, setSaving] = useState(false);
  const [dismissedForSession, setDismissedForSession] = useState<Set<string>>(new Set());

  async function load(signal?: AbortSignal) {
    try {
      const request = await fetch(`/api/atlas/task-day-cues?taskId=${encodeURIComponent(taskId)}&date=${encodeURIComponent(dateIso)}`, {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        signal,
      });
      const body = await request.json() as CueResponse;
      if (!signal?.aborted) setResponse(request.ok && body.ok ? body : null);
    } catch {
      if (!signal?.aborted) setResponse(null);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    setResponse(null);
    setActiveAfter(null);
    setCompletion(null);
    setDismissedForSession(new Set());
    void load(controller.signal);
    return () => controller.abort();
  }, [dateIso, taskId]);

  const isOperatorPreview = response?.targetSource === "operator_lens";
  const canSeeWorkerCues = response?.targetSource === "worker_self" || isOperatorPreview;
  const workerCues = canSeeWorkerCues
    ? (response?.cues ?? []).filter((cue) => !dismissedForSession.has(cue.cueId))
    : [];
  const beforeCue = workerCues.find((cue) => cue.anchorKind === "before_task" && cueDue(cue)) ?? null;
  const afterCue = workerCues.find((cue) => cue.anchorKind === "after_task" && cueDue(cue)) ?? null;

  useEffect(() => {
    function onTaskCompleted(event: Event) {
      const custom = event as CustomEvent<CompletionDetail>;
      if (!custom.detail || custom.detail.taskId !== taskId || !afterCue) return;
      custom.preventDefault();
      setCompletion(custom.detail);
      setActiveAfter(afterCue);
    }
    window.addEventListener("atlas:task-completed", onTaskCompleted);
    return () => window.removeEventListener("atlas:task-completed", onTaskCompleted);
  }, [afterCue, taskId]);

  const cue = activeAfter ?? beforeCue;
  if (!cue) return null;
  const activeCue: Cue = cue;

  const cueChoices = choices(activeCue.payload.choices);
  const cueItems = items(activeCue.payload.items);
  const actionLabel = typeof activeCue.payload.actionLabel === "string" && activeCue.payload.actionLabel.trim()
    ? activeCue.payload.actionLabel
    : activeCue.anchorKind === "before_task"
      ? "Everything is ready"
      : "Next";

  function closeCueForNow() {
    if (saving) return;
    setDismissedForSession((current) => new Set(current).add(activeCue.cueId));
    if (activeCue.anchorKind === "after_task") {
      setActiveAfter(null);
      if (completion) window.location.assign(completionReturn(completion, "/day"));
    }
  }

  async function resolve(responseData: Record<string, unknown> = {}) {
    if (saving) return;

    if (isOperatorPreview) {
      closeCueForNow();
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
        body: JSON.stringify({ cueId: activeCue.cueId, response: responseData }),
      });
      if (!request.ok) throw new Error("Cue response failed");
      if (activeCue.anchorKind === "after_task") {
        window.location.assign(completionReturn(completion, "/day"));
        return;
      }
      await load();
    } catch {
      // Keep the exact cue visible; Atlas should never pretend a requirement or
      // completion practice was acknowledged if its state write failed.
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={activeCue.title}
      data-atlas-task-cue={activeCue.anchorKind}
      data-atlas-cue-preview={isOperatorPreview ? "owner" : "worker"}
      style={{ position: "fixed", inset: 0, zIndex: 170, display: "grid", alignItems: "end", padding: "12px 12px max(14px, env(safe-area-inset-bottom))", background: "rgba(31,42,35,.18)" }}
    >
      <section style={{ width: "min(100%,520px)", margin: "0 auto", padding: "17px 18px 16px", borderRadius: 22, border: "1px solid rgba(50,72,56,.13)", background: "#f8f5e9", boxShadow: "0 18px 60px rgba(34,45,36,.22)" }}>
        {isOperatorPreview ? (
          <small style={{ display: "block", marginBottom: 8, paddingBottom: 8, borderBottom: "1px solid rgba(50,72,56,.12)", fontSize: 9.5, fontWeight: 950, letterSpacing: ".1em", textTransform: "uppercase", color: "#665d91" }}>
            Owner cue preview · testing will not clear this for the worker
          </small>
        ) : null}
        <small style={{ display: "block", fontSize: 10, fontWeight: 900, letterSpacing: ".11em", textTransform: "uppercase", opacity: .5 }}>
          {activeCue.anchorKind === "before_task" ? "Before you start" : activeCue.cueKind === "somatic" ? "Let this be finished" : "After this"}
        </small>
        <strong style={{ display: "block", marginTop: 5, fontSize: 18, lineHeight: 1.18 }}>{activeCue.title}</strong>
        {activeCue.body ? <p style={{ margin: "8px 0 0", fontSize: 13.5, lineHeight: 1.45, whiteSpace: "pre-line", opacity: .8 }}>{activeCue.body}</p> : null}
        {cueItems.length ? <ul style={{ display: "grid", gap: 5, margin: "11px 0 0", paddingLeft: 20, fontSize: 13, lineHeight: 1.38 }}>{cueItems.map((item) => <li key={item}>{item}</li>)}</ul> : null}
        {cueChoices.length ? (
          <div style={{ display: "grid", gap: 7, marginTop: 14 }}>
            {cueChoices.map((choice) => (
              <button key={choice.value} type="button" disabled={saving} onClick={() => void resolve({ choice: choice.value })} style={{ border: "1px solid rgba(50,72,56,.15)", borderRadius: 13, padding: "11px 12px", background: "rgba(255,255,255,.72)", font: "inherit", fontSize: 12.5, fontWeight: 800, textAlign: "left" }}>{choice.label}</button>
            ))}
          </div>
        ) : (
          <button type="button" disabled={saving} onClick={() => void resolve()} style={{ width: "100%", marginTop: 14, border: 0, borderRadius: 13, padding: "11px 12px", background: "#e8e43c", color: "#293126", font: "inherit", fontSize: 12.5, fontWeight: 900 }}>
            {saving ? "Saving…" : actionLabel}
          </button>
        )}
        <button type="button" disabled={saving} onClick={closeCueForNow} style={{ width: "100%", marginTop: 8, border: 0, padding: "8px 10px", background: "transparent", color: "#445147", font: "inherit", fontSize: 12, fontWeight: 800, textDecoration: "underline", textUnderlineOffset: 3 }}>
          {isOperatorPreview ? "Close preview" : "Close for now"}
        </button>
      </section>
    </div>
  );
}
