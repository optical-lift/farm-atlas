"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

type CandidateKind = "project_pull" | "floating_task" | "queue" | "rhythm";

type ScheduleCandidate = {
  id: string;
  sourceKind: CandidateKind;
  sourceId: string;
  title: string;
  note: string | null;
  environment: string | null;
  expectedActiveMinutes: number;
  approved: boolean;
  conditional: boolean;
  fitsWithinCurrentRemaining: boolean;
  recommended: boolean;
  reason: string | null;
};

type ScheduleBuilderResponse = {
  ok?: boolean;
  active?: boolean;
  operatorLabel?: string;
  paidTargetMinutes?: number;
  scheduledPaidMinutes?: number;
  approvedConditionalMinutes?: number;
  remainingPaidMinutes?: number;
  candidates?: ScheduleCandidate[];
  error?: string;
};

function minutesLabel(value: number) {
  const minutes = Math.max(0, Math.round(value));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) return `${remainder}m`;
  if (!remainder) return `${hours}h`;
  return `${hours}h ${remainder}m`;
}

function sourceLabel(kind: CandidateKind) {
  if (kind === "project_pull") return "Finish Elm";
  if (kind === "queue") return "Weed Card";
  if (kind === "floating_task") return "Atlas paid work";
  return "Farm rhythm";
}

function environmentLabel(value: string | null) {
  if (!value || value === "either") return null;
  return value === "outdoor" ? "outside" : value;
}

export default function OwnerDayScheduleBuilder() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedDate = searchParams.get("date");
  const dateIso = pathname === "/day" && requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)
    ? requestedDate
    : null;

  const [response, setResponse] = useState<ScheduleBuilderResponse | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setResponse(null);
    setSelected(new Set());
    setError(null);
    if (!dateIso) return;

    const controller = new AbortController();
    void fetch(`/api/atlas/owner-day-projection?date=${encodeURIComponent(dateIso)}`, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (request) => {
        const body = await request.json() as ScheduleBuilderResponse;
        if (!request.ok || !body.ok) throw new Error(body.error || "Schedule ideas could not be loaded.");
        return body;
      })
      .then((body) => {
        if (!controller.signal.aborted) setResponse(body);
      })
      .catch((loadError) => {
        if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : "Schedule ideas could not be loaded.");
      });

    return () => controller.abort();
  }, [dateIso]);

  const candidates = response?.candidates ?? [];
  const selectedCandidates = useMemo(
    () => candidates.filter((candidate) => selected.has(candidate.id) && !candidate.approved),
    [candidates, selected],
  );
  const selectedMinutes = selectedCandidates.reduce((total, candidate) => total + candidate.expectedActiveMinutes, 0);
  const targetMinutes = Math.max(0, Number(response?.paidTargetMinutes) || 0);
  const scheduledMinutes = Math.max(0, Number(response?.scheduledPaidMinutes) || 0);
  const conditionalMinutes = Math.max(0, Number(response?.approvedConditionalMinutes) || 0);
  const committedMinutes = scheduledMinutes + conditionalMinutes;
  const proposedMinutes = committedMinutes + selectedMinutes;
  const overBy = Math.max(0, proposedMinutes - targetMinutes);
  const operatorLabel = response?.operatorLabel || "Anna";
  const canBuild = Boolean(dateIso && selectedCandidates.length && !saving && overBy === 0);

  function toggle(candidate: ScheduleCandidate) {
    if (candidate.approved) return;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(candidate.id)) next.delete(candidate.id);
      else next.add(candidate.id);
      return next;
    });
    setError(null);
  }

  async function buildSchedule() {
    if (!canBuild || !dateIso) return;
    setSaving(true);
    setError(null);
    try {
      const request = await fetch("/api/atlas/owner-day-schedule", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "x-atlas-intent": "owner-day-schedule-v1",
        },
        body: JSON.stringify({
          date: dateIso,
          selections: selectedCandidates.map((candidate) => ({
            sourceKind: candidate.sourceKind,
            sourceId: candidate.sourceId,
          })),
        }),
      });
      const body = await request.json() as { ok?: boolean; error?: string; message?: string };
      if (!request.ok || !body.ok) throw new Error(body.message || body.error || "Atlas could not build the schedule.");
      window.location.reload();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Atlas could not build the schedule.");
      setSaving(false);
    }
  }

  if (!response?.active && !error) return null;

  return (
    <section
      data-owner-day-schedule-builder="true"
      aria-label={`Build ${operatorLabel}'s schedule`}
      style={{
        marginTop: 10,
        padding: "13px 14px",
        border: "1px dashed rgba(125, 128, 172, .42)",
        borderRadius: 16,
        background: "rgba(244, 241, 250, .76)",
      }}
    >
      <header style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
        <div>
          <span style={{ display: "block", color: "#858bb8", fontSize: 10, fontWeight: 950, letterSpacing: ".13em", textTransform: "uppercase" }}>Owner schedule builder</span>
          <strong style={{ display: "block", marginTop: 3, fontSize: 16 }}>Build {operatorLabel}&apos;s day</strong>
        </div>
        {targetMinutes > 0 ? (
          <span style={{ flex: "0 0 auto", fontSize: 10, fontWeight: 900, textTransform: "uppercase", letterSpacing: ".04em", opacity: .62 }}>
            {minutesLabel(committedMinutes)} / {minutesLabel(targetMinutes)} committed
          </span>
        ) : null}
      </header>

      {error ? (
        <p style={{ margin: "8px 0 0", padding: "8px 9px", borderRadius: 10, background: "rgba(255,255,255,.72)", fontSize: 12, lineHeight: 1.4 }}>
          {error}
        </p>
      ) : null}

      {response?.active ? (
        <>
          <p style={{ margin: "7px 0 10px", fontSize: 12, lineHeight: 1.42, opacity: .72 }}>
            Atlas is showing every eligible idea it can currently defend for this date. Tap the work you want to make real. Nothing below becomes {operatorLabel}&apos;s task until you build the schedule. A Weed Card stays behind the card ahead of it even after you approve it.
          </p>

          {conditionalMinutes > 0 ? (
            <p style={{ margin: "0 0 10px", padding: "7px 9px", borderRadius: 10, background: "rgba(255,255,255,.58)", fontSize: 11, lineHeight: 1.35, opacity: .7 }}>
              {minutesLabel(conditionalMinutes)} is already approved conditionally and is included in the committed total.
            </p>
          ) : null}

          {candidates.length ? (
            <div style={{ display: "grid", gap: 8 }}>
              {candidates.map((candidate) => {
                const isSelected = selected.has(candidate.id);
                const env = environmentLabel(candidate.environment);
                return (
                  <button
                    type="button"
                    key={candidate.id}
                    aria-pressed={candidate.approved || isSelected}
                    disabled={candidate.approved}
                    onClick={() => toggle(candidate)}
                    style={{
                      width: "100%",
                      display: "grid",
                      gridTemplateColumns: "24px 1fr auto",
                      gap: 9,
                      alignItems: "start",
                      textAlign: "left",
                      border: candidate.approved || isSelected ? "1px solid rgba(105, 108, 160, .5)" : "1px solid rgba(125, 128, 172, .17)",
                      borderRadius: 12,
                      padding: "10px 11px",
                      background: candidate.approved || isSelected ? "rgba(255,255,255,.92)" : "rgba(255,255,255,.7)",
                      color: "inherit",
                      opacity: candidate.approved ? .78 : 1,
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        width: 20,
                        height: 20,
                        marginTop: 1,
                        borderRadius: 999,
                        border: "1.5px solid rgba(105,108,160,.52)",
                        display: "grid",
                        placeItems: "center",
                        fontSize: 12,
                        fontWeight: 900,
                      }}
                    >
                      {candidate.approved || isSelected ? "✓" : ""}
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <strong style={{ display: "block", fontSize: 14, lineHeight: 1.24 }}>{candidate.title}</strong>
                      <span style={{ display: "block", marginTop: 3, fontSize: 11, lineHeight: 1.32, opacity: .64 }}>
                        {sourceLabel(candidate.sourceKind)} · {minutesLabel(candidate.expectedActiveMinutes)}{env ? ` · ${env}` : ""}
                      </span>
                      {candidate.note ? (
                        <span style={{ display: "block", marginTop: 4, fontSize: 10.5, lineHeight: 1.35, opacity: .58 }}>{candidate.note}</span>
                      ) : candidate.reason ? (
                        <span style={{ display: "block", marginTop: 4, fontSize: 10.5, lineHeight: 1.35, opacity: .58 }}>{candidate.reason}</span>
                      ) : null}
                    </span>
                    <span style={{ flex: "0 0 auto", paddingTop: 1, fontSize: 9.5, fontWeight: 900, textTransform: "uppercase", letterSpacing: ".04em", opacity: .58 }}>
                      {candidate.approved ? "Approved" : isSelected ? "Selected" : candidate.fitsWithinCurrentRemaining ? "Tap to add" : "Beyond opening"}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p style={{ margin: 0, padding: "9px 10px", borderRadius: 12, background: "rgba(255,255,255,.58)", fontSize: 12, lineHeight: 1.4, opacity: .66 }}>
              Atlas has no additional eligible work ideas for this date right now.
            </p>
          )}

          <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid rgba(125,128,172,.2)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 11, lineHeight: 1.35, marginBottom: 8 }}>
              <span>{selectedCandidates.length ? `${selectedCandidates.length} selected · ${minutesLabel(selectedMinutes)}` : "Tap work to add it"}</span>
              {targetMinutes > 0 ? <strong>{minutesLabel(proposedMinutes)} / {minutesLabel(targetMinutes)}</strong> : null}
            </div>
            {overBy > 0 ? (
              <p style={{ margin: "0 0 8px", fontSize: 11, lineHeight: 1.35 }}>
                This would put the paid day {minutesLabel(overBy)} over target. Remove a selection before building it.
              </p>
            ) : null}
            <button
              type="button"
              disabled={!canBuild}
              onClick={() => void buildSchedule()}
              style={{
                width: "100%",
                border: 0,
                borderRadius: 12,
                padding: "10px 12px",
                fontSize: 13,
                fontWeight: 900,
                background: canBuild ? "#e9e73b" : "rgba(125,128,172,.13)",
                color: "#303242",
              }}
            >
              {saving ? "Building schedule…" : selectedCandidates.length ? `Build ${operatorLabel}'s schedule` : "Choose work to build the schedule"}
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
