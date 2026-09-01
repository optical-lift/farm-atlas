import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Atlas model runtime prefers direct providers and keeps Vercel Gateway opt-in", () => {
  const runtime = read("lib/atlas/model-runtime.ts");

  assert.match(runtime, /ATLAS_MODEL_PROVIDER/);
  assert.match(runtime, /OPENAI_API_KEY/);
  assert.match(runtime, /ATLAS_MODEL_BASE_URL/);
  assert.match(runtime, /ATLAS_MODEL_API_KEY/);
  assert.match(runtime, /https:\/\/api\.openai\.com\/v1\/responses/);
  assert.match(runtime, /openai_compatible/);
  assert.match(runtime, /vercel_gateway/);
  assert.match(runtime, /Vercel Gateway is deliberately[\s\S]*opt-in/);
  assert.match(runtime, /text:\s*\{\s*format:\s*\{\s*type: "json_schema"/);
  assert.match(runtime, /store: false/);

  const providerSelection = runtime.slice(
    runtime.indexOf("const provider = explicit"),
    runtime.indexOf("if (!provider)"),
  );
  assert.match(providerSelection, /OPENAI_API_KEY/);
  assert.match(providerSelection, /ATLAS_MODEL_BASE_URL/);
  assert.doesNotMatch(providerSelection, /gatewayToken/);
});

test("legacy AI Gateway helper is only a compatibility shim over the provider-independent runtime", () => {
  const legacy = read("lib/atlas/ai-gateway.ts");

  assert.match(legacy, /callAtlasStructured/);
  assert.match(legacy, /Backward-compatible shim/);
  assert.doesNotMatch(legacy, /ai-gateway\.vercel\.sh/);
  assert.doesNotMatch(legacy, /AI_GATEWAY_API_KEY/);
  assert.doesNotMatch(legacy, /VERCEL_OIDC_TOKEN/);
});
