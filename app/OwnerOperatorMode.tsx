"use client";

import { useState } from "react";

import type { AtlasOwnerOperatorContext } from "@/lib/atlas/operator-context";

type OwnerOperatorModeProps = {
  context: AtlasOwnerOperatorContext | null;
};

export default function OwnerOperatorMode({ context }: OwnerOperatorModeProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!context) return null;

  async function selectMembership(membershipId: string) {
    if (saving || membershipId === context.effective.membershipId) return;
    setSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/atlas/operator-context", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        cache: "no-store",
        body: JSON.stringify({ membershipId }),
      });
      const data = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error || "Atlas could not switch worker context.");
      window.location.reload();
    } catch (selectionError) {
      setError(selectionError instanceof Error ? selectionError.message : "Atlas could not switch worker context.");
      setSaving(false);
    }
  }

  return (
    <aside
      className={`atlas-owner-operator${context.isOperating ? " is-operating" : ""}`}
      aria-label="Owner operator mode"
      data-effective-membership-id={context.effective.membershipId}
    >
      <div className="atlas-owner-operator__control">
        <label htmlFor="atlas-owner-operator-select">Operating as</label>
        <select
          id="atlas-owner-operator-select"
          value={context.effective.membershipId}
          disabled={saving}
          onChange={(event) => void selectMembership(event.target.value)}
        >
          {context.options.map((option) => (
            <option key={option.membershipId} value={option.membershipId}>
              {option.displayName}
            </option>
          ))}
        </select>
        {saving ? <span>Switching…</span> : null}
      </div>

      {context.isOperating ? (
        <div className="atlas-owner-operator__notice">
          <strong>Operating {context.effective.displayName}&apos;s Atlas</strong>
          <span>Actions change live farm data and are recorded as {context.actor.displayName} operating for {context.effective.displayName}.</span>
        </div>
      ) : null}

      {error ? <p role="alert">{error}</p> : null}
    </aside>
  );
}
