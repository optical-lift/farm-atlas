import Link from "next/link";

import { requireAtlasRole } from "@/lib/atlas/role-access";
import styles from "@/app/role-home.module.css";

export default async function ManagerHomePage() {
  const { session, membership } = await requireAtlasRole(["owner", "manager"]);

  return (
    <main className={styles.page}>
      <section className={styles.shell} aria-labelledby="manager-title">
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Farm management</p>
            <h1 className={styles.title} id="manager-title">
              {membership.farmName ?? "Farm"}
            </h1>
            <p className={styles.identity}>{session.displayName}</p>
          </div>
          <Link className={styles.back} href="/">
            Farms
          </Link>
        </header>

        <article className={styles.card}>
          <h2>Management hand</h2>
          <p>No management actions are available in this view yet.</p>
          <div className={styles.meta}>
            <span className={styles.pill}>Manager access</span>
            <span className={styles.pill}>Farm scoped</span>
          </div>
        </article>
      </section>
    </main>
  );
}
