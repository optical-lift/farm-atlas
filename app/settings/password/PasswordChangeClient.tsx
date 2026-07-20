"use client";

import { FormEvent, useState } from "react";

import styles from "./password.module.css";

export default function PasswordChangeClient() {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);

    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/atlas/auth/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        password: form.get("password"),
        confirmation: form.get("confirmation"),
      }),
    });

    const result = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;

    if (!response.ok) {
      setError(result?.error ?? "Atlas could not change the password.");
      setLoading(false);
      return;
    }

    event.currentTarget.reset();
    setMessage("Password changed.");
    setLoading(false);
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <label>
        <span>New password</span>
        <input name="password" type="password" autoComplete="new-password" minLength={12} required />
      </label>
      <label>
        <span>Repeat new password</span>
        <input name="confirmation" type="password" autoComplete="new-password" minLength={12} required />
      </label>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {message ? <p className={styles.success} role="status">{message}</p> : null}
      <button type="submit" disabled={loading}>
        {loading ? "Changing…" : "Change password"}
      </button>
    </form>
  );
}
