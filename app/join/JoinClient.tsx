"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";

import styles from "../login/login.module.css";

export default function JoinClient() {
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);

    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/atlas/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        displayName: form.get("displayName"),
        email: form.get("email"),
        password: form.get("password"),
      }),
    });

    const result = (await response.json().catch(() => null)) as
      | { error?: string; confirmationRequired?: boolean }
      | null;

    if (!response.ok) {
      setError(result?.error ?? "Atlas could not create that account.");
      setLoading(false);
      return;
    }

    if (result?.confirmationRequired === false) {
      window.location.replace("/onboarding");
      return;
    }

    event.currentTarget.reset();
    setMessage("Check your email to confirm this Atlas account.");
    setLoading(false);
  }

  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="atlas-join-title">
        <p className={styles.eyebrow}>Your Atlas</p>
        <h1 id="atlas-join-title">Begin</h1>
        <p className={styles.intro}>
          Create your human Atlas first. Farms, organizations, and connected accounts can come later.
        </p>

        <form onSubmit={submit} className={styles.form}>
          <label>
            <span>Name</span>
            <input name="displayName" type="text" autoComplete="name" required />
          </label>
          <label>
            <span>Email</span>
            <input name="email" type="email" autoComplete="email" required />
          </label>
          <label>
            <span>Password</span>
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
            />
          </label>
          {error ? <p className={styles.error} role="alert">{error}</p> : null}
          {message ? <p role="status">{message}</p> : null}
          <button type="submit" disabled={loading || Boolean(message)}>
            {loading ? "Creating…" : "Create Atlas"}
          </button>
        </form>

        <Link className={styles.joinLink} href="/login">
          I already have an Atlas
        </Link>
      </section>
    </main>
  );
}
