import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "./home.css";
import "./zones.css";
import "./task-feed.css";
import "./closeout-clean.css";
import "./rhythm-log.css";
import "./log-picker-compact.css";
import "./today-schedule.css";
import "./project-spine.css";
import "./task-page.css";
import "./field-state-capture.css";
import "./day-run-sheet.css";
import "./purple-hero-rollback.css";
import "./home-horizontal-dashboard.css";
import "./home-week-day-final-fit.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Atlas · Elm Farm",
  description: "Elm Farm task hand and field registry",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
