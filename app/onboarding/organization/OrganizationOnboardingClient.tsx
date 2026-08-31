"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import styles from "./organization.module.css";

type OrganizationResult = {
  organization?: {
    id?: string;
    name?: string;
    stable_key?: string;
    onboarding_state?: string;
  };
};

export default function OrganizationOnboardingClient() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<OrganizationResult | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    setSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/atlas/organizations/establish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const payload = await response.json();

      if (!response.ok || !payload?.ok) {
        setError(payload?.error ?? "Atlas could not establish that organization.");
        return;
      }

      setCreated(payload.result as OrganizationResult);
      router.refresh();
    } catch {
      setError("Atlas could not establish that organization.");
    } finally {
      setSaving(false);
    }
  }

  if (created?.organization?.id) {
    return (
      <section className={styles.success} aria-live="polite">
        <p className={styles.step}>Organization established</p>
        <h2>{created.organization.name ?? "Organization"}</h2>
        <p>
          It now exists as its own Atlas organization. Your authority is a relationship to it; no farm
          was created and no existing organization data was imported.
        </p>
        <a className={styles.primaryLink} href={`/onboarding/organization/${created.organization.id}`}>
          Continue to sources
        </a>
      </section>
    );
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <label htmlFor="organization-name">Organization name</label>
      <input
        id="organization-name"
        name="organizationName"
        autoComplete="organization"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Optical Lift"
        minLength={2}
        maxLength={160}
        required
      />
      <p className={styles.help}>
        Atlas will create an independent organization and record your authority to establish it. This
        does not create a farm or move anything out of another organization.
      </p>
      {error ? <p className={styles.error}>{error}</p> : null}
      <button type="submit" disabled={saving}>
        {saving ? "Establishing…" : "Establish organization"}
      </button>
    </form>
  );
}
