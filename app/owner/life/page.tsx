import { redirect } from "next/navigation";

import { getAtlasSession } from "@/lib/atlas/session";
import PersonLifeCaptureClient from "./PersonLifeCaptureClient";

export const dynamic = "force-dynamic";

export default async function AtlasPersonLifePage() {
  const session = await getAtlasSession();
  if (!session) redirect("/login");

  return <PersonLifeCaptureClient personName={session.displayName?.trim() || "Atlas"} />;
}
