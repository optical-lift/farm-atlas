"use client";

import { useState } from "react";

import styles from "./invite.module.css";

export default function InviteAcceptanceClient({ inviteId }: { inviteId: string }) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  async function acceptInvite() {
    setWorking(true);
    setError("");

    const response = await fetch("/api/atlas/auth/invite/accept", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inviteId }),
    });

    const result = (await response.json().catch(() => null)) as
      | { error?: string; home?: string }
      | null;

    if (!response.ok) {
      setError(result?.error ?? "Atlas could not accept this invitation.");
      setWorking(false);
      return;
    }

    window.location.assign(result?.home ?? "/");
  }

  return (
    <div className={styles.actions}>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <button type="button" disabled={working} onClick={() => void acceptInvite()}>
        {working ? "Joining farm…" : "Accept farm access"}
      </button>
    </div>
  );
}
