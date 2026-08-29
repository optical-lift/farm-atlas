import type { Metadata } from "next";
import "./local.css";

export const metadata: Metadata = {
  title: "Elm Local · What’s happening around Marshfield?",
  description: "Elm Local community calendar for Marshfield and surrounding southwest Missouri communities, including Elm Farm events and verified happenings around the region.",
  applicationName: "Elm Local",
  appleWebApp: {
    capable: true,
    title: "Elm Local",
    statusBarStyle: "default",
  },
};

export default function ElmLocalLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
