import type { ReactNode } from "react";

import { requireAtlasRole } from "@/lib/atlas/role-access";

export const dynamic = "force-dynamic";

export default async function ManagerLayout({ children }: { children: ReactNode }) {
  await requireAtlasRole(["owner", "manager"]);
  return children;
}
