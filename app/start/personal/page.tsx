import Link from "next/link";

import { humanSignupEnabled } from "@/lib/atlas/account-bootstrap-core.js";
import styles from "../../welcome/front-door.module.css";

export const dynamic = "force-dynamic";

export default function PersonalAtlasStartPage() {
  const signupEnabled = humanSignupEnabled(process.env.ATLAS_HUMAN_SIGNUP_ENABLED);

  return (
    <main className={styles.page}>
      <section className={styles.detail}>
        <p className={styles.eyebrow}>Personal Atlas</p>
        <h1>Atlas for one human life.</h1>
        <p>
          Your Personal Atlas belongs to you—not to your employer, farm, household, or any other
          organization you may be connected to. Those relationships can be added later without turning
          the organizations into parts of your personal account.
        </p>

        <div className={styles.paths}>
          <div className={styles.path}>
            <h2>I already have an Atlas account</h2>
            <p>Sign in and open your existing Personal Atlas.</p>
            <Link className={styles.primary} href="/login">Sign in</Link>
          </div>

          <div className={styles.path}>
            <h2>I&apos;m new to Atlas</h2>
            <p>
              A new Personal Atlas begins with one human identity. Organizations and provider accounts
              are connected afterward; neither one becomes your identity.
            </p>
            {signupEnabled ? (
              <Link className={styles.secondary} href="/join">Create a Personal Atlas</Link>
            ) : (
              <span className={styles.muted}>New Personal Atlas signup is not open publicly yet.</span>
            )}
          </div>
        </div>

        <p className={styles.muted}>
          Looking for a company or group? <Link className={styles.inlineLink} href="/start/organization">Start an Organization Atlas.</Link>
        </p>
      </section>
    </main>
  );
}
