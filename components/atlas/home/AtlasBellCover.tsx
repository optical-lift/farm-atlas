"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { AtlasBell } from "@/lib/atlas/bell-contract";
import { fetchAtlasBell } from "@/lib/atlas/bell-client";

function countLabel(value: number) {
  return value > 99 ? "99+" : String(value);
}

export default function AtlasBellCover() {
  const [bell, setBell] = useState<AtlasBell | null>(null);

  useEffect(() => {
    let active = true;
    void fetchAtlasBell(6)
      .then((result) => {
        if (active) setBell(result);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  if (!bell) return null;
  const newest = bell.items.find((item) => item.whileAway) ?? bell.items[0] ?? null;

  return (
    <aside className="atlas-bell-cover" aria-label="Atlas Bell">
      <Link href="/bell" className="atlas-bell-edge-tab" aria-label={`Open Bell. ${bell.badgeCount} items require attention.`}>
        <span aria-hidden="true">⌁</span>
        <strong>Bell</strong>
        {bell.badgeCount ? <b>{countLabel(bell.badgeCount)}</b> : null}
      </Link>

      {bell.whileAwayCount > 0 ? (
        <Link href="/bell?view=while-away" className="atlas-while-away-slip">
          <span>While you were away</span>
          <strong>{bell.whileAwayCount} farm {bell.whileAwayCount === 1 ? "change" : "changes"}</strong>
          {newest ? <em>{newest.symbol} {newest.title}</em> : null}
        </Link>
      ) : null}
    </aside>
  );
}
