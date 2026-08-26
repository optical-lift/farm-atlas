"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { FieldLogDrawer, type AtlasFieldLogSeed } from "@/components/atlas/field-log-builder";
import { AtlasTopBar } from "@/components/atlas/ui/AtlasPrimitives";
import { atlasFarmDateIso } from "@/lib/atlas/farm-day";
import type { AtlasFarmRole } from "@/lib/atlas/session";
import { fetchAtlasZoneRegistry, type AtlasRegistryZone } from "@/lib/atlas/zone-registry-client";

type DockIconKey = "home" | "work" | "clock" | "manager" | "harvest" | "more";

type AtlasContextualAppFrameProps = {
  effectiveFarmRole?: AtlasFarmRole | null;
  activeFarmName?: string | null;
};

function todayHref() {
  return `/day?date=${encodeURIComponent(atlasFarmDateIso())}`;
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

function DockIcon({ kind }: { kind: DockIconKey }) {
  const common = {
    viewBox: "0 0 24 24",
    width: 22,
    height: 22,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    focusable: false,
  };

  if (kind === "home") {
    return (
      <svg {...common} aria-hidden="true">
        <path d="M3.75 10.25 12 3.75l8.25 6.5" />
        <path d="M5.5 9.5v10h13v-10" />
        <path d="M9.25 19.5v-5.75h5.5v5.75" />
      </svg>
    );
  }

  if (kind === "work") {
    return (
      <svg {...common} aria-hidden="true">
        <rect x="4.5" y="3.5" width="15" height="17" rx="3" />
        <path d="m8.25 12.25 2.35 2.35 5.25-5.35" />
      </svg>
    );
  }

  if (kind === "clock") {
    return (
      <svg {...common} aria-hidden="true">
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7.25v5.25l3.5 2" />
      </svg>
    );
  }

  if (kind === "manager") {
    return (
      <svg {...common} aria-hidden="true">
        <circle cx="12" cy="6.25" r="2.25" />
        <circle cx="5.75" cy="15.75" r="1.75" />
        <circle cx="18.25" cy="15.75" r="1.75" />
        <path d="M12 8.5v3.25M5.75 14v-2.25h12.5V14" />
        <path d="M9 20v-1.1c0-1.55 1.35-2.8 3-2.8s3 1.25 3 2.8V20" />
      </svg>
    );
  }

  if (kind === "harvest") {
    return (
      <svg {...common} aria-hidden="true">
        <circle cx="7.25" cy="17.1" r="2.35" />
        <circle cx="16.75" cy="17.1" r="2.35" />
        <path d="m8.75 15.25 7.6-10.25" />
        <path d="m15.25 15.25-7.6-10.25" />
        <path d="m9.2 8.05 5.7 3.95" />
      </svg>
    );
  }

  return (
    <svg {...common} aria-hidden="true">
      <circle cx="5.5" cy="12" r="1.35" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.35" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="12" r="1.35" fill="currentColor" stroke="none" />
    </svg>
  );
}

const HIDDEN_PATHS = ["/login", "/auth", "/offline"];
const DAY_TASK_ID = /^day-task-([0-9a-f-]{36})$/i;

export default function AtlasContextualAppFrame({ effectiveFarmRole = null, activeFarmName = null }: AtlasContextualAppFrameProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const principalProjection = isPrincipalProjection(pathname);
  const active = routeGroup(pathname);
  const workHref = useMemo(todayHref, []);
  const currentClockHref = useMemo(clockHref, []);
  const farmManagerHref = useMemo(managerHref, []);
  const hidden = HIDDEN_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
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

  const items: Array<{ key: DockIconKey; label: string; href: string }> = principalProjection
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
      <nav className="atlas-context-footer" aria-label="Atlas destinations">
        <div
          className="atlas-context-footer__rail"
          style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
        >
          {items.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className="atlas-context-footer__item"
              aria-current={active === item.key ? "page" : undefined}
            >
              <span className="atlas-context-footer__icon" aria-hidden="true"><DockIcon kind={item.key} /></span>
              <strong>{item.label}</strong>
            </Link>
          ))}
        </div>
      </nav>
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
