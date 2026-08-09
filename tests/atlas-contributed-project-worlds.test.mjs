import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Projects reads contributed worlds through portfolio scope even in a farm-hand operator portal", () => {
  const projectsPage = read("app/projects/page.tsx");
  const portfolioReader = read("lib/atlas/portfolio.ts");

  assert.match(projectsPage, /readAtlasPortfolioHome/);
  assert.match(projectsPage, /viewer\.activeOrganizationId/);
  assert.match(projectsPage, /viewer\.organizationMemberships\[0\]\?\.organizationId/);
  assert.doesNotMatch(projectsPage, /readAtlasOperatorUniversalHome/);
  assert.match(portfolioReader, /owner_operator_organization_home_v1/);
  assert.match(portfolioReader, /portfolio_home_v1/);
});
