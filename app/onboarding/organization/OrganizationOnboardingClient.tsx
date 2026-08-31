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
  setupActor?: {
    kind?: string;
    active?: boolean;
    membership_created?: boolean;
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
      const response = await fetch("/api/atlas/organizations/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const payload = await response.json();

      if (!response.ok || !payload?.ok) {
        setError(payload?.error ?? "Atlas could not begin setup for that organization.");
        return;
      }

      setCreated(payload.result as OrganizationResult);
      router.refresh();
    } catch {
      setError("Atlas could not begin setup for that organization.");
    } finally {
      setSaving(false);
    }
  }

  if (created?.organization?.id) {
    return (
      <section className={styles.success} aria-live="polite">
        <p className={styles.step}>Organization Atlas started</p>
        <h2>{created.organization.name ?? "Organization"}</h2>
        <p>
          The organization now exists independently in Atlas. You are carrying setup, but Atlas has not
          made you an owner, employee, or member and has not created a farm or imported another organization&apos;s data.
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
        Atlas will create the organization as its own custody root and record only that you are carrying
        setup. Membership, ownership, employment, and other human relationships come later when they are known.
      </p>
      {error ? <p className={styles.error}>{error}</p> : null}
      <button type="submit" disabled={saving}>
        {saving ? "Starting…" : "Start Organization Atlas"}
      </button>
    </form>
  );
}
