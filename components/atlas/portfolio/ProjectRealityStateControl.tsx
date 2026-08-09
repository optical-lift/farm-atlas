"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { AtlasRealityState } from "@/lib/atlas/portfolio";

const STATES: Array<{ key: AtlasRealityState; label: string; help: string }> = [
  { key: "finding_shape", label: "Finding the shape", help: "Important questions or the finish line are still being clarified." },
  { key: "making_real", label: "Making it real", help: "The outcome is understood and reality needs to catch up." },
  { key: "closing_loop", label: "Closing the loop", help: "Verify, polish, document, hand off, or prove the outcome exists." },
];

type Props = {
  projectId: string;
  currentState: AtlasRealityState;
  currentReason: string | null;
};

export default function ProjectRealityStateControl({ projectId, currentState, currentReason }: Props) {
  const router = useRouter();
  const [reason, setReason] = useState(currentReason ?? "");
  const [saving, setSaving] = useState<AtlasRealityState | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function save(nextState: AtlasRealityState) {
    try {
      setSaving(nextState);
      setMessage(null);
      const response = await fetch("/api/atlas/project-reality-state", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ projectId, realityState: nextState, reason: reason.trim() || null }),
      });
      const data = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error || "Could not update reality state.");
      setMessage("Reality state updated.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update reality state.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <details className="atlas-reality-control">
      <summary>Owner certainty control</summary>
      <div className="atlas-reality-control-body">
        <div className="atlas-reality-control-options">
          {STATES.map((state) => (
            <button
              key={state.key}
              type="button"
              data-active={currentState === state.key}
              disabled={Boolean(saving)}
              onClick={() => void save(state.key)}
            >
              <strong>{saving === state.key ? "Saving…" : state.label}</strong>
              <span>{state.help}</span>
            </button>
          ))}
        </div>
        <label>
          <span>Why is the project here?</span>
          <textarea rows={3} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Optional Owner reason." />
        </label>
        {message ? <p>{message}</p> : null}
      </div>
      <style jsx>{`
        .atlas-reality-control { border-top: 1px solid rgba(88,87,111,.09); padding-top: 10px; }
        .atlas-reality-control > summary { cursor: pointer; color: #645f87; font-size: 10px; font-weight: 900; }
        .atlas-reality-control-body { display: grid; gap: 11px; margin-top: 10px; }
        .atlas-reality-control-options { display: grid; gap: 7px; }
        .atlas-reality-control-options button { text-align: left; border: 1px solid rgba(88,87,111,.12); border-radius: 12px; background: #fffdf7; color: #3c3d4f; padding: 10px; }
        .atlas-reality-control-options button[data-active="true"] { border-color: #76709f; box-shadow: inset 0 0 0 1px #76709f; }
        .atlas-reality-control-options strong { display: block; font-size: 11px; }
        .atlas-reality-control-options span { display: block; margin-top: 3px; color: #797a73; font-size: 9px; line-height: 1.35; }
        .atlas-reality-control label > span { display: block; margin-bottom: 5px; color: #77728f; font-size: 9px; font-weight: 900; }
        .atlas-reality-control textarea { width: 100%; box-sizing: border-box; resize: vertical; border: 1px solid rgba(88,87,111,.15); border-radius: 10px; background: #fffdf8; padding: 9px; color: #343648; font: inherit; font-size: 11px; }
        .atlas-reality-control p { margin: 0; color: #756f8f; font-size: 9px; font-weight: 800; }
      `}</style>
    </details>
  );
}
