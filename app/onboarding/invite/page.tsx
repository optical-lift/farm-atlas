import { redirect } from "next/navigation";

import { getPendingMembershipInvite } from "@/lib/atlas-data/invites";
import { isValidInviteId } from "@/lib/atlas/invite-flow-core.js";
import { getAtlasSession } from "@/lib/atlas/session";
import InviteAcceptanceClient from "./InviteAcceptanceClient";
import styles from "./invite.module.css";

export const dynamic = "force-dynamic";

function roleLabel(role: string) {
  return role === "farm_hand" ? "Farm Hand" : "Manager";
}

export default async function InvitationOnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  const params = await searchParams;
  const inviteId = typeof params.invite === "string" ? params.invite : "";

  if (!isValidInviteId(inviteId)) {
    redirect("/auth/error?reason=invalid_invite");
  }

  const session = await getAtlasSession();
  if (!session) {
    redirect(`/login?next=${encodeURIComponent(`/onboarding/invite?invite=${inviteId}`)}`);
  }

  const invite = await getPendingMembershipInvite(inviteId);
  if (!invite) {
    redirect("/auth/error?reason=invite_not_available");
  }

  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="invite-title">
        <p className={styles.eyebrow}>Atlas invitation</p>
        <h1 id="invite-title">Join {invite.farm_name}</h1>
        <p className={styles.intro}>
          {invite.display_name}, this access is prepared for your signed-in email.
        </p>

        <dl className={styles.details}>
          <div>
            <dt>Farm role</dt>
            <dd>{roleLabel(invite.role)}</dd>
          </div>
          {invite.worker_key ? (
            <div>
              <dt>Worker identity</dt>
              <dd>{invite.worker_key}</dd>
            </div>
          ) : null}
          <div>
            <dt>Signed in as</dt>
            <dd>{session.email ?? session.displayName}</dd>
          </div>
        </dl>

        <p className={styles.note}>
          Accepting creates your farm membership and opens only the Atlas perspective assigned to this role.
        </p>

        <InviteAcceptanceClient inviteId={inviteId} />
      </section>
    </main>
  );
}
