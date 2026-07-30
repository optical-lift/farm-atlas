"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo } from "react";

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
  if (pathname.startsWith("/zones") || pathname.startsWith("/objects")) return "places";
  if (pathname.startsWith("/project")) return "projects";
  return "more";
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

  const items = [
    { key: "home", label: "Home", icon: "⌂", href: "/" },
    { key: "work", label: "Work", icon: "✓", href: workHref },
    { key: "places", label: "Places", icon: "⌖", href: "/zones" },
    { key: "projects", label: "Projects", icon: "◇", href: "/#work-board" },
    { key: "more", label: "More", icon: "•••", href: "/more" },
  ];

  return (
    <nav className="atlas-context-footer" aria-label="Atlas destinations">
      <div className="atlas-context-footer__rail">
        {items.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            className="atlas-context-footer__item"
            aria-current={active === item.key ? "page" : undefined}
          >
            <span className="atlas-context-footer__icon" aria-hidden="true">{item.icon}</span>
            <strong>{item.label}</strong>
          </Link>
        ))}
      </div>
    </nav>
  );
}
