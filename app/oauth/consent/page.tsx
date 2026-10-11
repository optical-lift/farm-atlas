import { redirect } from "next/navigation";
import { createAtlasServerClient } from "@/lib/supabase/server";
import { approvedOAuthDetails, approvedOAuthReturn, titusOAuthConsentConfig } from "@/lib/atlas/titus-oauth-consent";

export const dynamic = "force-dynamic";
export const metadata = { title: "Authorize Titus | Atlas", robots: { index: false, follow: false } };

export default async function AtlasTitusConsent({ searchParams }: {
  searchParams: Promise<{ authorization_id?: string }>;
}) {
  const config = titusOAuthConsentConfig();
  const { authorization_id: id } = await searchParams;
  if (!config || !id || !/^[\w-]{12,160}$/.test(id)) {
    return <main><h1>Atlas authorization is not configured.</h1><p>Private Titus access remains closed.</p></main>;
  }
  const supabase = await createAtlasServerClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) redirect("/login?next="+encodeURIComponent("/oauth/consent?authorization_id="+encodeURIComponent(id)));
  const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(id);
  if (error || !data) return <main><h1>This authorization request is no longer valid.</h1></main>;

  // A previously approved code may be returned directly; never follow unapproved origins.
  if (!("authorization_id" in data)) {
    if (approvedOAuthReturn(data.redirect_url,config)) redirect(data.redirect_url);
    return <main><h1>Atlas rejected the authorization destination.</h1></main>;
  }
  if (!approvedOAuthDetails(data,config)) return <main><h1>Unrecognized application authorization.</h1></main>;
  return <main style={{maxWidth:560,margin:"6rem auto",padding:"2rem",fontFamily:"system-ui"}}>
    <p>ATLAS / ACCOUNT AUTHORIZATION</p>
    <h1>Connect to Titus</h1>
    <p>You are signed in to Atlas. Titus is requesting identity-only authentication.</p>
    <p>Consenting does <strong>not</strong> grant access to private Song/Noel research. Titus will check your canonical Person binding and separate research-viewing permission.</p>
    <p>Application: {data.client.name}</p>
    <p>Destination: {data.redirect_uri}</p>
    <p>Requested scopes: {data.scope ?? "default"}</p>
    <form action="/api/oauth/decision" method="post" style={{display:"flex",gap:12}}>
      <input type="hidden" name="authorization_id" value={id} />
      <button type="submit" name="decision" value="approve">Allow identity connection</button>
      <button type="submit" name="decision" value="deny">Decline</button>
    </form>
  </main>;
}
