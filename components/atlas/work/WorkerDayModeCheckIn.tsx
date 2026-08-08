"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { WorkerDayRoutingState, WorkerRoutingMode } from "@/lib/atlas-data/worker-day-routing";

const OPTIONS: Array<{ mode: WorkerRoutingMode; title: string; detail: string }> = [
  { mode: "ready", title: "I'm ready", detail: "Bigger or more demanding work is okay." },
  { mode: "keep_moving", title: "Keep me moving", detail: "My brain is busy. Give me active, straightforward work." },
  { mode: "make_simple", title: "Make it simple", detail: "Give me clear wins and build me into the day." },
  { mode: "light_physical", title: "Keep it light physically", detail: "Keep the physical load lower today." },
];

function labelFor(mode: WorkerRoutingMode) {
  return OPTIONS.find((option) => option.mode === mode)?.title ?? "I'm ready";
}

export default function WorkerDayModeCheckIn({ state, canAct }: { state: WorkerDayRoutingState | null; canAct: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(Boolean(canAct && state?.needsCheckIn));
  const [saving, setSaving] = useState<WorkerRoutingMode | null>(null);
  const [current, setCurrent] = useState<WorkerRoutingMode>(state?.routingMode ?? "ready");
  const [error, setError] = useState<string | null>(null);

  if (!canAct || !state) return null;

  async function choose(mode: WorkerRoutingMode) {
    if (saving) return;
    setSaving(mode);
    setError(null);
    try {
      const response = await fetch("/api/atlas/worker-day-routing", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-atlas-intent": "worker-day-routing-v1" },
        body: JSON.stringify({ routingMode: mode }),
      });
      if (!response.ok) throw new Error("Atlas couldn't adjust the day.");
      setCurrent(mode);
      setOpen(false);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Atlas couldn't adjust the day.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{ border: "1px solid rgba(38,31,27,.14)", background: "#fff", borderRadius: 999, padding: "8px 12px", fontWeight: 700, cursor: "pointer" }}
      >
        Today: {labelFor(current)} · Change
      </button>
      {open ? (
        <div role="dialog" aria-modal="true" aria-labelledby="worker-day-mode-title" style={{ position: "fixed", inset: 0, zIndex: 90, display: "grid", placeItems: "center", padding: 20, background: "rgba(28,25,21,.38)", backdropFilter: "blur(3px)" }}>
          <section style={{ width: "min(430px,100%)", borderRadius: 22, background: "#f8f4e9", padding: 24, boxShadow: "0 24px 70px rgba(24,20,17,.28)" }}>
            {!state.needsCheckIn ? <button type="button" onClick={() => setOpen(false)} aria-label="Close" style={{ float: "right", border: 0, background: "transparent", fontSize: 24, cursor: "pointer" }}>×</button> : null}
            <small style={{ fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", opacity: .58 }}>Start the day</small>
            <h2 id="worker-day-mode-title" style={{ margin: "7px 0 5px", fontSize: 27 }}>How should Atlas help you start today?</h2>
            <p style={{ margin: "0 0 18px", opacity: .72, lineHeight: 1.4 }}>This changes the order of the work, not what matters.</p>
            <div style={{ display: "grid", gap: 10 }}>
              {OPTIONS.map((option) => (
                <button key={option.mode} type="button" disabled={Boolean(saving)} onClick={() => choose(option.mode)} style={{ textAlign: "left", border: current === option.mode ? "2px solid #4d3475" : "1px solid rgba(38,31,27,.14)", borderRadius: 14, padding: "14px 15px", background: "#fff", cursor: "pointer" }}>
                  <strong style={{ display: "block", fontSize: 17 }}>{option.title}</strong>
                  <span style={{ display: "block", marginTop: 3, opacity: .7, lineHeight: 1.35 }}>{option.detail}</span>
                </button>
              ))}
            </div>
            {error ? <p style={{ color: "#8a3328", marginBottom: 0 }}>{error}</p> : null}
          </section>
        </div>
      ) : null}
    </>
  );
}
