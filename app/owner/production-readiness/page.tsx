import { loadOwnerProductionCapacity } from "@/lib/atlas-data/production-capacity";
import { requireAtlasRole } from "@/lib/atlas/role-access";
import { createAtlasServerClient } from "@/lib/supabase/server";

import ProductionReadinessClient from "./ProductionReadinessClient";
import "./production-readiness.css";

export const dynamic = "force-dynamic";

export default async function OwnerProductionReadinessPage() {
  const access = await requireAtlasRole(["owner"]);
  const supabase = await createAtlasServerClient();
  const snapshot = await loadOwnerProductionCapacity(
    supabase,
    access.membership.farmId,
  );

  return <ProductionReadinessClient initialSnapshot={snapshot} />;
}
