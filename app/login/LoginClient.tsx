"use client";

import { FormEvent, useState } from "react";

import { atlasPostLoginPath } from "@/lib/atlas/auth-core.js";
import styles from "./login.module.css";

export default function LoginClient({
  signupEnabled: _signupEnabled,
  nextPath,
}: {
  signupEnabled: boolean;
  nextPath?: string | null;
}) {
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

    window.location.replace(nextPath ?? atlasPostLoginPath());
  }

  return (
    <main className={styles.page} data-atlas-login-page="true">
      <div className={styles.shell}>
        <div className={styles.brandBar} aria-label="Atlas">
          <span className={styles.brand}>ATLAS</span>
        </div>

        <section className={styles.loginContent} aria-labelledby="atlas-login-title">
          <p className={styles.eyebrow}>Atlas</p>
          <h1 id="atlas-login-title">Sign in</h1>
          <p className={styles.intro}>Atlas is being rebuilt from first principles.</p>

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
              {loading ? "Opening…" : "Sign in"}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
