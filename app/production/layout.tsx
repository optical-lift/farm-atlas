import Link from "next/link";
import type { ReactNode } from "react";
import "./workspace-nav.css";

export default function ProductionLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <nav className="atlas-production-workspace-nav" aria-label="Production planning views">
        <Link href="/production">Crop plans + rules</Link>
        <Link href="/production/dashboard">Season dashboard</Link>
      </nav>
      {children}
    </>
  );
}
