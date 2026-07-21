import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

function filesUnder(path, extensions = /\.(?:ts|tsx|js|jsx)$/) {
  const absolute = join(root, path);
  if (!existsSync(absolute)) return [];
  const output = [];
  for (const entry of readdirSync(absolute)) {
    const child = join(absolute, entry);
    if (statSync(child).isDirectory()) output.push(...filesUnder(relative(root, child), extensions));
    else if (extensions.test(entry)) output.push(relative(root, child).split(sep).join("/"));
  }
  return output;
}

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

function endpointForRoute(path) {
  return `/${path}`
    .replace(/^\/app/, "")
    .replace(/\/route\.(?:ts|tsx|js|jsx)$/, "")
    .replace(/\/\[[^/]+\]/g, "");
}

const routeFiles = filesUnder("app/api/atlas").filter((path) => /\/route\.(?:ts|tsx|js|jsx)$/.test(path));
const sourceFiles = [
  ...filesUnder("app"),
  ...filesUnder("components"),
  ...filesUnder("lib"),
].filter((path) => !path.startsWith("app/api/atlas/"));

const offenders = routeFiles
  .filter((path) => /SUPABASE_SERVICE_ROLE_KEY|atlasSupabase/.test(read(path)))
  .map((path) => {
    const source = read(path);
    const endpoint = endpointForRoute(path);
    const methods = Array.from(source.matchAll(/export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)/g), (match) => match[1]);
    const references = sourceFiles.filter((candidate) => read(candidate).includes(endpoint));
    return { path, endpoint, methods, references };
  });

for (const offender of offenders) {
  const refs = offender.references.length ? offender.references.join(",") : "none";
  console.log(`${offender.path}\t${offender.methods.join("+") || "unknown"}\trefs=${refs}`);
}

if (offenders.length) process.exitCode = 1;
