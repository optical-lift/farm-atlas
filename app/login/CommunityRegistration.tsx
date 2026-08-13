"use client";

import { FormEvent, useEffect, useState } from "react";

import styles from "./community-registration.module.css";

type EventDate = { date: string; start_time: string; end_time: string; title: string };
type Offering = {
  stable_key: string;
  title: string;
  fee_amount: number;
  fee_currency: string;
  public_description: string | null;
  events: EventDate[];
  public: {
    location_label?: string;
    headline?: string;
    experience_note?: string;
    what_to_bring?: string[];
    payment_note?: string;
  };
};
type RegistrationResult = {
  registration_number?: string;
  amount_due?: number;
  currency?: string;
  message?: string;
};

function displayDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(
    new Date(`${value}T12:00:00`),
  );
}

function displayTime(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  const date = new Date(2026, 0, 1, hour, minute);
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date);
}

export default function CommunityRegistration({ offeringKey }: { offeringKey: string }) {
  const [offering, setOffering] = useState<Offering | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<RegistrationResult | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/atlas/auth/community-registration?offering=${encodeURIComponent(offeringKey)}`, { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { offering?: Offering; error?: string } | null;
        if (!response.ok || !body?.offering) throw new Error(body?.error ?? "Registration could not be loaded.");
        if (active) setOffering(body.offering);
      })
      .catch((reason: Error) => active && setError(reason.message))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [offeringKey]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const participantNames = String(form.get("participants") ?? "")
      .split(/\r?\n/)
      .map((name) => name.trim())
      .filter(Boolean);

    const response = await fetch("/api/atlas/auth/community-registration", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        offering: offeringKey,
        primaryName: form.get("primaryName"),
        primaryEmail: form.get("primaryEmail"),
        primaryPhone: form.get("primaryPhone"),
        householdName: form.get("householdName"),
        participantNames,
        termsAccepted: form.get("termsAccepted") === "on",
        website: form.get("website"),
      }),
    });
    const body = (await response.json().catch(() => null)) as (RegistrationResult & { error?: string }) | null;
    if (!response.ok) {
      setError(body?.error ?? "Registration could not be saved.");
      setSubmitting(false);
      return;
    }
    setResult(body ?? { message: "Registration received." });
    setSubmitting(false);
  }

  if (loading) return <main className={styles.page}><div className={styles.shell}>Loading registration…</div></main>;
  if (!offering) return <main className={styles.page}><div className={styles.shell}><p className={styles.error}>{error || "Registration is not open."}</p></div></main>;

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <section className={styles.card}>
          <p className={styles.eyebrow}>Elm Farm · Family Field Club</p>
          <h1 className={styles.title}>{offering.title}</h1>
          <p className={styles.headline}>{offering.public.headline ?? "Parents play. Kids play."}</p>
          <p className={styles.description}>{offering.public_description}</p>

          <div className={styles.facts}>
            <div className={styles.fact}><strong>${Number(offering.fee_amount).toFixed(0)}</strong><span>per family · all six weeks</span></div>
            <div className={styles.fact}><strong>Tuesdays</strong><span>6:00–7:30 p.m.</span></div>
            <div className={styles.fact}><strong>{offering.public.location_label ?? "Elm Farm"}</strong><span>evenings through sunset</span></div>
          </div>

          <div className={styles.dates}>
            <h2>Six Tuesday evenings</h2>
            <ul>{offering.events.map((item) => <li key={item.date}>{displayDate(item.date)} · {displayTime(item.start_time)}–{displayTime(item.end_time)}</li>)}</ul>
          </div>

          {offering.public.experience_note ? <p className={styles.description}>{offering.public.experience_note}</p> : null}

          {result ? (
            <div className={styles.success} role="status">
              <h2>You’re on the list.</h2>
              {result.registration_number ? <p><strong>Registration:</strong> {result.registration_number}</p> : null}
              <p>{result.message ?? "Registration received."}</p>
              {offering.public.payment_note ? <p className={styles.muted}>{offering.public.payment_note}</p> : null}
            </div>
          ) : (
            <form className={styles.form} onSubmit={submit}>
              <h2>Register your family</h2>
              <label className={styles.field}>Family / household name<input name="householdName" autoComplete="organization" placeholder="The Miller family" /></label>
              <label className={styles.field}>Primary adult<input name="primaryName" autoComplete="name" required /></label>
              <label className={styles.field}>Email<input name="primaryEmail" type="email" autoComplete="email" required /></label>
              <label className={styles.field}>Phone<input name="primaryPhone" type="tel" autoComplete="tel" /></label>
              <label className={styles.field}>Who else plans to play?<small>One name per line. No age brackets needed.</small><textarea name="participants" placeholder={"Sam\nLucy\nHenry"} /></label>
              <label className={styles.check}><input name="termsAccepted" type="checkbox" required /><span>I understand this is an active family recreation program on a working farm, and our family will follow the host’s on-site safety directions.</span></label>
              <label style={{ display: "none" }} aria-hidden="true">Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
              {error ? <p className={styles.error} role="alert">{error}</p> : null}
              <button className={styles.submit} type="submit" disabled={submitting}>{submitting ? "Registering…" : `Register family · $${Number(offering.fee_amount).toFixed(0)}`}</button>
              {offering.public.payment_note ? <p className={styles.muted}>{offering.public.payment_note}</p> : null}
            </form>
          )}
        </section>
      </div>
    </main>
  );
}
