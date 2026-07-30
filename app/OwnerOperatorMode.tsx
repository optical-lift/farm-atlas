"use client";

import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { createPortal } from "react-dom";

import type { AtlasOwnerOperatorContext } from "@/lib/atlas/operator-context";

type OwnerOperatorModeProps = {
  context: AtlasOwnerOperatorContext | null;
};

const cardStyle: CSSProperties = {
  margin: "0 16px 14px",
  border: "1px solid rgba(88, 87, 111, 0.12)",
  borderRadius: "14px",
  background: "#fffdf7",
  padding: "14px",
  boxShadow: "0 4px 12px rgba(47, 48, 66, 0.035)",
};

const labelStyle: CSSProperties = {
  display: "block",
  marginBottom: "7px",
  color: "#77786f",
  fontSize: "9px",
  fontWeight: 950,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
};

const selectStyle: CSSProperties = {
  width: "100%",
  minHeight: "46px",
  border: "1px solid rgba(85, 90, 134, 0.26)",
  borderRadius: "12px",
  background: "#fbfaf4",
  color: "#303243",
  padding: "0 38px 0 13px",
  fontSize: "14px",
  fontWeight: 900,
};

const noteStyle: CSSProperties = {
  margin: "8px 1px 0",
  color: "#72736d",
  fontSize: "10px",
  lineHeight: 1.35,
  fontWeight: 700,
};

export default function OwnerOperatorMode({ context }: OwnerOperatorModeProps) {
  const pathname = usePathname();
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (pathname !== "/more") {
      setMount(null);
      return;
    }
    setMount(document.getElementById("atlas-more-account-slot"));
  }, [pathname]);

  if (!context || !mount || pathname !== "/more") return null;
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

  return createPortal(
    <section style={cardStyle} aria-label="Owner operator mode" data-effective-account-id={activeContext.effective.accountId}>
      <label htmlFor="atlas-owner-operator-select" style={labelStyle}>Operating as</label>
      <select
        id="atlas-owner-operator-select"
        value={activeContext.effective.accountId}
        disabled={saving}
        aria-label="Operating as"
        style={selectStyle}
        onChange={(event) => void selectAccount(event.target.value)}
      >
        {activeContext.options.map((option) => (
          <option key={option.accountId} value={option.accountId}>
            {option.displayName}
          </option>
        ))}
      </select>
      {saving ? <p style={noteStyle}>Switching…</p> : null}
      {activeContext.isOperating ? (
        <p style={noteStyle}>
          Actions change live Atlas data and remain recorded as {activeContext.actor.displayName} operating for {activeContext.effective.displayName}.
        </p>
      ) : null}
      {error ? <p role="alert" style={{ ...noteStyle, color: "#9b2f3f" }}>{error}</p> : null}
    </section>,
    mount,
  );
}
