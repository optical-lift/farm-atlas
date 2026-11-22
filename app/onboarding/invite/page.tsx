import Link from "next/link";

import styles from "./invite.module.css";

export const dynamic = "force-dynamic";

// Historical invitations were never the universal Organization admission.
// Do not read or activate the old farm invitation table here.
export default function InvitationOnboardingPage() {
  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="invite-retired-title">
        <p className={styles.eyebrow}>Atlas invitation</p>
        <h1 id="invite-retired-title">This invitation route has been retired.</h1>
        <p className={styles.intro}>
          Invitations are now managed through Atlas's Organization access process.
          This old farm invitation link cannot create or change membership.
        </p>
        <Link href="/welcome">Open Atlas</Link>
      </section>
    </main>
  );
}
