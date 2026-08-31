"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { FieldLogDrawer, type AtlasFieldLogSeed } from "@/components/atlas/field-log-builder";
import AtlasDock, { type AtlasDockItem } from "@/components/atlas/shell/AtlasDock";
import { AtlasTopBar } from "@/components/atlas/ui/AtlasPrimitives";
import { atlasFarmDateIso } from "@/lib/atlas/farm-day";
import type { AtlasFarmRole } from "@/lib/atlas/session";
import { fetchAtlasZoneRegistry, type AtlasRegistryZone } from "@/lib/atlas/zone-registry-client";

type AtlasContextualAppFrameProps = {
  effectiveFarmRole?: AtlasFarmRole | null;
  activeFarmName?: string | null;
};

function todayHref() {
  return "/day";
}

function clockHref() {
  return `/clock?date=${encodeURIComponent(atlasFarmDateIso())}`;
}

function managerHref() {
  return `/manage/day?date=${encodeURIComponent(atlasFarmDateIso())}`;
}

function isPrincipalProjection(pathname: string) {
  return pathname === "/principal" || pathname.startsWith("/principal/");
}

function routeGroup(pathname: string) {
  if (pathname === "/" || isPrincipalProjection(pathname)) return "home";
  if (pathname.startsWith("/clock")) return "clock";
  if (pathname.startsWith("/manage/day")) return "manager";
  if (
    pathname.startsWith("/day")
    || pathname.startsWith("/overview")
    || pathname.startsWith("/work")
    || pathname.startsWith("/task")
    || pathname.startsWith("/mow-preview")
    || pathname.startsWith("/paid-schedule")
  ) return "work";
  if (pathname.startsWith("/harvest")) return "harvest";
  return "more";
}

function routeLabel(group: ReturnType<typeof routeGroup>) {
  if (group === "home") return "Home";
  if (group === "clock") return "Clock";
  if (group === "manager") return "Manager";
  if (group === "harvest") return "Harvest";
  if (group === "work") return "Work";
  return "More";
}

function safeInternalReturnTo(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}

// These routes happen before a person has entered an operational Atlas context. They
// must not inherit a farm/company toolbar merely because the setup human already has
// another Atlas relationship. In particular, Organization Atlas setup is not Elm work.
const HIDDEN_PATHS = ["/login", "/auth", "/offline", "/welcome", "/start", "/join", "/onboarding"];
const DAY_TASK_ID = /^day-task-([0-9a-f-]{36})$/i;

export default function AtlasContextualAppFrame({ effectiveFarmRole = null, activeFarmName = null }: AtlasContextualAppFrameProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const principalProjection = isPrincipalProjection(pathname);
  const active = routeGroup(pathname);
  const workHref = useMemo(todayHref, []);
  const currentClockHref = useMemo(clockHref, []);
  const farmManagerHref = useMemo(managerHref, []);
  const rewrittenPublicRoot = pathname === "/" && !effectiveFarmRole && !activeFarmName;
  const hidden = rewrittenPublicRoot
    || pathname === "/local"
    || pathname.startsWith("/local/")
    || HIDDEN_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
  const canManage = effectiveFarmRole === "owner" || effectiveFarmRole === "manager";
  const canDocument = Boolean(effectiveFarmRole);
  const requestedReturnTo = searchParams.get("returnTo");
  const exitHref = useMemo(() => {
    const safeReturnTo = safeInternalReturnTo(requestedReturnTo);
    if (pathname.startsWith("/task")) return safeReturnTo ?? workHref;
    if (pathname.startsWith("/harvest/") && pathname !== "/harvest") return "/harvest";
    if (principalProjection) return "/principal";
    if (pathname === "/more") return "/";
    if (active === "more") return "/more";
    return "/";
  }, [active, pathname, principalProjection, requestedReturnTo, workHref]);
  const [registryZones, setRegistryZones] = useState<AtlasRegistryZone[]>([]);
  const [logSeed, setLogSeed] = useState<AtlasFieldLogSeed | null>(null);
  const [weatherLabel, setWeatherLabel] = useState<string | null>(null);

  useEffect(() => {
    document.body.dataset.atlasRouteGroup = active;
    document.body.dataset.atlasProjection = principalProjection ? "principal" : "operational";
    return () => {
      delete document.body.dataset.atlasRouteGroup;
      delete document.body.dataset.atlasProjection;
    };
  }, [active, principalProjection]);

  useEffect(() => {
    if (hidden) return;
    let cancelled = false;
    void fetch("/api/atlas/weather", { headers: { Accept: "application/json" }, cache: "no-store" })
      .then((response) => response.json())
      .then((data: { ok?: boolean; label?: string }) => {
        if (!cancelled) setWeatherLabel(data.ok && data.label ? data.label : null);
      })
      .catch(() => {
        if (!cancelled) setWeatherLabel(null);
      });
    return () => { cancelled = true; };
  }, [hidden]);

  useEffect(() => {
    if (!pathname.startsWith("/day")) return;

    const openTaskFromDay = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const summary = target?.closest("details.atlas-day-task-card > summary");
      if (!summary) return;

      const anchor = summary.closest("[id^='day-task-']") ?? summary.parentElement?.closest("[id^='day-task-']");
      const match = anchor?.id.match(DAY_TASK_ID);
      if (!match) return;

      event.preventDefault();
      event.stopPropagation();
      const returnTo = `${window.location.pathname}${window.location.search}`;
      window.location.assign(`/task-focus/${encodeURIComponent(match[1])}?returnTo=${encodeURIComponent(returnTo)}`);
    };

    document.addEventListener("click", openTaskFromDay, true);
    return () => document.removeEventListener("click", openTaskFromDay, true);
  }, [pathname]);

  if (hidden) return null;

  async function openFieldLog() {
    if (!canDocument) return;
    if (registryZones.length === 0) {
      try {
        const response = await fetchAtlasZoneRegistry();
        setRegistryZones(response.zones ?? []);
      } catch {
        setRegistryZones([]);
      }
    }
    setLogSeed({ workKey: "note", zoneKeys: [], objectKeys: [] });
  }

  const items: AtlasDockItem[] = principalProjection
    ? [
        { key: "home", label: "Home", href: "/principal" },
        { key: "work", label: "Farm Ops", href: "/overview/week" },
        { key: "more", label: "More", href: "/more" },
      ]
    : [
        { key: "home", label: "Home", href: "/" },
        { key: "work", label: "Work", href: workHref },
        { key: "clock", label: "Clock", href: currentClockHref },
        ...(canManage ? [{ key: "manager" as const, label: "Manager", href: farmManagerHref }] : []),
        { key: "harvest", label: "Harvest", href: "/harvest" },
        { key: "more", label: "More", href: "/more" },
      ];

  const headerAction = active === "home"
    ? canDocument
      ? <button type="button" className="atlas-global-note-plus" aria-label="Document work" onClick={() => void openFieldLog()}>+</button>
      : null
    : <Link href={exitHref} className="atlas-global-note-plus atlas-global-exit" aria-label={`Exit ${routeLabel(active)}`}>×</Link>;

  // Legacy route marker retained for contract search: "/#work-board".
  return (
    <>
      <AtlasTopBar
        className="atlas-global-header"
        title={activeFarmName || "Atlas"}
        status={<span>{weatherLabel || routeLabel(active)}</span>}
        action={headerAction}
      />
      <AtlasDock items={items} active={active} />
      {logSeed ? (
        <FieldLogDrawer
          open
          zones={registryZones}
          seed={logSeed}
          onClose={() => setLogSeed(null)}
          onSaved={() => setLogSeed(null)}
        />
      ) : null}
    </>
  );
}
