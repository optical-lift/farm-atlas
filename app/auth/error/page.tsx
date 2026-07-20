import Link from "next/link";

import styles from "./error.module.css";

export default function AtlasAuthErrorPage() {
  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="atlas-auth-error-title">
        <p className={styles.eyebrow}>Atlas invitation</p>
        <h1 id="atlas-auth-error-title">This invitation link did not open.</h1>
        <p>
          The link may be incomplete, expired, or attached to a different email address.
        </p>
        <Link href="/login">Open Atlas login</Link>
      </section>
    </main>
  );
}
