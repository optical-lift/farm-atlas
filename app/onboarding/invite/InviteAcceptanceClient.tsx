"use client";

import { FormEvent, useState } from "react";

import styles from "./invite.module.css";

export default function InviteAcceptanceClient({ inviteId }: { inviteId: string }) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  async function acceptInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true);
    setError("");

    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/atlas/auth/invite/accept", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inviteId,
        password: form.get("password"),
        confirmation: form.get("confirmation"),
      }),
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
    <form className={styles.actions} onSubmit={acceptInvite}>
      <label>
        <span>Create an Atlas password</span>
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
        />
      </label>
      <label>
        <span>Repeat the password</span>
        <input
          name="confirmation"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
        />
      </label>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <button type="submit" disabled={working}>
        {working ? "Joining farm…" : "Create account and accept access"}
      </button>
    </form>
  );
}
