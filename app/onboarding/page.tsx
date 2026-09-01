import { redirect } from "next/navigation";

import { classifyAtlasSession } from "@/lib/atlas/auth-core.js";
import { getAtlasSession } from "@/lib/atlas/session";
import styles from "./onboarding.module.css";

export const dynamic = "force-dynamic";

const ATLAS_PRODUCT_RESET = true;

const sourceFamilies = [
  {
    name: "Google",
    detail: "Email · Calendar · Contacts · Drive",
  },
  {
    name: "Microsoft",
    detail: "Mail · Calendar · Contacts · Files",
  },
  {
    name: "Dropbox",
    detail: "Personal or organization files",
  },
] as const;

export default async function AtlasOnboardingPage() {
  const session = await getAtlasSession();
  const state = classifyAtlasSession(session);

  if (state.status === "anonymous") redirect("/login");
  if (state.status === "active" && !ATLAS_PRODUCT_RESET) redirect("/");
  if (!session) redirect("/login");

  return (
    <main className={styles.page}>
      <section className={styles.sheet} aria-labelledby="atlas-onboarding-title">
        <header className={styles.header}>
          <p className={styles.eyebrow}>Your Atlas</p>
          <h1 id="atlas-onboarding-title">Atlas doesn&apos;t know much about your life yet.</h1>
          <p className={styles.intro}>
            Bring in the places your life is already recorded. Atlas will keep each source under its
            own custody, reconstruct what appears to belong together, and bring you the questions it
            cannot responsibly answer on its own.
          </p>
        </header>

        <section className={styles.section} aria-labelledby="source-heading">
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.step}>First</p>
              <h2 id="source-heading">Connect what already knows you</h2>
            </div>
            <span className={styles.quiet}>Source authorization is being prepared</span>
          </div>

          <div className={styles.sources}>
            {sourceFamilies.map((source) => (
              <article key={source.name} className={styles.sourceCard}>
                <div>
                  <h3>{source.name}</h3>
                  <p>{source.detail}</p>
                </div>
                <span className={styles.pending}>Not connected</span>
              </article>
            ))}
          </div>

          <p className={styles.note}>
            You will be able to connect more than one account from the same provider. A work inbox,
            personal inbox, and separate organization account remain distinct sources even when they
            all belong in the same human Atlas.
          </p>
        </section>

        <section className={styles.section} aria-labelledby="reconstruction-heading">
          <p className={styles.step}>Then</p>
          <h2 id="reconstruction-heading">Atlas reconstructs before it interrogates.</h2>
          <p className={styles.body}>
            People, organizations, places, commitments, rhythms, and unresolved contradictions will
            appear here as Atlas earns them from authorized evidence. Existing Atlas canon is not an
            automatic input to a clean-room reconstruction.
          </p>
        </section>

        <footer className={styles.footer}>
          <span>Signed in as</span>
          <strong>{session.email ?? session.displayName}</strong>
        </footer>
      </section>
    </main>
  );
}
