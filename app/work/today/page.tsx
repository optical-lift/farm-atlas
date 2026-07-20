import Link from "next/link";

import { requireAtlasRole } from "@/lib/atlas/role-access";
import styles from "@/app/role-home.module.css";

export default async function WorkerTodayPage() {
  const { session, membership } = await requireAtlasRole(["owner", "manager", "farm_hand"]);

  return (
    <main className={styles.page}>
      <section className={styles.shell} aria-labelledby="worker-title">
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Today</p>
            <h1 className={styles.title} id="worker-title">
              {membership.farmName ?? "Farm work"}
            </h1>
            <p className={styles.identity}>{session.displayName}</p>
          </div>
          <Link className={styles.back} href="/">
            Farms
          </Link>
        </header>

        <article className={styles.card}>
          <h2>Next useful action</h2>
          <p>No worker-safe task has been prepared for this view yet.</p>
          <div className={styles.meta}>
            <span className={styles.pill}>Assigned work only</span>
            <span className={styles.pill}>Farm scoped</span>
          </div>
        </article>
      </section>
    </main>
  );
}
