"use client";
import Link from "next/link";
import {useSearchParams} from "next/navigation";
import {useEffect,useMemo,useState} from "react";
import {buildClockTaskRanges,chooseClockNextTask,clockLocalMinuteOfDay,layoutClockTaskRanges} from "@/lib/atlas/clock-layout";
import {buildAtlasClockProposal} from "@/lib/atlas/clock-proposal";
import {buildAtlasClockReservations} from "@/lib/atlas/clock-reservations";
import type {AtlasDaySequence,AtlasDaySequenceItem} from "@/lib/atlas/day-sequence";
import {atlasFarmDateIso,atlasNormalizeFarmDate,DEFAULT_ATLAS_FARM_TIME_ZONE} from "@/lib/atlas/farm-day";
import ClockHeaderV2 from "./clock-header-v2";
import {readOwnerClockSequence} from "./clock-owner-reader";
import ClockPlanBar from "./clock-plan-bar";
import ClockPlanningTimeline from "./clock-planning-timeline";
import ClockPlanningUnplaced from "./clock-planning-unplaced";
import ClockTimelineV2 from "./clock-timeline-v2";
import ClockUnplacedV2 from "./clock-unplaced-v2";
import {useClockPlanEditor} from "./use-clock-plan-editor";
import {readWorkerClockSequence} from "./clock-worker-reader";
import styles from "./clock-surface-v2.module.css";

type Work=Extract<AtlasDaySequenceItem,{kind:"committed_task"}>;
type Cue=Extract<AtlasDaySequenceItem,{kind:"cue"}>;
function timeLabel(value:Date){return new Intl.DateTimeFormat("en-US",{timeZone:DEFAULT_ATLAS_FARM_TIME_ZONE,hour:"numeric",minute:"2-digit"}).format(value);}
async function readClock(dateIso:string){
 const ownerSequence=await readOwnerClockSequence(dateIso);
 if (ownerSequence) return { sequence: ownerSequence, canManage: true };
 return { sequence: await readWorkerClockSequence(dateIso), canManage: false };
}

export default function ClockOrchestrator(){
 const search=useSearchParams(),dateIso=atlasNormalizeFarmDate(search.get("date"));
 const [sequence,setSequence]=useState<AtlasDaySequence|null>(null),[canManage,setCanManage]=useState(false),[proposalOpen,setProposalOpen]=useState(false);
 const [error,setError]=useState<string|null>(null),[saveError,setSaveError]=useState<string|null>(null),[loading,setLoading]=useState(true),[now,setNow]=useState(()=>new Date());
 async function reload(){const value=await readClock(dateIso);setSequence(value.sequence);setCanManage(value.canManage);}
 useEffect(()=>{let alive=true;setLoading(true);setError(null);setSaveError(null);setProposalOpen(false);void readClock(dateIso).then(value=>{if(alive){setSequence(value.sequence);setCanManage(value.canManage);}}).catch(failure=>{if(alive){setSequence(null);setCanManage(false);setError(failure instanceof Error?failure.message:"Clock could not load.");}}).finally(()=>{if(alive)setLoading(false);});return()=>{alive=false;};},[dateIso]);
 useEffect(()=>{const timer=window.setInterval(()=>setNow(new Date()),60_000);return()=>window.clearInterval(timer);},[]);
 // Worker privacy contract: potential work never enters the worker temporal surface.
 const items=useMemo(()=>(sequence?.items??[]).filter((item) => item.kind !== "potential_task"),[sequence]);
 const committed=useMemo(()=>items.filter((item):item is Work=>item.kind==="committed_task"),[items]);
 const timedCues=useMemo(()=>items.filter((item):item is Cue=>item.kind==="cue"&&item.positionResolved&&item.anchorKind === "at_time"&&Boolean(item.scheduledAt)&&!["resolved","dismissed","stale"].includes(item.status)),[items]);
 const dayReservations=useMemo(()=>buildAtlasClockReservations({timedCues,timeZone:DEFAULT_ATLAS_FARM_TIME_ZONE}),[timedCues]);
 const ranges=useMemo(()=>buildClockTaskRanges(committed,{timeZone:DEFAULT_ATLAS_FARM_TIME_ZONE}),[committed]),layouts=useMemo(()=>layoutClockTaskRanges(ranges),[ranges]);
 // Plan this Clock. Reservations are day-shaping truth, not tasks, and nothing changes Anna's Clock until Commit plan.
 const proposal=useMemo(()=>canManage&&proposalOpen?buildAtlasClockProposal(committed,{reservations:dayReservations}):{blocks:[],unresolved:[]},[canManage,proposalOpen,committed,dayReservations]);
 const editor=useClockPlanEditor({active:canManage&&proposalOpen,dateIso,committed,proposal,reservations:dayReservations,rebuildProposal:()=>buildAtlasClockProposal(committed,{reservations:dayReservations}),onReload:reload,onCommitted:()=>setProposalOpen(false),onError:setSaveError});
 const today=atlasFarmDateIso(now),selectedToday = dateIso === today,nowMinute=selectedToday ? clockLocalMinuteOfDay(now.toISOString(),DEFAULT_ATLAS_FARM_TIME_ZONE) : null;
 const activeRange=selectedToday&&nowMinute!==null?ranges.find(range=>Boolean(range.span.minutes)&&range.startMinute <= nowMinute&&range.endMinute > nowMinute&&range.item.status!=="done"&&range.item.status!=="completed")??null:null;
 const nextTask=chooseClockNextTask(committed,ranges,selectedToday?nowMinute:null),nextRange=nextTask?ranges.find(range=>range.item.id===nextTask.id)??null:null;
 const cueMinutes=timedCues.map(item=>clockLocalMinuteOfDay(item.scheduledAt,DEFAULT_ATLAS_FARM_TIME_ZONE)).filter((value):value is number=>value!==null);
 const taskMinutes=ranges.flatMap(range=>range.span.minutes?[range.startMinute,range.endMinute]:[range.startMinute]);
 const planMinutes=editor.blocks?editor.blocks.flatMap(block=>block.startMinute===null||block.decision==="reject"?[]:[block.startMinute,block.startMinute+block.durationMinutes]):proposal.blocks.flatMap(block=>[block.startMinute,block.endMinute]);
 const all=[...taskMinutes,...cueMinutes,...planMinutes],floor=Math.min(360,...(all.length?all:[360]),...(nowMinute!==null?[nowMinute]:[])),ceiling=Math.max(1320,...(all.length?all:[1320]),...(nowMinute!==null?[nowMinute]:[]));
 const startHour=Math.max(0,Math.floor(floor/60)),endHour=Math.min(24,Math.max(startHour+1,Math.ceil(ceiling/60))),gridHeight=(endHour-startHour)*64,planning=canManage&&proposalOpen&&Boolean(editor.blocks);
 return <main className="atlas-phone-shell"><section className={`atlas-phone ${styles.phone}`}><header className="atlas-phone-top"><Link href="/" className="atlas-phone-brand"><span className="atlas-phone-kicker">Atlas</span><span className="atlas-phone-title">Clock</span></Link></header><div className={styles.body}>
  <ClockHeaderV2 dateIso={dateIso} selectedToday={selectedToday} nowLabel={timeLabel(now)} activeRange={activeRange} nextTask={nextTask} nextRange={nextRange} loading={loading}/>
  {error?<div className={styles.error}>{error}</div>:null}{saveError?<div className={styles.error}>{saveError}</div>:null}
  {canManage?<ClockPlanBar open={proposalOpen} summary={editor.summary} committing={editor.committing} onOpen={()=>{setSaveError(null);setProposalOpen(true);}} onAcceptAll={editor.acceptAll} onReset={editor.reset} onCancel={()=>{setSaveError(null);setProposalOpen(false);}} onCommit={()=>void editor.commit()}/>:null}
  {planning?<><ClockPlanningTimeline dateIso={dateIso} blocks={editor.blocks??[]} timedCues={timedCues} selectedToday={selectedToday} nowMinute={nowMinute} startHour={startHour} endHour={endHour} gridHeight={gridHeight} onMove={editor.move} onResize={editor.resize} onDecision={editor.decide} onOverride={editor.setWarningOverride} onUnplace={editor.unplace}/><ClockPlanningUnplaced items={items} dateIso={dateIso} visibleProposalTaskIds={editor.visibleProposalTaskIds} returnedTaskIds={editor.returnedTaskIds} proposalUnresolved={proposal.unresolved}/></>
  :<><ClockTimelineV2 dateIso={dateIso} canManage={canManage} layouts={layouts} proposals={proposal.blocks} timedCues={timedCues} activeRange={activeRange} selectedToday={selectedToday} nowMinute={nowMinute} startHour={startHour} endHour={endHour} gridHeight={gridHeight} onChanged={reload} onError={setSaveError}/><ClockUnplacedV2 items={items} dateIso={dateIso} canManage={canManage} loading={loading} proposedTaskIds={proposalOpen?editor.visibleProposalTaskIds:undefined} proposalUnresolved={proposalOpen?proposal.unresolved:[]} onChanged={reload} onError={setSaveError}/></>}
 </div></section></main>;
}
