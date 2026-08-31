import { humanSignupEnabled } from "@/lib/atlas/account-bootstrap-core.js";
import LoginClient from "./LoginClient";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return <LoginClient signupEnabled={humanSignupEnabled(process.env.ATLAS_HUMAN_SIGNUP_ENABLED)} />;
}
