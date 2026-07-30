"use client";

import type { CSSProperties } from "react";
import { useState } from "react";
import { usePathname } from "next/navigation";

import type { AtlasOwnerOperatorContext } from "@/lib/atlas/operator-context";

type OwnerOperatorModeProps = {
  context: AtlasOwnerOperatorContext | null;
};

const logoutButtonStyle: CSSProperties = {
  appearance: "none",
  border: 0,
  background: "transparent",
  color: "inherit",
  cursor: "pointer",
  font: "inherit",
  fontSize: "10px",
  fontWeight: 800,
  lineHeight: 1,
  minHeight: "32px",
  padding: "0 5px",
  textDecoration: "underline",
  textDecorationThickness: "1px",
  textUnderlineOffset: "3px",
  opacity: 0.72,
};

const logoutOnlyStyle: CSSProperties = {
  position: "fixed",
  top: "7px",
  right: "max(9px, env(safe-area-inset-right))",
  zIndex: 1100,
  margin: 0,
  borderRadius: "999px",
  background: "rgba(248, 247, 242, 0.9)",
  color: "#555a86",
  padding: "0 3px",
  boxShadow: "0 2px 8px rgba(47, 48, 66, 0.08)",
};

function LogoutForm({ standalone = false }: { standalone?: boolean }) {
  return (
    <form
      action="/api/atlas/auth/logout"
      method="post"
      style={standalone ? logoutOnlyStyle : { marginLeft: "auto" }}
    >
      <button type="submit" aria-label="Log out of Atlas" style={logoutButtonStyle}>
        Log out
      </button>
    </form>
  );
}

export default function OwnerOperatorMode({ context }: OwnerOperatorModeProps) {
  const pathname = usePathname();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!context) {
    if (pathname === "/login" || pathname.startsWith("/auth/")) return null;
    return <LogoutForm standalone />;
  }
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
          onChange={(event) => void selectAccount(event.target.value)}
        >
          {activeContext.options.map((option) => (
            <option key={option.accountId} value={option.accountId}>
              {option.displayName}
            </option>
          ))}
        </select>
        {saving ? <span>Switching…</span> : null}
        <LogoutForm />
      </div>

      {activeContext.isOperating ? (
        <div className="atlas-owner-operator__notice">
          <strong>Operating {activeContext.effective.displayName}&apos;s Atlas</strong>
          <span>Actions change live Atlas data and are recorded as {activeContext.actor.displayName} operating for {activeContext.effective.displayName}.</span>
        </div>
      ) : null}

      {error ? <p role="alert">{error}</p> : null}
    </aside>
  );
}
