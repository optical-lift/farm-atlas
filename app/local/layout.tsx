import type { Metadata } from "next";
import "./local.css";
import "./detail.css";
import "./ask.css";

export const metadata: Metadata = {
  title: "Elm Local · Ask what’s happening and available nearby",
  description: "Ask Elm Local what’s happening, what’s available, and where to find useful things across Marshfield and surrounding southwest Missouri communities.",
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
