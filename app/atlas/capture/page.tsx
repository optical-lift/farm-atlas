import Link from "next/link";
import { redirect } from "next/navigation";

import { getAtlasSession } from "@/lib/atlas/session";

import PersonalReminderCapture from "./PersonalReminderCapture";
import styles from "../person-atlas-form.module.css";

export const dynamic = "force-dynamic";

export default async function PersonAtlasCapturePage() {
  const session = await getAtlasSession();
  if (!session) redirect("/login");

  return (
    <main className={styles.root}>
      <section className={styles.sheet}>
        <Link className={styles.back} href="/atlas">← Your Atlas</Link>
        <p className={styles.kicker}>Private · person-owned</p>
        <h1 className={styles.title}>Remember something.</h1>
        <p className={styles.intro}>
          This stays in your personal Atlas. It does not become Company Work, does not tell an employer what it is,
          and does not create a Clock placement merely because you want to remember it.
        </p>
        <PersonalReminderCapture />
      </section>
    </main>
  );
}
