import type { ReactNode } from "react";

import { requireAtlasRole } from "@/lib/atlas/role-access";
import "./ask-atlas.css";

export const dynamic = "force-dynamic";

export default async function OwnerLayout({ children }: { children: ReactNode }) {
  await requireAtlasRole(["owner"]);
  return children;
}
