"use client";

import Link from "next/link";
import type { MouseEventHandler } from "react";

export type AtlasDockIconKey = "home" | "work" | "clock" | "manager" | "harvest" | "training" | "buyer" | "more";

export type AtlasDockItem = {
  key: AtlasDockIconKey;
  label: string;
  href: string;
};

export function AtlasDockIcon({ kind }: { kind: AtlasDockIconKey }) {
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

  if (kind === "training") {
    return (
      <svg {...common} aria-hidden="true">
        <path d="M4 8.25h3M17 8.25h3M7 6v12M17 6v12" />
        <path d="M7 12h10" />
        <path d="M3 10v4M21 10v4" />
      </svg>
    );
  }

  if (kind === "buyer") {
    return (
      <svg {...common} aria-hidden="true">
        <path d="M4.5 8.25h15v10.5h-15z" />
        <path d="M8.25 8.25V5.5h7.5v2.75M4.5 12h15" />
        <path d="M10 12v2h4v-2" />
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

export default function AtlasDock({
  items,
  active,
  onNavigate,
  ariaLabel = "Atlas destinations",
}: {
  items: AtlasDockItem[];
  active: AtlasDockIconKey | null;
  onNavigate?: (item: AtlasDockItem) => void;
  ariaLabel?: string;
}) {
  const handleClick = (item: AtlasDockItem): MouseEventHandler<HTMLAnchorElement> | undefined => {
    if (!onNavigate) return undefined;
    return (event) => {
      event.preventDefault();
      onNavigate(item);
    };
  };

  return (
    <nav className="atlas-context-footer" aria-label={ariaLabel}>
      <div
        className="atlas-context-footer__rail"
        style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
      >
        {items.map((item) => (
          <Link
            key={`${item.key}:${item.href}`}
            href={item.href}
            className="atlas-context-footer__item"
            aria-current={active === item.key ? "page" : undefined}
            onClick={handleClick(item)}
          >
            <span className="atlas-context-footer__icon" aria-hidden="true"><AtlasDockIcon kind={item.key} /></span>
            <strong>{item.label}</strong>
          </Link>
        ))}
      </div>
    </nav>
  );
}
