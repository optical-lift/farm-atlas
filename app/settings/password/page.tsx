import Link from "next/link";
import { redirect } from "next/navigation";

import { getAtlasSession } from "@/lib/atlas/session";
import PasswordChangeClient from "./PasswordChangeClient";
import styles from "./password.module.css";

export const dynamic = "force-dynamic";

export default async function PasswordSettingsPage() {
  const session = await getAtlasSession();
  if (!session) redirect("/login?next=%2Fsettings%2Fpassword");

  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="password-title">
        <p className={styles.eyebrow}>Atlas account</p>
        <h1 id="password-title">Change password</h1>
        <p className={styles.intro}>
          Signed in as {session.displayName}. Use at least 12 characters.
        </p>
        <PasswordChangeClient />
        <Link className={styles.back} href="/">
          Back to farms
        </Link>
      </section>
    </main>
  );
}
