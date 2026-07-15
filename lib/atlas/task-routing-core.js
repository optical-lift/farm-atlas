export const ATLAS_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function isValidAtlasTaskId(taskId) {
  return ATLAS_UUID_PATTERN.test(text(taskId));
}

export function classifyAtlasTaskWorkflow(task) {
  const metadata = task?.metadata ?? {};
  if (task?.task_type === "production_sowing" && text(metadata.production_succession_id)) return "production_sowing";
  if (task?.task_type === "germination_check" || text(metadata.task_style) === "germination_check" || text(metadata.milestone) === "germination_check") return "germination";
  return "generic";
}

export function legacyTaskRedirectCore(inputUrl, referrer = null) {
  const url = inputUrl instanceof URL ? inputUrl : new URL(inputUrl);
  if (url.pathname !== "/task") return null;

  if (url.searchParams.has("date")) {
    const destination = new URL("/day", url);
    destination.searchParams.set("date", url.searchParams.get("date") ?? "");
    return destination;
  }

  const taskId = url.searchParams.get("taskId");
  if (taskId) {
    const destination = new URL(`/task-focus/${encodeURIComponent(taskId)}`, url);
    for (const [key, value] of url.searchParams.entries()) {
      if (key !== "taskId" && key !== "direct") destination.searchParams.append(key, value);
    }
    if (!destination.searchParams.has("returnTo") && referrer) {
      try {
        const referrerUrl = new URL(referrer);
        if (referrerUrl.origin === url.origin) destination.searchParams.set("returnTo", `${referrerUrl.pathname}${referrerUrl.search}${referrerUrl.hash}`);
      } catch {
        // Ignore malformed referrers.
      }
    }
    return destination;
  }

  if (!url.searchParams.has("route") && !url.searchParams.has("lane")) return new URL("/", url);
  return null;
}
