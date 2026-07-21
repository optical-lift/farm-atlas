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

const routeFiles = filesUnder("app/api/atlas").filter((path) => /\/route\.(?:ts|tsx|js|jsx)$/.test(path));
const serviceRoleRoutes = routeFiles.filter((path) => /SUPABASE_SERVICE_ROLE_KEY|atlasSupabase/.test(read(path)));

if (serviceRoleRoutes.length) {
  console.error("Atlas API routes still using the service-role client:");
  serviceRoleRoutes.forEach((path) => console.error(path));
  process.exitCode = 1;
} else {
  console.log("Atlas API boundary clean: zero service-role routes.");
}

const proxy = read("lib/supabase/proxy.ts");
const membershipBoundary = /needsAtlasFarmMembership/.test(proxy)
  && /farm_memberships/.test(proxy)
  && /farm\.stable_key/.test(proxy)
  && /elm_farm/.test(proxy);

if (!membershipBoundary) {
  console.error("Atlas API proxy is missing the active Elm membership boundary.");
  process.exitCode = 1;
}
