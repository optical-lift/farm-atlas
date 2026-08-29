import type { Metadata } from "next";

import PortalLab from "./PortalLab";

export const metadata: Metadata = {
  title: "Portal Lab · Atlas",
};

export default function PortalLabPage() {
  return <PortalLab />;
}
