"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";

import { atlasPostLoginPath } from "@/lib/atlas/auth-core.js";
import styles from "./login.module.css";

export default function LoginClient({ signupEnabled }: { signupEnabled: boolean }) {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/atlas/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: form.get("email"),
        password: form.get("password"),
      }),
    });

    const result = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok) {
      setError(result?.error ?? "That login did not work.");
      setLoading(false);
      return;
    }

    window.location.replace(atlasPostLoginPath());
  }

  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="atlas-login-title">
        <p className={styles.eyebrow}>Your Atlas</p>
        <h1 id="atlas-login-title">Atlas</h1>
        <p className={styles.intro}>Sign in to open your Atlas.</p>

        <form onSubmit={submit} className={styles.form}>
          <label>
            <span>Email</span>
            <input name="email" type="email" autoComplete="email" required />
          </label>
          <label>
            <span>Password</span>
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
          {error ? <p className={styles.error} role="alert">{error}</p> : null}
          <button type="submit" disabled={loading}>
            {loading ? "Opening Atlas…" : "Sign in"}
          </button>
        </form>

        {signupEnabled ? (
          <Link className={styles.joinLink} href="/join">
            Create your Atlas
          </Link>
        ) : null}
      </section>
    </main>
  );
}
