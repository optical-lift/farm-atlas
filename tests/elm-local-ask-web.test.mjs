import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const files = {
  route: "app/api/local/ask-v2/route.ts",
  component: "app/local/ask-elm.tsx",
  page: "app/local/page.tsx",
  layout: "app/local/layout.tsx",
  proxy: "lib/supabase/proxy.ts",
};

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Ask Elm keeps interpretation separate from governed local truth", async () => {
  const route = await source(files.route);

  assert.match(route, /The AI interprets; the database knows/i);
  assert.match(route, /elm_local_search_answers_v1/);
  assert.match(route, /loadEvents\(120\)/);
  assert.match(route, /availability_freshness/);
  assert.match(route, /does not have fresh availability confirmation/i);
  assert.match(route, /openai\/gpt-5\.6-sol/);
  assert.match(route, /x-vercel-oidc-token/);
  assert.match(route, /AI_GATEWAY_API_KEY/);
  assert.doesNotMatch(route, /db:\s*\{\s*schema:\s*["']local_intel["']/);
});

test("Ask Elm has a deterministic database fallback without hardcoding the screenshot query", async () => {
  const route = await source(files.route);

  assert.match(route, /join\(" OR "\)/);
  assert.match(route, /Direct database matching|fallbackSearchQuery|fallbackIntent/);
  assert.doesNotMatch(route, /Absolute Screen Printing/);
  assert.doesNotMatch(route, /Webster County Printing/);
});

test("Ask Elm is a public website question surface, not an SMS transport", async () => {
  const route = await source(files.route);
  const component = await source(files.component);
  const page = await source(files.page);
  const layout = await source(files.layout);
  const proxy = await source(files.proxy);

  assert.match(component, /fetch\("\/api\/local\/ask-v2"/);
  assert.match(component, /Ask Elm/);
  assert.match(component, /governed local records/i);
  assert.match(page, /import AskElm from "\.\/ask-elm"/);
  assert.match(page, /What are you looking for\?/);
  assert.match(layout, /import "\.\/ask\.css"/);
  assert.match(layout, /what’s happening and available nearby/i);
  assert.match(proxy, /pathname\.startsWith\("\/api\/local\/"\)/);
  assert.doesNotMatch([route, component, page].join("\n"), /twilio|sms|text message provider/i);
});
