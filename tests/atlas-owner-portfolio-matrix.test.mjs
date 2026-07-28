import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("organization owners receive one farm-by-project matrix inside the universal home", () => {
  const home = read("components/atlas/home/AtlasUniversalHome.tsx");
  const matrix = read("components/atlas/home/AtlasPortfolioMatrix.tsx");

  assert.match(home, /AtlasPortfolioMatrix/);
  assert.match(home, /organizationHome\?\.viewer\.isOwner/);
  assert.match(home, /showOwnerPortfolio \? <AtlasPortfolioMatrix home=\{home\}/);
  assert.match(home, /href="#portfolio-matrix"/);
  assert.match(home, /!singleVisibleFarm && !showOwnerPortfolio/);

  assert.match(matrix, /Portfolio Matrix/);
  assert.match(matrix, /Farm × project/);
  assert.match(matrix, /projectTouchesRow/);
  assert.match(matrix, /project\.farmId === farmId/);
  assert.match(matrix, /project\.targets\.some/);
  assert.match(matrix, /Cross-farm and Guild work/);
});

test("matrix cells stay projections over existing projects tasks Trails and attention", () => {
  const matrix = read("components/atlas/home/AtlasPortfolioMatrix.tsx");

  assert.match(matrix, /project\.trail\?\.currentMove/);
  assert.match(matrix, /project\.trail\?\.nextNode/);
  assert.match(matrix, /home\.projectTasks/);
  assert.match(matrix, /home\.attention/);
  assert.match(matrix, /No task released for this Trail point/);
  assert.match(matrix, /\/task-focus\/\$\{encodeURIComponent\(task\.taskId\)\}/);
  assert.match(matrix, /\/project\/\$\{encodeURIComponent\(project\.projectId\)\}/);

  assert.doesNotMatch(matrix, /postAtlasTaskTransition/);
  assert.doesNotMatch(matrix, /method:\s*["']POST["']/);
  assert.doesNotMatch(matrix, /supabase/);
  assert.doesNotMatch(matrix, /button[^>]*>\s*Done/);
});

test("the owner attention strip identifies real exceptions without creating work", () => {
  const matrix = read("components/atlas/home/AtlasPortfolioMatrix.tsx");

  assert.match(matrix, /Decisions and exceptions/);
  assert.match(matrix, /kind: "missing_task"/);
  assert.match(matrix, /kind: "overdue"/);
  assert.match(matrix, /kind: "review"/);
  assert.match(matrix, /kind: "blocked"/);
  assert.match(matrix, /project\.health !== "complete" && !project\.trail\.currentMove && !task/);
  assert.match(matrix, /task\.dueDate < today/);
  assert.match(matrix, /No project decision, blocker, overdue move, or missing released task needs attention/);
});

test("the matrix is mobile-scrollable and drills down through normal Atlas routes", () => {
  const matrix = read("components/atlas/home/AtlasPortfolioMatrix.tsx");
  const css = read("components/atlas/home/portfolio-matrix.module.css");

  assert.match(matrix, /tabIndex=\{0\}/);
  assert.match(matrix, /Current task/);
  assert.match(matrix, />Project<\/Link>/);
  assert.match(css, /overflow-x:\s*auto/);
  assert.match(css, /position:\s*sticky/);
  assert.match(css, /scroll-snap-type:\s*x proximity/);
  assert.match(css, /@media \(max-width: 430px\)/);
});
