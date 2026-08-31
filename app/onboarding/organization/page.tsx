import { redirect } from "next/navigation";

import { getAtlasSession } from "@/lib/atlas/session";
import OrganizationOnboardingClient from "./OrganizationOnboardingClient";
import styles from "./organization.module.css";

export const dynamic = "force-dynamic";

export default async function OrganizationOnboardingPage() {
  const session = await getAtlasSession();
  if (!session) redirect("/login?next=%2Fonboarding%2Forganization");

  return (
    <main className={styles.page}>
      <section className={styles.sheet} aria-labelledby="organization-onboarding-title">
        <header className={styles.header}>
          <p className={styles.eyebrow}>Organization Atlas</p>
          <h1 id="organization-onboarding-title">What organization are you setting up Atlas for?</h1>
          <p>
            Start the organization first. You are the human carrying setup, but Atlas will not infer that
            you own it, work for it, or belong to it. Those relationships are separate facts and can be
            added later when they are actually known.
          </p>
        </header>

        <OrganizationOnboardingClient />

        <footer className={styles.footer}>
          <span>Setup carried by</span>
          <strong>{session.displayName}</strong>
          {session.organizationMemberships.length ? (
            <span>{session.organizationMemberships.length} existing organization relationship(s) remain unchanged.</span>
          ) : null}
        </footer>
      </section>
    </main>
  );
}
