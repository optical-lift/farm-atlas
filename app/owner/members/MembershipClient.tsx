"use client";

import type { AtlasMemberDirectory } from "@/lib/atlas-data/members";
import styles from "./members.module.css";

function roleLabel(role: string) {
  if (role === "farm_hand") return "Farm Hand";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

// Read only. Existing farm membership source remains available to its owner;
// no invitation drafts, implicit employee identity, or membership mutations.
export default function MembershipClient({ directory }: {
  directory: AtlasMemberDirectory;
}) {
  return (
    <div className={styles.content}>
      <section className={styles.section} aria-labelledby="current-members-title">
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.kicker}>Active access</p>
            <h2 id="current-members-title">Farm members</h2>
          </div>
          <span>{directory.memberships.length}</span>
        </div>
        <div className={styles.list}>
          {directory.memberships.map((member) => (
            <article className={styles.card} key={member.record_id}>
              <div>
                <strong>{member.display_name}</strong>
                <p>{member.email}</p>
              </div>
              <div className={styles.cardMeta}>
                <span>{roleLabel(member.role)}</span>
                {member.worker_key ? <span>{member.worker_key}</span> : null}
                <span>{member.status}</span>
              </div>
            </article>
          ))}
        </div>
      </section>
      <p className={styles.empty}>
        New invitations are handled by the current Atlas Organization access process.
      </p>
    </div>
  );
}
