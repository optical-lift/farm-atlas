"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import type { AtlasBell } from "@/lib/atlas/bell-contract";
import { fetchAtlasBell } from "@/lib/atlas/bell-client";
import { setAtlasAppBadge } from "@/lib/atlas/pwa-client";

function countLabel(value: number) {
  return value > 99 ? "99+" : String(value);
}

function visibleHeaderBottom() {
  const headers = Array.from(document.querySelectorAll<HTMLElement>(".atlas-phone-top, .atlas-topbar, .atlas-dashboard-top"));
  const visible = headers.find((header) => {
    const rect = header.getBoundingClientRect();
    return rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight;
  });
  if (visible) return Math.max(8, visible.getBoundingClientRect().bottom + 7);
  const operator = document.querySelector<HTMLElement>(".atlas-owner-operator");
  return Math.max(8, (operator?.getBoundingClientRect().bottom ?? 0) + 7);
}

export default function AtlasBellCover() {
  const pathname = usePathname();
  const [bell, setBell] = useState<AtlasBell | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [top, setTop] = useState(74);

  useEffect(() => {
    let active = true;
    void fetchAtlasBell(10)
      .then((result) => {
        if (!active) return;
        setBell(result);
        setExpanded(result.badgeCount > 0 && result.whileAwayCount > 0);
        void setAtlasAppBadge(result.badgeCount);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [pathname]);

  useEffect(() => {
    function place() {
      setTop(visibleHeaderBottom());
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, { passive: true });
    const timer = window.setTimeout(() => setExpanded(false), 5200);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place);
      window.clearTimeout(timer);
    };
  }, [pathname, bell?.preparedAt]);

  const newest = useMemo(
    () => bell?.items.find((item) => item.whileAway && item.requiresAction && !item.baseline)
      ?? bell?.items.find((item) => item.requiresAction && !item.baseline)
      ?? null,
    [bell],
  );

  if (!bell || bell.badgeCount <= 0) return null;
  if (pathname === "/bell" || pathname.startsWith("/bell/") || pathname === "/login" || pathname.startsWith("/auth/")) return null;

  return (
    <aside
      className="atlas-bell-cover"
      aria-label="Atlas Bell"
      data-expanded={expanded ? "true" : "false"}
      style={{ top }}
    >
      <Link href="/bell?view=needs" className="atlas-bell-edge-tab" aria-label={`Open Bell. ${bell.badgeCount} current obligations need attention.`}>
        <span aria-hidden="true">⌁</span>
        <strong>Bell</strong>
        <b>{countLabel(bell.badgeCount)}</b>
      </Link>

      {expanded && bell.whileAwayCount > 0 ? (
        <Link href="/bell?view=needs" className="atlas-while-away-slip">
          <span>While you were away</span>
          <strong>{bell.whileAwayCount} {bell.whileAwayCount === 1 ? "thing needs" : "things need"} you</strong>
          {newest ? <em>{newest.symbol} {newest.title}</em> : null}
        </Link>
      ) : null}
    </aside>
  );
}
