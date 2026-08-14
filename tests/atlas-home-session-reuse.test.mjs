import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const repoRoot = process.cwd();
const read = (filePath) => fs.readFileSync(path.join(repoRoot, filePath), "utf8");

test("Home reuses its authenticated session for operator context", () => {
  const home = read("app/page.tsx");
  assert.match(home, /const session = await getAtlasSession\(\)/);
  assert.match(home, /resolveAtlasOwnerOperatorContextForSession\(session\)/);
  assert.doesNotMatch(home, /readAtlasOwnerOperatorContext\(/);
});
