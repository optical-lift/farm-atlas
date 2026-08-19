import Link from "next/link";
import type { ReactNode } from "react";

import OwnerNetworkConfirmationModal from "@/components/atlas/owner-network-confirmation-modal";

const linkStyle = { color: "#262626", fontSize: 12, fontWeight: 900, textDecoration: "none" } as const;

export default function PrincipalLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <OwnerNetworkConfirmationModal />
      <nav
        aria-label="Principal workspace"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 30,
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: 10,
          padding: "9px 14px",
          borderBottom: "1px solid rgba(38,38,38,.1)",
          background: "rgba(245,241,232,.96)",
          backdropFilter: "blur(10px)",
        }}
      >
        <Link href="/principal" style={linkStyle}>Principal</Link>
        <span aria-hidden="true" style={{ opacity: .3 }}>·</span>
        <Link href="/principal/author" style={linkStyle}>Obligations &amp; theses</Link>
        <span aria-hidden="true" style={{ opacity: .3 }}>·</span>
        <Link href="/principal/author/office" style={linkStyle}>Office authoring</Link>
        <span aria-hidden="true" style={{ opacity: .3 }}>·</span>
        <Link href="/principal/author/capacity" style={linkStyle}>Household &amp; capacity</Link>
        <span aria-hidden="true" style={{ opacity: .3 }}>·</span>
        <Link href="/principal/resolve/farm-capacity" style={linkStyle}>Farm capacity exceptions</Link>
      </nav>
      {children}
    </>
  );
}
