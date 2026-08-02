import { redirect } from "next/navigation";

import TomorrowPreflight from "@/components/atlas/tomorrow/TomorrowPreflight";
import { getAtlasSession } from "@/lib/atlas/session";
import type { AtlasTomorrowPreflight } from "@/lib/atlas/tomorrow-preflight-contract";
import { createAtlasServerClient } from "@/lib/supabase/server";

import "./tomorrow.css";

export const dynamic = "force-dynamic";

type TomorrowSearchParams = Record<string, string | string[] | undefined>;

type TomorrowPageProps = {
  searchParams?: Promise<TomorrowSearchParams>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function centralTomorrowIso() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const today = new Date(`${values.year}-${values.month}-${values.day}T12:00:00`);
  today.setDate(today.getDate() + 1);
  return today.toISOString().slice(0, 10);
}

function validDate(value: string | null) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00`).getTime()));
}

export default async function TomorrowPreflightPage({ searchParams }: TomorrowPageProps) {
  const session = await getAtlasSession();
  if (!session) redirect("/login");

  const membership = session.memberships.find(
    (candidate) => candidate.farmId === session.activeFarmId
      && (candidate.role === "owner" || candidate.role === "manager"),
  ) ?? session.memberships.find(
    (candidate) => candidate.role === "owner" || candidate.role === "manager",
  );
  if (!membership) redirect("/");

  const params = searchParams ? await searchParams : {};
  const requestedDate = firstParam(params.date);
  const workDate = validDate(requestedDate) ? requestedDate! : centralTomorrowIso();

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("owner_tomorrow_preflight_v1", {
    p_farm_id: membership.farmId,
    p_work_date: workDate,
  });
  if (error) {
    console.error("Tomorrow Preflight read failed:", error);
    throw new Error("Tomorrow Preflight could not be loaded.");
  }

  return (
    <TomorrowPreflight
      initialPreflight={data as AtlasTomorrowPreflight}
      farmName={membership.farmName ?? "Elm Farm"}
    />
  );
}
