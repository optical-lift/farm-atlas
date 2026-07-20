import Link from "next/link";

import { getOwnerMemberDirectory } from "@/lib/atlas-data/members";
import { requireAtlasRole } from "@/lib/atlas/role-access";
import MembershipClient from "./MembershipClient";
import styles from "./members.module.css";

export const dynamic = "force-dynamic";

export default async function OwnerMembersPage() {
  const access = await requireAtlasRole(["owner"]);
  const directory = await getOwnerMemberDirectory(access);

  return (
    <main className={styles.page}>
      <section className={styles.shell} aria-labelledby="owner-members-title">
        <header className={styles.header}>
          <div>
            <p className={styles.kicker}>{directory.farmName}</p>
            <h1 id="owner-members-title">People &amp; Access</h1>
            <p className={styles.identity}>{access.session.displayName}</p>
          </div>
          <Link className={styles.back} href="/owner">
            Owner work
          </Link>
        </header>

        <MembershipClient directory={directory} />
      </section>
    </main>
  );
}
