"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";

import type { AtlasOwnerOperatorContext } from "@/lib/atlas/operator-context";

type OwnerOperatorModeProps = {
  context: AtlasOwnerOperatorContext | null;
};

export default function OwnerOperatorMode({ context }: OwnerOperatorModeProps) {
  const pathname = usePathname();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!context || pathname === "/login" || pathname.startsWith("/auth/")) return null;
  const activeContext = context;

  async function selectAccount(accountId: string) {
    if (saving || accountId === activeContext.effective.accountId) return;
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
        body: JSON.stringify({ accountId }),
      });
      const data = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error || "Atlas could not switch account context.");
      window.location.reload();
    } catch (selectionError) {
      setError(selectionError instanceof Error ? selectionError.message : "Atlas could not switch account context.");
      setSaving(false);
    }
  }

  return (
    <aside
      className={`atlas-owner-operator${activeContext.isOperating ? " is-operating" : ""}`}
      aria-label="Owner operator mode"
      data-effective-account-id={activeContext.effective.accountId}
    >
      <div className="atlas-owner-operator__control">
        <label htmlFor="atlas-owner-operator-select">Operating as</label>
        <select
          id="atlas-owner-operator-select"
          value={activeContext.effective.accountId}
          disabled={saving}
          aria-label="Operating as"
          onChange={(event) => void selectAccount(event.target.value)}
        >
          {activeContext.options.map((option) => (
            <option key={option.accountId} value={option.accountId}>
              {option.displayName}
            </option>
          ))}
        </select>
        {saving ? <span>Switching…</span> : null}
      </div>

      {activeContext.isOperating ? (
        <div className="atlas-owner-operator__notice" aria-live="polite">
          Operating for {activeContext.effective.displayName}
        </div>
      ) : null}

      {error ? <p role="alert">{error}</p> : null}
    </aside>
  );
}
