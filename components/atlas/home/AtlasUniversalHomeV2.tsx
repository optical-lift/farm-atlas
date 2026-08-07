"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { FieldLogDrawer, type AtlasFieldLogSeed } from "@/components/atlas/field-log-builder";
import { AtlasAppShell, AtlasCard, AtlasTopBar } from "@/components/atlas/ui/AtlasPrimitives";
import type { AtlasHomeFarmSeasonProfile } from "@/lib/atlas/home-farm-seasons";
import type { AtlasUniversalDatedItem, AtlasUniversalHomeModel } from "@/lib/atlas/universal-home";
import { fetchAtlasZoneRegistry, type AtlasRegistryZone } from "@/lib/atlas/zone-registry-client";

import styles from "./universal-home-v2.module.css";

type AtlasHomeDayOverview = {
  prepared: boolean;
  plannedTotal: number;
  dealtCount: number;
  openCount: number;
  carryForwardCount: number;
  personalScope: boolean;
  farmCount: number;
  staffLaneCount: number;
};

type AtlasUniversalHomeProps = {
  home: AtlasUniversalHomeModel;
  dayOverview: AtlasHomeDayOverview;
  farmSeasons: Record<string, AtlasHomeFarmSeasonProfile>;
  farmHandMode?: boolean;
};

type WeatherResponse = { ok: boolean; label?: string };
type DayRailItem = { dateIso: string; weekday: string; day: string; openCount: number; completeCount: number; blocked: boolean; attention: boolean };
type FarmFrostRunway = { known: boolean; days: number | null; label: string | null };
const DAY_MS = 24 * 60 * 60 * 1000;

function dateFromIso(value: string) { return new Date(`${value}T12:00:00`); }
function isoFromDate(value: Date) { const local = new Date(value.getTime() - value.getTimezoneOffset() * 60000); return local.toISOString().slice(0, 10); }
function addDaysIso(value: string, days: number) { const date = dateFromIso(value); date.setDate(date.getDate() + days); return isoFromDate(date); }
function prettyDay(value: string) { return dateFromIso(value).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }); }
function weekStartMonday(value: string) { const date = dateFromIso(value); const day = date.getDay(); date.setDate(date.getDate() - (day === 0 ? 6 : day - 1)); return isoFromDate(date); }
function titleCase(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function openDatedItem(item: AtlasUniversalDatedItem) { return item.state !== "complete"; }
function taskIdFromMoveKey(key: string) { return key.startsWith("farm-task:") ? key.split(":").at(-1) ?? "" : ""; }
function formatCount(value: number) { return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.max(0, value || 0)); }

function dayRail(items: AtlasUniversalDatedItem[], todayIso: string) {
  const startIso = weekStartMonday(todayIso);
  return Array.from({ length: 7 }, (_, index): DayRailItem => {
    const dateIso = addDaysIso(startIso, index);
    const dayItems = items.filter((item) => item.date === dateIso);
    return { dateIso, weekday: dateFromIso(dateIso).toLocaleDateString("en-US", { weekday: "narrow" }), day: dateFromIso(dateIso).toLocaleDateString("en-US", { day: "numeric" }), openCount: dayItems.filter(openDatedItem).length, completeCount: dayItems.filter((item) => item.state === "complete").length, blocked: dayItems.some((item) => item.state === "blocked"), attention: dayItems.some((item) => item.state === "attention") };
  });
}
function dayMarker(day: DayRailItem) { if (day.openCount > 0) return String(day.openCount); if (day.completeCount > 0) return "✓"; return "—"; }

function frostRunway(todayIso: string, profile: AtlasHomeFarmSeasonProfile | undefined): FarmFrostRunway {
  if (!profile || profile.frostStatus !== "known" || !profile.frostBoundaryMonth || !profile.frostBoundaryDay) return { known: false, days: null, label: null };
  const today = dateFromIso(todayIso);
  let boundary = new Date(today.getFullYear(), profile.frostBoundaryMonth - 1, profile.frostBoundaryDay, 12);
  if (boundary.getTime() < today.getTime()) boundary = new Date(today.getFullYear() + 1, profile.frostBoundaryMonth - 1, profile.frostBoundaryDay, 12);
  return { known: true, days: Math.max(0, Math.ceil((boundary.getTime() - today.getTime()) / DAY_MS)), label: boundary.toLocaleDateString("en-US", { month: "short", day: "numeric" }) };
}

function HomeTimeRail({ home }: { home: AtlasUniversalHomeModel }) {
  const todayIso = home.window.doneDate;
  const days = dayRail(home.datedItems, todayIso);
  const weekStart = days[0]?.dateIso ?? todayIso;
  const weekEnd = days[6]?.dateIso ?? todayIso;
  const weekOpen = home.datedItems.filter((item) => item.date >= weekStart && item.date <= weekEnd && openDatedItem(item)).length;
  const previousWeek = addDaysIso(weekStart, -7);
  const previousWeekEnd = addDaysIso(previousWeek, 6);
  return <section className={styles.timeRail} aria-label="Days in this week" data-atlas-home-time-rail="true"><div className={styles.days} aria-label="Open a day in this week">{days.map((day) => <Link key={day.dateIso} href={`/day?date=${encodeURIComponent(day.dateIso)}&view=work_order`} className={day.dateIso === todayIso ? styles.today : undefined} data-blocked={day.blocked ? "true" : "false"} data-attention={day.attention ? "true" : "false"} aria-current={day.dateIso === todayIso ? "date" : undefined} aria-label={`${dateFromIso(day.dateIso).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}: ${day.openCount} open`}><small>{day.weekday}</small><strong>{day.day}</strong><em>{dayMarker(day)}</em></Link>)}</div><nav className={styles.timeRoutes} aria-label="Week and month routes"><Link href={`/overview/week?date=${encodeURIComponent(previousWeek)}&end=${encodeURIComponent(previousWeekEnd)}`}>‹ Previous week</Link><Link href={`/overview/week?date=${encodeURIComponent(weekStart)}&end=${encodeURIComponent(weekEnd)}`}>This week · {weekOpen}</Link><Link href={`/overview/month?date=${encodeURIComponent(todayIso)}`}>Month ›</Link></nav></section>;
}

function NeedsYou({ home }: { home: AtlasUniversalHomeModel }) {
  const items = home.attention.slice(0, 3); if (!items.length) return null;
  return <AtlasCard as="section" className={styles.lens} ariaLabelledBy="atlas-home-needs-title"><header className={styles.lensHeader}><div><span>Owner lane</span><h2 id="atlas-home-needs-title">Needs you</h2></div><Link href="/bell?view=needs">{home.attention.length}</Link></header><div className={styles.lensList}>{items.map((item, index) => <Link key={`${item.attentionId ?? item.projectId}-${index}`} href={`/project/${encodeURIComponent(item.projectId)}`}><div><small>{titleCase(item.kind)}</small><strong>{item.title}</strong><span>{item.detail || item.projectTitle}</span></div><b aria-hidden="true">›</b></Link>)}</div>{home.attention.length > items.length ? <Link className={styles.lensFooter} href="/bell?view=needs">See all {home.attention.length} items</Link> : null}</AtlasCard>;
}

function TheFarms({ home, farmSeasons }: { home: AtlasUniversalHomeModel; farmSeasons: Record<string, AtlasHomeFarmSeasonProfile> }) {
  return <section className={styles.farmsSection} aria-label="Farm seasons"><div className={styles.farmCards}>{home.farms.map((farm) => { const snapshot = farm.snapshot; const season = farmSeasons[farm.farmId]; const runway = frostRunway(home.window.doneDate, season); const activePercent = snapshot.totalBeds > 0 ? Math.min(100, Math.round((snapshot.growingBeds / snapshot.totalBeds) * 100)) : 0; const roleLabel = farm.role === "owner" ? "Stewarding" : "Working at"; const identityLine = season?.locationLabel ? `${roleLabel} · ${season.locationLabel}` : roleLabel; return <article className={styles.farmCard} key={farm.farmId} data-has-growing-beds={snapshot.growingBeds > 0 ? "true" : "false"}><header className={styles.farmCardHead}><div><small>{identityLine}</small><h3>{farm.farmName}</h3></div><span className={styles.frostBadge} data-frost-known={runway.known ? "true" : "false"}><b>{runway.known ? runway.days : "?"}</b><em>{runway.known ? "days to frost" : "frost date unknown"}</em></span></header><div className={styles.farmMetrics}><div><b>{formatCount(snapshot.growingBeds)}</b><span>beds growing</span></div><div><b>{formatCount(snapshot.activeSqft)}</b><span>sq ft active</span></div><div><b>{formatCount(snapshot.stemsLogged)}</b><span>stems this year</span></div></div>{snapshot.totalBeds > 0 ? <div className={styles.bedProgress}><div><span>{snapshot.growingBeds} of {snapshot.totalBeds} mapped beds growing</span><b>{activePercent}%</b></div><i aria-hidden="true"><span style={{ width: `${activePercent}%` }} /></i></div> : <p className={styles.firstBed}>Ready for its first mapped growing bed.</p>}<footer className={styles.farmCardFoot}><span>{formatCount(snapshot.sowingsLogged)} sowings recorded this year</span><b>{runway.known ? `${runway.label} boundary` : "First season · frost unknown"}</b></footer></article>; })}</div></section>;
}

export default function AtlasUniversalHome({ home, dayOverview, farmSeasons, farmHandMode = false }: AtlasUniversalHomeProps) {
  const router = useRouter(); const [weatherLabel, setWeatherLabel] = useState<string | null>(null); const [registryZones, setRegistryZones] = useState<AtlasRegistryZone[]>([]); const [logSeed, setLogSeed] = useState<AtlasFieldLogSeed | null>(null); const todayIso = home.window.doneDate;
  const canDocumentActiveFarm = Boolean(home.activeFarm && home.activeFarm.workerKey && home.activeFarm.farmId === home.viewer.activeFarmId);
  useEffect(() => { if (!home.activeFarm || home.activeFarm.farmId !== home.viewer.activeFarmId) return; let active = true; fetch("/api/atlas/weather", { headers: { Accept: "application/json" }, cache: "no-store" }).then((response) => response.json()).then((data: WeatherResponse) => { if (active) setWeatherLabel(data.ok && data.label ? data.label : null); }).catch(() => { if (active) setWeatherLabel(null); }); return () => { active = false; }; }, [home.activeFarm, home.viewer.activeFarmId]);
  async function openFieldLog() { if (!canDocumentActiveFarm) return; if (registryZones.length === 0) { try { const response = await fetchAtlasZoneRegistry(); setRegistryZones(response.zones ?? []); } catch { setRegistryZones([]); } } setLogSeed({ workKey: "note", zoneKeys: [], objectKeys: [] }); }

  const headerStatus = weatherLabel || `${home.metrics.movingCount} moving`;
  const multiFarmPersonal = dayOverview.personalScope && dayOverview.farmCount > 1;
  const heroHref = multiFarmPersonal ? "/work/today" : home.activeFarm ? `/day?date=${encodeURIComponent(todayIso)}&view=work_order` : "/work/today";
  const coverLabel = farmHandMode ? "Your next move" : multiFarmPersonal ? `Today across ${dayOverview.farmCount} farms` : home.activeFarm ? `Today at ${home.activeFarm.farmName}` : "Today";
  const hasCarryForward = dayOverview.carryForwardCount > 0;
  const overdueLabel = `${dayOverview.carryForwardCount}${dayOverview.personalScope ? " personal" : ""} ${dayOverview.carryForwardCount === 1 ? "task" : "tasks"} overdue`;
  const linedUp = Math.max(dayOverview.openCount - (home.moves.length ? 1 : 0), 0);
  const progressLabel = farmHandMode ? (linedUp > 0 ? `${linedUp} more ${linedUp === 1 ? "thing" : "things"} lined up today` : dayOverview.openCount > 0 ? "This is the work in front of you" : "Farm work is caught up for today") : dayOverview.plannedTotal > 0 ? dayOverview.personalScope ? `${dayOverview.dealtCount} of ${dayOverview.plannedTotal} personal tasks dealt with · ${dayOverview.openCount} open` : `${dayOverview.dealtCount} of ${dayOverview.plannedTotal} dealt with · ${dayOverview.openCount} open` : hasCarryForward ? overdueLabel : dayOverview.personalScope ? "No personal tasks due" : "Day clear";
  const carryForwardLabel = farmHandMode ? null : dayOverview.plannedTotal > 0 && hasCarryForward ? overdueLabel : null;
  const visibleMoves = farmHandMode ? home.moves.slice(0, 1) : home.moves;

  return <><AtlasAppShell className="atlas-home-shell" frameClassName={styles.frame} data-atlas-home-portal="universal-v2" data-atlas-has-farm-scope={home.viewer.hasFarmScope ? "true" : "false"} data-atlas-has-organization-scope={home.viewer.hasOrganizationScope ? "true" : "false"}><AtlasTopBar title={home.title} status={<span className="atlas-weather-line">{headerStatus}</span>} action={canDocumentActiveFarm ? <button type="button" className="atlas-note-plus" aria-label="Document work" onClick={openFieldLog}>+</button> : home.projects.length ? <Link href="/projects" className="atlas-note-plus" aria-label="Open projects">+</Link> : null}/><div className={styles.home}><div className={styles.todayStack}><AtlasCard variant="purple" className={styles.hero} ariaLabelledBy="atlas-today-title"><div className={styles.heroHead}><div className={styles.heroIdentity}><span>{coverLabel}</span><em id="atlas-today-title">{farmHandMode ? prettyDay(todayIso) : prettyDay(todayIso)}</em></div><span className={styles.heroStatus}><b>{progressLabel}</b>{carryForwardLabel ? <em>{carryForwardLabel}</em> : null}</span></div>{visibleMoves.length ? <div className={styles.heroGrid} data-task-count={visibleMoves.length} data-atlas-home-task-board="true">{visibleMoves.map((move, index) => { const taskId = taskIdFromMoveKey(move.key); const taskPosition = move.kind === "farm_task" ? index === 0 ? "current" : index === 1 ? "next" : "later" : "oversight"; return <article key={move.key} className={styles.heroMove} data-state={move.state} data-position={taskPosition}><Link href={move.href} className={styles.heroMoveBody} data-single-task-id={taskId || undefined}><small>{farmHandMode ? "Next at Elm" : move.category}</small><strong>{move.title}</strong><span>{move.scopeLabel}{move.meta ? ` · ${move.meta}` : ""}</span>{move.detail ? <em>{move.detail}</em> : null}</Link>{index === 0 && move.kind === "farm_task" ? <Link className={styles.heroAction} href={move.href}>{move.state === "blocked" ? "See what’s in the way" : farmHandMode ? "Start" : "Finish"}</Link> : null}</article>; })}</div> : <div className={styles.heroEmpty}><strong>{farmHandMode ? "Farm work is caught up for today" : hasCarryForward ? overdueLabel : dayOverview.personalScope ? "No personal work is due today" : "The day is clear"}</strong><em>{farmHandMode ? "Atlas will put the next useful move here when there is one." : hasCarryForward ? "Open the day overview to work through the oldest unfinished tasks." : "Open Work to inspect the next planned day."}</em></div>}</AtlasCard>{farmHandMode ? null : <HomeTimeRail home={home}/>}</div>{farmHandMode ? null : <NeedsYou home={home}/>}<TheFarms home={home} farmSeasons={farmSeasons}/></div></AtlasAppShell>{logSeed ? <FieldLogDrawer zones={registryZones} seed={logSeed} onClose={() => setLogSeed(null)} onSaved={() => { setLogSeed(null); router.refresh(); }}/>: null}</>;
}
