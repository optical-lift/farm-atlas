"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

type TaskRow = { taskId?: string | null; title: string };
type CueKind = "briefing" | "requirement" | "observation" | "somatic" | "result";
type AnchorKind = "first_open" | "before_task" | "after_task" | "at_time";
type Cue = {
  cueId: string;
  cueKind: CueKind;
  anchorKind: AnchorKind;
  anchorTaskId: string | null;
  title: string;
  body: string | null;
  payload: Record<string, unknown>;
  status: string;
  recoveryPolicy: "refresh" | "expire" | "persist" | "block";
  scheduledAt: string | null;
  availableFrom: string | null;
  expiresAt: string | null;
};

type DraftCue = {
  cueId?: string;
  cueKind: CueKind;
  anchorKind: AnchorKind;
  anchorTaskId: string;
  title: string;
  body: string;
  items: string;
  actionLabel: string;
  recoveryPolicy: "refresh" | "expire" | "persist" | "block";
  payload: Record<string, unknown>;
};

const emptyDraft: DraftCue = {
  cueKind: "briefing",
  anchorKind: "first_open",
  anchorTaskId: "",
  title: "",
  body: "",
  items: "",
  actionLabel: "Start today",
  recoveryPolicy: "expire",
  payload: {},
};

function validDate(value: string | null) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function payloadItems(payload: Record<string, unknown>) {
  return Array.isArray(payload.items) ? payload.items.filter((item): item is string => typeof item === "string").join("\n") : "";
}

function payloadAction(payload: Record<string, unknown>) {
  return typeof payload.actionLabel === "string" ? payload.actionLabel : "";
}

function draftFromCue(cue: Cue): DraftCue {
  return {
    cueId: cue.cueId,
    cueKind: cue.cueKind,
    anchorKind: cue.anchorKind,
    anchorTaskId: cue.anchorTaskId ?? "",
    title: cue.title,
    body: cue.body ?? "",
    items: payloadItems(cue.payload),
    actionLabel: payloadAction(cue.payload),
    recoveryPolicy: cue.recoveryPolicy,
    payload: { ...cue.payload },
  };
}

function preset(kind: "morning" | "before" | "somatic" | "result"): DraftCue {
  if (kind === "before") return { ...emptyDraft, cueKind: "requirement", anchorKind: "before_task", actionLabel: "Everything is ready", recoveryPolicy: "block" };
  if (kind === "somatic") return { ...emptyDraft, cueKind: "somatic", anchorKind: "after_task", actionLabel: "Next", recoveryPolicy: "persist" };
  if (kind === "result") return { ...emptyDraft, cueKind: "result", anchorKind: "after_task", actionLabel: "Continue", recoveryPolicy: "persist" };
  return { ...emptyDraft };
}

function cueLabel(cue: Cue) {
  if (cue.anchorKind === "first_open") return "Morning login";
  if (cue.anchorKind === "before_task") return "Before task";
  if (cue.anchorKind === "after_task" && cue.cueKind === "somatic") return "After task · somatic";
  if (cue.anchorKind === "after_task") return "After task";
  return "Timed cue";
}

function taskAnchored(anchorKind: AnchorKind) {
  return anchorKind === "before_task" || anchorKind === "after_task";
}

export default function OwnerDayCueEditor() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedDate = searchParams.get("date");
  const dateIso = pathname === "/day" && validDate(requestedDate) ? requestedDate as string : null;
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [cues, setCues] = useState<Cue[]>([]);
  const [draft, setDraft] = useState<DraftCue | null>(null);
  const [draggingCueId, setDraggingCueId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function load(signal?: AbortSignal) {
    if (!dateIso) return;
    const [planRequest, cueRequest] = await Promise.all([
      fetch(`/api/atlas/worker-day-plan?date=${encodeURIComponent(dateIso)}`, { cache: "no-store", credentials: "same-origin", headers: { Accept: "application/json" }, signal }),
      fetch(`/api/atlas/day-choreography?date=${encodeURIComponent(dateIso)}`, { cache: "no-store", credentials: "same-origin", headers: { Accept: "application/json" }, signal }),
    ]);
    const [planBody, cueBody] = await Promise.all([planRequest.json(), cueRequest.json()]) as [
      { ok?: boolean; plan?: { realWork?: TaskRow[] } | null },
      { ok?: boolean; choreography?: { cues?: Cue[] } | null },
    ];
    if (!signal?.aborted) {
      setTasks(planRequest.ok && planBody.ok ? (planBody.plan?.realWork ?? []).filter((task) => Boolean(task.taskId)) : []);
      setCues(cueRequest.ok && cueBody.ok ? cueBody.choreography?.cues ?? [] : []);
    }
  }

  useEffect(() => {
    setDraft(null);
    setDraggingCueId(null);
    setMessage(null);
    if (!dateIso) return;
    const controller = new AbortController();
    void load(controller.signal).catch(() => {
      if (!controller.signal.aborted) setMessage("Day cues could not be loaded.");
    });
    return () => controller.abort();
  }, [dateIso]);

  const taskById = useMemo(() => new Map(tasks.map((task) => [task.taskId as string, task.title])), [tasks]);
  const draggingCue = useMemo(() => cues.find((cue) => cue.cueId === draggingCueId) ?? null, [cues, draggingCueId]);

  function setPreset(kind: "morning" | "before" | "somatic" | "result") {
    setDraft(preset(kind));
    setMessage(null);
  }

  async function upsertCue(cue: Record<string, unknown>) {
    const request = await fetch("/api/atlas/owner-day-cue", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json", "Content-Type": "application/json", "x-atlas-intent": "owner-day-cue-v1" },
      body: JSON.stringify({ cue }),
    });
    const body = await request.json() as { ok?: boolean; error?: string; message?: string };
    if (!request.ok || !body.ok) throw new Error(body.message || body.error || "Atlas could not save this cue.");
  }

  async function saveCue() {
    if (!dateIso || !draft || saving || !draft.title.trim()) return;
    if (taskAnchored(draft.anchorKind) && !draft.anchorTaskId) {
      setMessage("Choose the task this cue belongs to.");
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const cuePayload: Record<string, unknown> = { ...draft.payload };
      const itemList = draft.items.split("\n").map((item) => item.trim()).filter(Boolean);
      if (itemList.length) cuePayload.items = itemList; else delete cuePayload.items;
      if (draft.actionLabel.trim()) cuePayload.actionLabel = draft.actionLabel.trim(); else delete cuePayload.actionLabel;

      await upsertCue({
        ...(draft.cueId ? { cueId: draft.cueId } : {}),
        serviceDate: dateIso,
        cueKind: draft.cueKind,
        anchorKind: draft.anchorKind,
        anchorTaskId: draft.anchorTaskId || null,
        title: draft.title.trim(),
        body: draft.body.trim() || null,
        payload: cuePayload,
        recoveryPolicy: draft.recoveryPolicy,
      });
      setDraft(null);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Atlas could not save this cue.");
    } finally {
      setSaving(false);
    }
  }

  async function reanchorCue(cue: Cue, anchorTaskId: string) {
    if (!dateIso || saving || !taskAnchored(cue.anchorKind)) return;
    setSaving(true);
    setMessage(null);
    try {
      await upsertCue({
        cueId: cue.cueId,
        serviceDate: dateIso,
        cueKind: cue.cueKind,
        anchorKind: cue.anchorKind,
        anchorTaskId,
        title: cue.title,
        body: cue.body,
        payload: cue.payload,
        recoveryPolicy: cue.recoveryPolicy,
        scheduledAt: cue.scheduledAt,
        availableFrom: cue.availableFrom,
        expiresAt: cue.expiresAt,
      });
      setDraggingCueId(null);
      if (draft?.cueId === cue.cueId) setDraft(null);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Atlas could not re-anchor this cue.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteCue(cueId: string) {
    if (saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const request = await fetch(`/api/atlas/owner-day-cue?cueId=${encodeURIComponent(cueId)}`, {
        method: "DELETE",
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json", "x-atlas-intent": "owner-day-cue-delete-v1" },
      });
      if (!request.ok) throw new Error("Atlas could not remove this cue.");
      if (draft?.cueId === cueId) setDraft(null);
      setDraggingCueId(null);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Atlas could not remove this cue.");
    } finally {
      setSaving(false);
    }
  }

  if (!dateIso) return null;

  return (
    <section data-owner-day-cue-editor="true" style={{ margin: "10px 0 18px", padding: 12, border: "1px solid rgba(112,111,177,.24)", borderRadius: 16, background: "rgba(247,245,252,.82)", display: "grid", gap: 10 }}>
      <div>
        <strong style={{ display: "block", fontSize: 12.5 }}>Day cues</strong>
        <span style={{ display: "block", marginTop: 2, fontSize: 10.5, opacity: .64 }}>These shape the Day around the work. They are not tasks.</span>
      </div>

      {cues.length ? <div style={{ display: "grid", gap: 6 }}>
        {cues.map((cue) => {
          const canDrag = taskAnchored(cue.anchorKind) && cue.status !== "resolved";
          return (
            <div
              key={cue.cueId}
              draggable={canDrag}
              onDragStart={() => canDrag && setDraggingCueId(cue.cueId)}
              onDragEnd={() => setDraggingCueId(null)}
              style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 8, padding: "8px 9px", borderRadius: 11, background: "rgba(255,255,255,.58)", cursor: canDrag ? "grab" : "default" }}
            >
              <button type="button" onClick={() => setDraft(draftFromCue(cue))} style={{ border: 0, background: "transparent", padding: 0, textAlign: "left", font: "inherit", color: "inherit" }}>
                <small style={{ display: "block", color: "#777bb0", fontSize: 9, fontWeight: 900, textTransform: "uppercase", letterSpacing: ".07em" }}>{cueLabel(cue)}</small>
                <strong style={{ display: "block", marginTop: 2, fontSize: 11.5 }}>{cue.title}</strong>
                {cue.anchorTaskId ? <span style={{ display: "block", marginTop: 2, fontSize: 9.5, opacity: .62 }}>{taskById.get(cue.anchorTaskId) || "Task anchor"}</span> : null}
              </button>
              <button type="button" disabled={saving} onClick={() => void deleteCue(cue.cueId)} style={{ alignSelf: "center", border: 0, background: "transparent", font: "inherit", fontSize: 9.5, fontWeight: 850, color: "#77758e" }}>Remove</button>
            </div>
          );
        })}
      </div> : <span style={{ fontSize: 10.5, opacity: .58 }}>No cues attached yet.</span>}

      {draggingCue ? (
        <section data-cue-reanchor-targets="true" style={{ display: "grid", gap: 5, padding: 9, borderRadius: 11, border: "1px dashed rgba(112,111,177,.35)" }}>
          <strong style={{ fontSize: 10 }}>Drop “{draggingCue.title}” onto its new task</strong>
          {tasks.map((task) => (
            <div
              key={task.taskId}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (task.taskId) void reanchorCue(draggingCue, task.taskId);
              }}
              style={{ padding: "7px 8px", borderRadius: 9, background: "rgba(255,255,255,.62)", fontSize: 10.5 }}
            >
              {task.title}
            </div>
          ))}
        </section>
      ) : null}

      {!draft ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 6 }}>
          <button type="button" onClick={() => setPreset("morning")} style={{ border: "1px solid rgba(112,111,177,.22)", borderRadius: 10, padding: "7px 8px", background: "rgba(255,255,255,.55)", font: "inherit", fontSize: 10, fontWeight: 850 }}>+ Morning briefing</button>
          <button type="button" onClick={() => setPreset("before")} style={{ border: "1px solid rgba(112,111,177,.22)", borderRadius: 10, padding: "7px 8px", background: "rgba(255,255,255,.55)", font: "inherit", fontSize: 10, fontWeight: 850 }}>+ Before task</button>
          <button type="button" onClick={() => setPreset("somatic")} style={{ border: "1px solid rgba(112,111,177,.22)", borderRadius: 10, padding: "7px 8px", background: "rgba(255,255,255,.55)", font: "inherit", fontSize: 10, fontWeight: 850 }}>+ Somatic after</button>
          <button type="button" onClick={() => setPreset("result")} style={{ border: "1px solid rgba(112,111,177,.22)", borderRadius: 10, padding: "7px 8px", background: "rgba(255,255,255,.55)", font: "inherit", fontSize: 10, fontWeight: 850 }}>+ Result after</button>
        </div>
      ) : (
        <section style={{ display: "grid", gap: 7, padding: 10, borderRadius: 12, background: "rgba(236,233,248,.76)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <strong style={{ fontSize: 11.5 }}>{draft.cueId ? "Edit cue" : "Add cue"}</strong>
            <button type="button" onClick={() => setDraft(null)} style={{ border: 0, background: "transparent", font: "inherit", fontSize: 9.5, fontWeight: 850 }}>Cancel</button>
          </div>
          <label style={{ display: "grid", gap: 3, fontSize: 9.5, fontWeight: 850 }}>Show this cue
            <select
              value={draft.anchorKind}
              onChange={(event) => {
                const anchorKind = event.target.value as AnchorKind;
                setDraft((current) => current ? { ...current, anchorKind, anchorTaskId: taskAnchored(anchorKind) ? current.anchorTaskId : "" } : current);
              }}
              style={{ border: "1px solid rgba(112,111,177,.2)", borderRadius: 9, padding: 8, background: "#fff", font: "inherit", fontSize: 10.5 }}
            >
              <option value="first_open">Morning login</option>
              <option value="before_task">Before a task</option>
              <option value="after_task">After a task</option>
              <option value="at_time">At a time</option>
            </select>
          </label>
          {taskAnchored(draft.anchorKind) ? (
            <label style={{ display: "grid", gap: 3, fontSize: 9.5, fontWeight: 850 }}>Attach to task
              <select value={draft.anchorTaskId} onChange={(event) => setDraft((current) => current ? { ...current, anchorTaskId: event.target.value } : current)} style={{ border: "1px solid rgba(112,111,177,.2)", borderRadius: 9, padding: 8, background: "#fff", font: "inherit", fontSize: 10.5 }}>
                <option value="">Choose task…</option>
                {tasks.map((task) => <option key={task.taskId} value={task.taskId ?? ""}>{task.title}</option>)}
              </select>
            </label>
          ) : null}
          <input value={draft.title} onChange={(event) => setDraft((current) => current ? { ...current, title: event.target.value } : current)} placeholder="Short cue title" style={{ border: "1px solid rgba(112,111,177,.2)", borderRadius: 9, padding: 8, background: "#fff", font: "inherit", fontSize: 11 }} />
          <textarea value={draft.body} onChange={(event) => setDraft((current) => current ? { ...current, body: event.target.value } : current)} placeholder={draft.cueKind === "somatic" ? "The sentence or somatic practice you selected" : "What Anna should see"} rows={3} style={{ resize: "vertical", border: "1px solid rgba(112,111,177,.2)", borderRadius: 9, padding: 8, background: "#fff", font: "inherit", fontSize: 11, lineHeight: 1.4 }} />
          {draft.cueKind === "requirement" ? <textarea value={draft.items} onChange={(event) => setDraft((current) => current ? { ...current, items: event.target.value } : current)} placeholder="One required item per line" rows={3} style={{ resize: "vertical", border: "1px solid rgba(112,111,177,.2)", borderRadius: 9, padding: 8, background: "#fff", font: "inherit", fontSize: 11 }} /> : null}
          <input value={draft.actionLabel} onChange={(event) => setDraft((current) => current ? { ...current, actionLabel: event.target.value } : current)} placeholder="Button words" style={{ border: "1px solid rgba(112,111,177,.2)", borderRadius: 9, padding: 8, background: "#fff", font: "inherit", fontSize: 11 }} />
          <button type="button" disabled={saving || !draft.title.trim()} onClick={() => void saveCue()} style={{ border: 0, borderRadius: 10, padding: "9px 10px", background: "#e9e73b", color: "#303242", font: "inherit", fontSize: 11, fontWeight: 900 }}>{saving ? "Saving…" : "Save cue"}</button>
        </section>
      )}

      {message ? <p style={{ margin: 0, fontSize: 10.5 }}>{message}</p> : null}
    </section>
  );
}
