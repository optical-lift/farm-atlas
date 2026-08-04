"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import type { AtlasBell } from "@/lib/atlas/bell-contract";
import { atlasBellActionTiming, atlasBellActionTitle } from "@/lib/atlas/bell-action";
import { fetchAtlasBell } from "@/lib/atlas/bell-client";
import { atlasBellIsManagementRole } from "@/lib/atlas/bell-view";
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
    let requestSequence = 0;

    async function refreshBell(expandOnSuccess = false) {
      const requestId = ++requestSequence;
      try {
        const result = await fetchAtlasBell(10);
        if (!active || requestId !== requestSequence) return;
        setBell(result);
        if (expandOnSuccess) {
          setExpanded(result.badgeCount > 0 && result.whileAwayCount > 0);
        }
        await setAtlasAppBadge(result.badgeCount);
      } catch {
        // Keep the last server-authoritative Bell visible until the next refresh succeeds.
      }
    }

    function refreshWhenVisible() {
      if (document.visibilityState === "visible") {
        void refreshBell(false);
      }
    }

    function refreshNow() {
      void refreshBell(false);
    }

    void refreshBell(true);
    window.addEventListener("focus", refreshNow);
    window.addEventListener("pageshow", refreshNow);
    window.addEventListener("online", refreshNow);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    navigator.serviceWorker?.addEventListener("controllerchange", refreshNow);
    const refreshTimer = window.setInterval(refreshWhenVisible, 60_000);

    return () => {
      active = false;
      requestSequence += 1;
      window.removeEventListener("focus", refreshNow);
      window.removeEventListener("pageshow", refreshNow);
      window.removeEventListener("online", refreshNow);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      navigator.serviceWorker?.removeEventListener("controllerchange", refreshNow);
      window.clearInterval(refreshTimer);
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
    () => bell?.items.find((item) => item.whileAway && item.requiresAction && !item.baseline && item.unread)
      ?? bell?.items.find((item) => item.requiresAction && !item.baseline && item.unread)
      ?? null,
    [bell],
  );

  if (!bell || bell.badgeCount <= 0) return null;
  if (pathname === "/bell" || pathname.startsWith("/bell/") || pathname === "/login" || pathname.startsWith("/auth/")) return null;

  const management = atlasBellIsManagementRole(bell.effectiveRole);
  const ariaSummary = `${bell.badgeCount} new ${bell.badgeCount === 1 ? "item needs" : "items need"} your attention.`;

  return (
    <aside
      className="atlas-bell-cover"
      aria-label="Atlas Bell"
      data-expanded={expanded ? "true" : "false"}
      style={{ top }}
    >
      <Link href="/bell" className="atlas-bell-edge-tab" aria-label={`Open Bell. ${ariaSummary}`}>
        <span aria-hidden="true">⌁</span>
        <strong>Bell</strong>
        <b>{countLabel(bell.badgeCount)}</b>
      </Link>

      {expanded && newest ? (
        <Link href="/bell" className="atlas-while-away-slip">
          <span>{management ? "New attention" : "New follow-through"}</span>
          <strong>{atlasBellActionTitle(newest)}</strong>
          {!management ? <em>{atlasBellActionTiming(newest)}</em> : null}
        </Link>
      ) : null}
    </aside>
  );
}
