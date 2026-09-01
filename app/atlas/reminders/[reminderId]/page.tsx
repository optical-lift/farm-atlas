import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { atlasFarmDateLabel } from "@/lib/atlas/farm-day";
import { getAtlasSession } from "@/lib/atlas/session";
import { createAtlasServerClient } from "@/lib/supabase/server";

import PersonalReminderDoneButton from "./PersonalReminderDoneButton";
import styles from "../../person-atlas-form.module.css";

export const dynamic = "force-dynamic";

type PersonClaim = {
  claimId?: string;
  claimType?: string;
  lifecycleState?: string;
  subject?: { domain?: string; kind?: string; id?: string };
  value?: Record<string, unknown> | null;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export default async function PersonalReminderPage({ params }: { params: Promise<{ reminderId: string }> }) {
  const session = await getAtlasSession();
  if (!session) redirect("/login");

  const { reminderId } = await params;
  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("person_claim_evidence_state_api_v1");
  if (error) throw new Error("Atlas could not read this private reminder.");
  const envelope = data && typeof data === "object" && !Array.isArray(data)
    ? data as { currentClaims?: PersonClaim[] }
    : {};
  const claim = (envelope.currentClaims ?? []).find((candidate) => (
    candidate.claimType === "personal_reminder"
    && candidate.subject?.domain === "personal"
    && candidate.subject?.kind === "reminder"
    && candidate.subject?.id === reminderId
    && !["superseded", "expired", "rejected"].includes(candidate.lifecycleState ?? "")
  ));
  if (!claim?.value) notFound();

  const label = text(claim.value.label) || "Personal reminder";
  const note = text(claim.value.note);
  const dueDate = text(claim.value.dueDate);
  const state = text(claim.value.state) || "open";
  const done = ["done", "completed", "dismissed"].includes(state);

  return (
    <main className={styles.root}>
      <section className={styles.sheet}>
        <Link className={styles.back} href="/atlas">← Your Atlas</Link>
        <p className={styles.kicker}>Private · person-owned</p>
        <h1 className={styles.title}>{label}</h1>
        {note ? <p className={styles.intro}>{note}</p> : null}
        <dl className={styles.factList}>
          <div><dt>Jurisdiction</dt><dd>Personal</dd></div>
          <div><dt>Authority</dt><dd>Person-owned Claim</dd></div>
          <div><dt>Visibility</dt><dd>Private</dd></div>
          {dueDate ? <div><dt>When</dt><dd>{atlasFarmDateLabel(dueDate, { month: "short", day: "numeric", year: "numeric" })}</dd></div> : null}
          <div><dt>State</dt><dd>{state}</dd></div>
        </dl>
        {done ? <p className={styles.intro}>This reminder is complete.</p> : <PersonalReminderDoneButton reminderId={reminderId} />}
      </section>
    </main>
  );
}
