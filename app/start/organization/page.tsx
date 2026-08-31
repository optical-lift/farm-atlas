import type { Metadata } from "next";
import Link from "next/link";

import { getAtlasSession } from "@/lib/atlas/session";
import styles from "../../welcome/front-door.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Organization Atlas",
  description: "Start Atlas for an independent organization before assigning human memberships.",
};

export default async function OrganizationAtlasStartPage() {
  const session = await getAtlasSession();
  const existingAtlasHref = session
    ? "/onboarding/organization"
    : "/login?next=%2Fonboarding%2Forganization";

  return (
    <main className={styles.page}>
      <section className={styles.detail}>
        <p className={styles.eyebrow}>Organization Atlas</p>
        <h1>Start with the organization.</h1>
        <p>
          You are the person carrying setup. That does not make you an owner, employee, or member in
          Atlas. The organization gets its own identity and custody first; people can be related to it
          later when those relationships are actually known.
        </p>

        <div className={styles.paths}>
          <div className={styles.path}>
            <h2>I already use Atlas personally</h2>
            <p>
              Use your existing human account to carry this setup. Atlas will not create a second
              Personal Atlas or automatically add you to the organization&apos;s membership graph.
            </p>
            <Link className={styles.primary} href={existingAtlasHref}>
              {session ? "Continue organization setup" : "Sign in and continue"}
            </Link>
          </div>

          <div className={styles.path}>
            <h2>I don&apos;t have a Personal Atlas</h2>
            <p>
              In the paid product, organization checkout begins here. The company can become an Atlas
              customer before any owner or employee creates a Personal Atlas. Payment is not live yet,
              so this path is intentionally not collecting billing details today.
            </p>
            <span className={styles.muted}>Organization checkout will connect here later.</span>
          </div>
        </div>

        <p className={styles.muted}>
          Setting up Atlas just for yourself? <Link className={styles.inlineLink} href="/start/personal">Start a Personal Atlas.</Link>
        </p>
      </section>
    </main>
  );
}
