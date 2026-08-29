"use client";

import Link from "next/link";

export type AtlasMoreDestination = {
  label: string;
  detail: string;
  href: string;
};

export default function AtlasMoreDestinationList({
  destinations,
  onNavigate,
  ariaLabel = "More Atlas destinations",
}: {
  destinations: AtlasMoreDestination[];
  onNavigate?: (destination: AtlasMoreDestination) => void;
  ariaLabel?: string;
}) {
  return (
    <nav className="atlas-more-page__list" aria-label={ariaLabel}>
      {destinations.map((destination) => (
        <Link
          key={`${destination.href}:${destination.label}`}
          href={destination.href}
          onClick={onNavigate ? (event) => {
            event.preventDefault();
            onNavigate(destination);
          } : undefined}
        >
          <div>
            <strong>{destination.label}</strong>
            <span>{destination.detail}</span>
          </div>
          <b aria-hidden="true">›</b>
        </Link>
      ))}
    </nav>
  );
}
