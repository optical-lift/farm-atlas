"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type WeatherResponse = { ok: boolean; label?: string };

export default function PaidScheduleHeader({ farmName }: { farmName: string }) {
  const [weatherLabel, setWeatherLabel] = useState("live weather loading…");

  useEffect(() => {
    async function loadWeather() {
      try {
        const response = await fetch("/api/atlas/weather", {
          headers: { Accept: "application/json" },
          cache: "no-store",
        });
        const data = (await response.json()) as WeatherResponse;
        setWeatherLabel(response.ok && data.ok && data.label ? data.label : "weather unavailable");
      } catch {
        setWeatherLabel("weather unavailable");
      }
    }

    void loadWeather();
  }, []);

  return (
    <header className="atlas-phone-top atlas-dashboard-top">
      <Link href="/" className="atlas-phone-brand atlas-task-header-brand">
        <span className="atlas-phone-kicker">Atlas</span>
        <span className="atlas-phone-title">{farmName}</span>
      </Link>
      <span className="atlas-weather-line">{weatherLabel}</span>
      <Link href="/" className="atlas-note-plus" aria-label="Back to today">+</Link>
    </header>
  );
}
