import { NextRequest, NextResponse } from "next/server";
import { createAtlasServerClient } from "@/lib/supabase/server";
import { approvedOAuthDetails, approvedOAuthReturn, titusOAuthConsentConfig } from "@/lib/atlas/titus-oauth-consent";

export const runtime = "nodejs";
const failed = (message:string,status=400) => NextResponse.json({error:message},{status,headers:{"Cache-Control":"no-store"}});
export async function POST(request: NextRequest) {
  const config=titusOAuthConsentConfig();
  // Origin check prevents cross-site form posts, and no unconfigured issuer is ever enabled.
  if(!config || request.nextUrl.origin!==config.origin ||
     request.headers.get("origin")!==config.origin) return failed("Atlas authorization unavailable.",403);
  const fields=await request.formData().catch(()=>null);
  const id=fields?.get("authorization_id");
  const decision=fields?.get("decision");
  if(typeof id!=="string" || !/^[\w-]{12,160}$/.test(id) ||
     (decision!=="approve" && decision!=="deny")) return failed("Invalid decision.");
  const supabase=await createAtlasServerClient();
  const { data:{user},error:userError }=await supabase.auth.getUser();
  if(userError||!user) return failed("Atlas login required.",401);
  const {data:details,error}=await supabase.auth.oauth.getAuthorizationDetails(id);
  if(error||!details || !("authorization_id" in details) || !approvedOAuthDetails(details,config))
    return failed("Unrecognized or expired authorization.",403);
  const response=decision==="approve"
    ? await supabase.auth.oauth.approveAuthorization(id)
    : await supabase.auth.oauth.denyAuthorization(id);
  if(response.error || !response.data?.redirect_url ||
     !approvedOAuthReturn(response.data.redirect_url,config))
    return failed("Atlas cannot complete this authorization.",403);
  const next=NextResponse.redirect(response.data.redirect_url,303);
  next.headers.set("Cache-Control","no-store");
  next.headers.set("Referrer-Policy","no-referrer");
  return next;
}
