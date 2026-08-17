import Link from "next/link";
import type { ReactNode } from "react";

export default function PrincipalLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <nav
        aria-label="Principal workspace"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 30,
          display: "flex",
          justifyContent: "center",
          gap: 10,
          padding: "9px 14px",
          borderBottom: "1px solid rgba(38,38,38,.1)",
          background: "rgba(245,241,232,.96)",
          backdropFilter: "blur(10px)",
        }}
      >
        <Link href="/principal" style={{ color: "#262626", fontSize: 12, fontWeight: 900, textDecoration: "none" }}>
          Principal
        </Link>
        <span aria-hidden="true" style={{ opacity: .3 }}>·</span>
        <Link href="/principal/author" style={{ color: "#262626", fontSize: 12, fontWeight: 900, textDecoration: "none" }}>
          Author truth
        </Link>
      </nav>
      {children}
    </>
  );
}
