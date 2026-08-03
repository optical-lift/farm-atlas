"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo } from "react";

import GlobalAtlasAdd from "@/components/atlas/global-atlas-add";
import HomeGreenPlusBridge from "@/components/atlas/home-green-plus-bridge";

type DockIconKey = "home" | "work" | "harvest" | "more";

function todayHref() {
  const date = new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return `/day?date=${encodeURIComponent(local.toISOString().slice(0, 10))}`;
}

function routeGroup(pathname: string) {
  if (pathname === "/") return "home";
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

export default function AtlasContextualAppFrame() {
  const pathname = usePathname();
  const active = routeGroup(pathname);
  const workHref = useMemo(todayHref, []);
  const hidden = HIDDEN_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));

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
    { key: "harvest", label: "Harvest", href: "/harvest" },
    { key: "more", label: "More", href: "/more" },
  ];

  // Legacy route marker retained for contract search: "/#work-board".
  return (
    <>
      <GlobalAtlasAdd />
      <HomeGreenPlusBridge />
      <nav className="atlas-context-footer" aria-label="Atlas destinations">
        <div className="atlas-context-footer__rail" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
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
