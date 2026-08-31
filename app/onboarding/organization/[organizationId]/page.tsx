import { notFound, redirect } from "next/navigation";

import { getAtlasSession } from "@/lib/atlas/session";
import styles from "../organization.module.css";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ organizationId: string }>;
};

export default async function OrganizationSourceOnboardingPage({ params }: Props) {
  const session = await getAtlasSession();
  if (!session) redirect("/login");

  const { organizationId } = await params;
  const membership = session.organizationMemberships.find(
    (candidate) => candidate.organizationId === organizationId,
  );

  if (!membership) notFound();

  return (
    <main className={styles.page}>
      <section className={styles.sheet}>
        <header className={styles.header}>
          <p className={styles.eyebrow}>Organization onboarding</p>
          <h1>{membership.organizationName ?? "Organization"}</h1>
          <p>
            This organization now has its own Atlas custody root. The next step is to authorize sources
            that belong to this organization. Sources from your other organizations are not eligible for
            this reconstruction session.
          </p>
        </header>

        <section className={styles.success}>
          <p className={styles.step}>Next</p>
          <h2>Connect organization evidence</h2>
          <p>
            Google, Dropbox, and other provider authorization will attach here as organization-held
            sources. Atlas will not treat the provider account as your human identity, and it will not
            import existing Atlas canon into this clean-room reconstruction.
          </p>
        </section>

        <footer className={styles.footer}>
          <span>Authorized human relationship</span>
          <strong>{membership.role}</strong>
          <span>No farm is implied by this organization.</span>
        </footer>
      </section>
    </main>
  );
}
