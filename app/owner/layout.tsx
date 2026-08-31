import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Nothing_You_Could_Do, Source_Sans_3 } from "next/font/google";

import { getAtlasSession } from "@/lib/atlas/session";
import "./ask-atlas.css";
import "./person-atlas-notebook-v2-refine.css";

export const dynamic = "force-dynamic";

const atlasStructural = Source_Sans_3({
  subsets: ["latin"],
  variable: "--font-atlas-structural",
});

const atlasHand = Nothing_You_Could_Do({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-atlas-hand",
});

export default async function OwnerLayout({ children }: { children: ReactNode }) {
  const session = await getAtlasSession();
  if (!session) redirect("/login");

  // Transitional custody for the person-owned Atlas experiment:
  // the historical /owner tree was farm-owner scoped, while the current Principal
  // account is represented as an organization owner. Either ownership relationship
  // may enter this fixture-only design tree until the neutral person-level route exists.
  const ownsFarm = session.memberships.some((membership) => membership.role === "owner");
  const ownsOrganization = session.organizationMemberships.some((membership) => membership.role === "owner");
  if (!ownsFarm && !ownsOrganization) redirect("/");

  return <div className={`${atlasStructural.variable} ${atlasHand.variable}`}>{children}</div>;
}
