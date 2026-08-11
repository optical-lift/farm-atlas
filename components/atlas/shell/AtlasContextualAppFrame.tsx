"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo } from "react";

import GlobalAtlasAdd from "@/components/atlas/global-atlas-add";
import { atlasFarmDateIso } from "@/lib/atlas/farm-day";
import type { AtlasFarmRole } from "@/lib/atlas/session";

type DockIconKey = "home" | "work" | "manager" | "harvest" | "more";

type AtlasContextualAppFrameProps = {
  effectiveFarmRole?: AtlasFarmRole | null;
};

function todayHref() {
  return `/day?date=${encodeURIComponent(atlasFarmDateIso())}`;
}

function managerHref() {
  return `/manage/day?date=${encodeURIComponent(atlasFarmDateIso())}`;
}

function routeGroup(pathname: string) {
  if (pathname === "/") return "home";
  if (pathname.startsWith("/manage/day")) return "manager";
  if (
    pathname.startsWith("/day")
    || pathname.startsWith("/overview")
    || pathname.startsWith("/work")
    || pathname.startsWith("/task")
    || pathname.startsWith("/paid-schedule")
  ) return "work";
  if (pathname.startsWith("/harvest")) return "harvest";
  return "more";
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

export default function AtlasContextualAppFrame({ effectiveFarmRole = null }: AtlasContextualAppFrameProps) {
  const pathname = usePathname();
  const active = routeGroup(pathname);
  const workHref = useMemo(todayHref, []);
  const farmManagerHref = useMemo(managerHref, []);
  const hidden = HIDDEN_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
  const canManage = effectiveFarmRole === "owner" || effectiveFarmRole === "manager";

  useEffect(() => {
    document.body.dataset.atlasRouteGroup = active;
    return () => {
      delete document.body.dataset.atlasRouteGroup;
    };
  }, [active]);

  if (hidden) return null;

  const items: Array<{ key: DockIconKey; label: string; href: string }> = [
    { key: "home", label: "Home", href: "/" },
    { key: "work", label: "Work", href: workHref },
    ...(canManage ? [{ key: "manager" as const, label: "Manager", href: farmManagerHref }] : []),
    { key: "harvest", label: "Harvest", href: "/harvest" },
    { key: "more", label: "More", href: "/more" },
  ];

  // Legacy route marker retained for contract search: "/#work-board".
  return (
    <>
      <GlobalAtlasAdd />
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
    </>
  );
}
