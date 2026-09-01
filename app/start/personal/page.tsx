import Link from "next/link";

import { humanSignupEnabled } from "@/lib/atlas/account-bootstrap-core.js";
import styles from "../../welcome/sales-page.module.css";

export const dynamic = "force-dynamic";

export default function PersonalAtlasStartPage() {
  const signupEnabled = humanSignupEnabled(process.env.ATLAS_HUMAN_SIGNUP_ENABLED);

  return (
    <main className={styles.page} data-atlas-sales-page="true">
      <div className={styles.shell}>
        <nav className={styles.brandBar} aria-label="Atlas">
          <Link className={styles.brand} href="/welcome">ATLAS</Link>
          <div className={styles.brandActions}>
            <Link href="/login">Sign in</Link>
          </div>
        </nav>

        <section className={styles.startContent}>
          <div className={styles.startIntro}>
            <p className={styles.eyebrow}>Personal Atlas</p>
            <h1>Atlas for one human life.</h1>
            <p className={styles.startLead}>
              Your Personal Atlas belongs to you—not to your employer, farm, household, or any other
              organization you may be connected to. Those relationships can be added later without turning
              the organizations into parts of your personal account.
            </p>
          </div>

          <div className={styles.startChoices}>
            <div className={styles.startChoice}>
              <p className={styles.choiceLabel}>I already have an Atlas account</p>
              <p>Sign in and open your existing Personal Atlas.</p>
              <Link className={styles.startPrimary} href="/login">Sign in</Link>
            </div>

            <div className={styles.startChoice}>
              <p className={styles.choiceLabel}>I&apos;m new to Atlas</p>
              <p>
                A new Personal Atlas begins with one human identity. Organizations and provider accounts
                are connected afterward; neither one becomes your identity.
              </p>
              {signupEnabled ? (
                <Link className={styles.startSecondary} href="/join">Create a Personal Atlas</Link>
              ) : (
                <span className={styles.startDisabled}>New Personal Atlas signup is not open publicly yet.</span>
              )}
            </div>
          </div>

          <p className={styles.startNote}>
            Looking for a company or group? <Link href="/start/organization">Start an Organization Atlas.</Link>
          </p>
        </section>
      </div>
    </main>
  );
}
