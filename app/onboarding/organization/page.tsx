import { redirect } from "next/navigation";

import { getAtlasSession } from "@/lib/atlas/session";
import OrganizationOnboardingClient from "./OrganizationOnboardingClient";
import styles from "./organization.module.css";

export const dynamic = "force-dynamic";

export default async function OrganizationOnboardingPage() {
  const session = await getAtlasSession();
  if (!session) redirect("/login");

  return (
    <main className={styles.page}>
      <section className={styles.sheet} aria-labelledby="organization-onboarding-title">
        <header className={styles.header}>
          <p className={styles.eyebrow}>Add an organization</p>
          <h1 id="organization-onboarding-title">What independent organization are you authorized to establish?</h1>
          <p>
            The organization will have its own identity and custody in Atlas. You will be related to it
            as a human member; it will not live inside your personal account.
          </p>
        </header>

        <OrganizationOnboardingClient />

        <footer className={styles.footer}>
          <span>Acting as</span>
          <strong>{session.displayName}</strong>
          {session.organizationMemberships.length ? (
            <span>{session.organizationMemberships.length} existing organization relationship(s) remain unchanged.</span>
          ) : null}
        </footer>
      </section>
    </main>
  );
}
