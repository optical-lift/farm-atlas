import { redirect } from "next/navigation";

import { getAtlasSession } from "@/lib/atlas/session";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

function roleLabel(role: string) {
  if (role === "farm_hand") return "Farm Hand";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export default async function AtlasRootPage() {
  const session = await getAtlasSession();
  if (!session) redirect("/login");

  return (
    <main className={styles.page}>
      <section className={styles.shell} aria-labelledby="atlas-title">
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Farm command</p>
            <h1 id="atlas-title">Atlas</h1>
            <p className={styles.identity}>{session.displayName}</p>
          </div>
          <form action="/api/atlas/auth/logout" method="post">
            <button className={styles.signOut} type="submit">Sign out</button>
          </form>
        </header>

        <div className={styles.sectionHeading}>
          <h2>Your farms</h2>
          <span>{session.memberships.length}</span>
        </div>

        <div className={styles.farmList}>
          {session.memberships.map((membership) => (
            <article className={styles.farmCard} key={membership.membershipId}>
              <div>
                <p className={styles.farmName}>
                  {membership.farmName ?? membership.farmKey ?? "Farm"}
                </p>
                <p className={styles.farmStatus}>
                  {membership.farmStatus === "active" ? "Active farm" : membership.farmStatus ?? "Farm"}
                </p>
              </div>
              <span className={styles.role}>{roleLabel(membership.role)}</span>
            </article>
          ))}

          {session.memberships.length === 0 ? (
            <p className={styles.empty}>No active farm membership is attached to this account.</p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
