import { humanSignupEnabled } from "@/lib/atlas/account-bootstrap-core.js";
import LoginClient from "./LoginClient";

export const dynamic = "force-dynamic";

type LoginSearchParams = { next?: string | string[] };

function safeNextPath(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//")) return null;
  return candidate;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<LoginSearchParams>;
}) {
  const params = searchParams ? await searchParams : {};
  return (
    <LoginClient
      signupEnabled={humanSignupEnabled(process.env.ATLAS_HUMAN_SIGNUP_ENABLED)}
      nextPath={safeNextPath(params.next)}
    />
  );
}
