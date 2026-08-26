function localPath(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function safeAtlasTaskReturnPath(value) {
  const path = localPath(value);
  if (!path || !path.startsWith("/") || path.startsWith("//")) return null;
  if (path === "/task-focus" || path.startsWith("/task-focus/")) return null;
  return path;
}

export function atlasTaskCloseDecision({ search = "", referrer = "", origin = "", fallbackPath = "/" } = {}) {
  const fallback = safeAtlasTaskReturnPath(fallbackPath) || "/";
  const params = new URLSearchParams(search);

  if (params.has("returnTo")) {
    const requested = safeAtlasTaskReturnPath(params.get("returnTo"));
    return requested
      ? { kind: "return_to", destination: requested }
      : { kind: "fallback", destination: fallback };
  }

  if (referrer && origin) {
    try {
      const previous = new URL(referrer);
      const previousPath = safeAtlasTaskReturnPath(`${previous.pathname}${previous.search}${previous.hash}`);
      if (previous.origin === origin && previousPath) return { kind: "history", destination: null };
    } catch {
      // A malformed referrer is not a trustworthy history target.
    }
  }

  return { kind: "fallback", destination: fallback };
}
