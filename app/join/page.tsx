import { redirect } from "next/navigation";

import { humanSignupEnabled } from "@/lib/atlas/account-bootstrap-core.js";
import { classifyAtlasSession } from "@/lib/atlas/auth-core.js";
import { getAtlasSession } from "@/lib/atlas/session";
import JoinClient from "./JoinClient";

export const dynamic = "force-dynamic";

export default async function JoinPage() {
  if (!humanSignupEnabled(process.env.ATLAS_HUMAN_SIGNUP_ENABLED)) {
    redirect("/login");
  }

  const state = classifyAtlasSession(await getAtlasSession());
  if (state.status === "onboarding") redirect("/onboarding");
  if (state.status === "active") redirect("/");

  return <JoinClient />;
}
