import type { Metadata } from "next";
import "./local.css";

export const metadata: Metadata = {
  title: "Elm Local · What’s happening around Marshfield?",
  description: "Elm Local community calendar for Marshfield, Missouri, including Elm Farm events and verified happenings around town.",
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
