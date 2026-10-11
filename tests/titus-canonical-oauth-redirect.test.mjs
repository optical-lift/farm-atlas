import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source=readFileSync(new URL("../lib/atlas/titus-oauth-consent.ts",import.meta.url),"utf8");
const compiled=ts.transpileModule(source,{compilerOptions:{
 module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022
}});
const env={ATLAS_TITUS_OAUTH_CLIENT_ID:"11111111-2222-4333-8444-555555555555",
 ATLAS_TITUS_OAUTH_REDIRECT_URI:"https://titus.opticallift.com/auth/callback",
 ATLAS_OAUTH_CONSENT_ORIGIN:"https://atlas.example.invalid"};
const exposed={exports:{}};
new Function("module","exports","require","process","URL",compiled.outputText)(
 exposed,exposed.exports,(name)=>{assert.equal(name,"server-only");}, {env},URL
);
const {titusOAuthConsentConfig,approvedOAuthDetails,approvedOAuthReturn,TITUS_PUBLIC_REDIRECT_URI}=exposed.exports;

test("Titus principal-approved callback is absolute and immutable",()=>{
 assert.equal(TITUS_PUBLIC_REDIRECT_URI,"https://titus.opticallift.com/auth/callback");
 const configured=titusOAuthConsentConfig();
 assert.equal(configured.callback,TITUS_PUBLIC_REDIRECT_URI);
 assert.equal(configured.origin,"https://atlas.example.invalid");
 assert.equal(configured.clientId,env.ATLAS_TITUS_OAUTH_CLIENT_ID);
});
test("Legacy host, arbitrary preview and mutated callbacks fail closed",()=>{
 for(const uri of [
   "https://titus.elmfarm.co/auth/callback",
   "https://titus-git-preview.vercel.app/auth/callback",
   "https://titus.opticallift.com/constellation/auth/callback",
   "https://titus.opticallift.com/auth/callback?next=/formation",
   "http://titus.opticallift.com/auth/callback",
   "https://titus.opticallift.com:444/auth/callback",
 ]){
   env.ATLAS_TITUS_OAUTH_REDIRECT_URI=uri;
   assert.equal(titusOAuthConsentConfig(),null,"Rejected "+uri);
 }
 env.ATLAS_TITUS_OAUTH_REDIRECT_URI=TITUS_PUBLIC_REDIRECT_URI;
 assert.equal(titusOAuthConsentConfig()?.callback,TITUS_PUBLIC_REDIRECT_URI);
});
test("Consent matches the correct client and canonical redirect",()=>{
 const config=titusOAuthConsentConfig();
 assert.equal(approvedOAuthDetails({redirect_uri:TITUS_PUBLIC_REDIRECT_URI,client:{id:config.clientId}},config),true);
 assert.equal(approvedOAuthDetails({redirect_uri:"https://titus.elmfarm.co/auth/callback",client:{id:config.clientId}},config),false);
 assert.equal(approvedOAuthDetails({redirect_uri:TITUS_PUBLIC_REDIRECT_URI,client:{id:"00000000-0000-0000-0000-000000000000"}},config),false);
 assert.equal(approvedOAuthReturn(TITUS_PUBLIC_REDIRECT_URI+"?code=sample&state=example",config),true);
 assert.equal(approvedOAuthReturn("https://titus.elmfarm.co/auth/callback?code=sample",config),false);
});
