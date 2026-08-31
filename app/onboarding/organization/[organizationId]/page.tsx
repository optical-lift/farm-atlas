import { notFound, redirect } from "next/navigation";

import { getAtlasSession } from "@/lib/atlas/session";
import { createAtlasServerClient } from "@/lib/supabase/server";
import styles from "../organization.module.css";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ organizationId: string }>;
};

type OrganizationOnboardingContext = {
  organization?: {
    id?: string;
    name?: string;
    stable_key?: string;
    onboarding_state?: string;
  };
  relationship?: {
    setup_actor?: boolean;
    membership_role?: string | null;
  };
  reconstruction?: {
    id?: string;
    clean_room?: boolean;
    allow_existing_atlas_canon?: boolean;
  } | null;
};

export default async function OrganizationSourceOnboardingPage({ params }: Props) {
  const session = await getAtlasSession();
  if (!session) redirect("/login");

  const { organizationId } = await params;
  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("organization_onboarding_context_self_api_v1", {
    p_organization_id: organizationId,
  });

  if (error || !data || typeof data !== "object" || Array.isArray(data)) notFound();
  const context = data as OrganizationOnboardingContext;
  const organization = context.organization;
  if (!organization?.id) notFound();

  const carryingSetup = context.relationship?.setup_actor === true;
  const membershipRole = context.relationship?.membership_role ?? null;

  return (
    <main className={styles.page}>
      <section className={styles.sheet}>
        <header className={styles.header}>
          <p className={styles.eyebrow}>Organization Atlas</p>
          <h1>{organization.name ?? "Organization"}</h1>
          <p>
            This organization has its own Atlas custody root. The next step is to authorize sources that
            belong to this organization. Sources from your Personal Atlas or other organizations are not
            eligible for this clean-room reconstruction unless they are deliberately moved under this organization&apos;s custody.
          </p>
        </header>

        <section className={styles.success}>
          <p className={styles.step}>Next</p>
          <h2>Connect organization evidence</h2>
          <p>
            Google, Dropbox, and other provider authorization will attach here as organization-held
            sources. Atlas will not treat the provider account as a human identity, and it will not import
            existing Atlas canon into this clean-room reconstruction.
          </p>
        </section>

        <footer className={styles.footer}>
          {carryingSetup ? <span>Carrying setup as a temporary setup actor</span> : null}
          {membershipRole ? <strong>Existing organization relationship: {membershipRole}</strong> : null}
          {!membershipRole ? <span>No ownership, employment, or membership has been inferred.</span> : null}
        </footer>
      </section>
    </main>
  );
}
