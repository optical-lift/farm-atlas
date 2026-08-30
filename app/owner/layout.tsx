import type { ReactNode } from "react";
import { Nothing_You_Could_Do, Source_Sans_3 } from "next/font/google";

import { requireAtlasRole } from "@/lib/atlas/role-access";
import "./ask-atlas.css";

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
  await requireAtlasRole(["owner"]);
  return <div className={`${atlasStructural.variable} ${atlasHand.variable}`}>{children}</div>;
}
