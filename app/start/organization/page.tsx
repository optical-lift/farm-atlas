import Link from "next/link";

import styles from "../../welcome/front-door.module.css";

export const dynamic = "force-dynamic";

export default function OrganizationAtlasStartPage() {
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
              Sign in with your existing human account and carry this setup from there. Atlas will not
              create a second Personal Atlas or automatically add you to the organization&apos;s membership graph.
            </p>
            <Link className={styles.primary} href="/login?next=%2Fonboarding%2Forganization">
              Sign in and continue
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
