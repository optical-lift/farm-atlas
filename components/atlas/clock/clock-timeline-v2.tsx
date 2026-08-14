"use client";

import Link from "next/link";
import { useState, type MouseEvent } from "react";

import ReservationEditor from "@/components/atlas/reservations/ReservationEditor";
import type { AtlasClockTaskLayout, AtlasClockTaskRange } from "@/lib/atlas/clock-layout";
import { clockLocalMinuteOfDay } from "@/lib/atlas/clock-layout";
import type { AtlasClockProposalBlock } from "@/lib/atlas/clock-proposal";
import type { AtlasClockReservation } from "@/lib/atlas/clock-reservations";
import type { AtlasDaySequenceItem } from "@/lib/atlas/day-sequence";
import { DEFAULT_ATLAS_FARM_TIME_ZONE } from "@/lib/atlas/farm-day";
import { atlasTimingClassLabel } from "@/lib/atlas/timing-mobility";

import ClockOwnerControls from "./clock-owner-controls";
import ClockReservationBlock from "./ClockReservationBlock";
import styles from "./clock-surface-v2.module.css";

type Cue = Extract<AtlasDaySequenceItem, { kind: "cue" }>;
const HOUR_HEIGHT = 64;
function minuteLabel(value: number) { const minute=((Math.round(value)%1440)+1440)%1440; const hour=Math.floor(minute/60); return `${hour%12||12}:${String(minute%60).padStart(2,"0")} ${hour>=12?"PM":"AM"}`; }
function hourLabel(hour:number){const normalized=((hour%24)+24)%24;if(normalized===0)return"12 AM";if(normalized===12)return"12 PM";return normalized>12?`${normalized-12} PM`:`${normalized} AM`;}
function taskHref(taskId:string,dateIso:string){const returnTo=`/clock?date=${encodeURIComponent(dateIso)}`;return `/task-focus/${encodeURIComponent(taskId)}?returnTo=${encodeURIComponent(returnTo)}`;}
function proposalDurationLabel(block: AtlasClockProposalBlock) { return block.durationSource === "estimate" ? `${block.durationMinutes}m estimate` : block.durationSource === "planning_default" ? `${block.durationMinutes}m planning hold` : `${block.durationMinutes}m`; }

export default function ClockTimelineV2(props:{dateIso:string;canManage:boolean;layouts:AtlasClockTaskLayout[];proposals:AtlasClockProposalBlock[];timedCues:Cue[];dayReservations:AtlasClockReservation[];activeRange:AtlasClockTaskRange|null;selectedToday:boolean;nowMinute:number|null;startHour:number;endHour:number;gridHeight:number;onChanged:()=>Promise<void>;onError:(message:string|null)=>void;}){
 const [createMinute,setCreateMinute]=useState<number|null>(null);
 const hours=Array.from({length:props.endHour-props.startHour+1},(_,index)=>props.startHour+index); const offsetForMinute=(minute:number)=>((minute-props.startHour*60)/60)*HOUR_HEIGHT;
 function createAtGridPoint(event:MouseEvent<HTMLDivElement>){
  if(!props.canManage)return;
  const target=event.target instanceof Element?event.target:null;
  if(target?.closest("[data-clock-timed-task],[data-clock-day-reservation],[data-clock-timed-cue],[data-clock-proposed-time]"))return;
  const rect=event.currentTarget.getBoundingClientRect();
  const minute=props.startHour*60+((event.clientY-rect.top)/HOUR_HEIGHT)*60;
  setCreateMinute(Math.max(0,Math.min(1410,Math.round(minute/5)*5)));
 }
 return <section className={styles.gridShell} aria-label="Clock timeline"><header><h2>Time</h2><span>{props.proposals.length ? "White = committed · purple = proposed" : "Exact starts + planned spans"}</span>{props.canManage?<button type="button" onClick={()=>setCreateMinute(12*60)} style={{marginLeft:"auto",border:"1px solid rgba(88,87,111,.18)",borderRadius:999,background:"#fff",padding:"5px 9px",fontSize:10,fontWeight:800}}>+ Fixed time</button>:null}</header><div className={styles.grid} style={{height:props.gridHeight}} data-clock-duration-blocks="true" data-clock-create-reservation={props.canManage?"tap-open-space":undefined} onClick={createAtGridPoint}>
 {hours.map((hour)=><div className={styles.hour} style={{top:(hour-props.startHour)*HOUR_HEIGHT}} key={hour}><span>{hourLabel(hour)}</span></div>)}
 {props.selectedToday&&props.nowMinute!==null?<div className={styles.now} style={{top:offsetForMinute(props.nowMinute)}} data-clock-now-line="true"><span>NOW</span></div>:null}
 {props.timedCues.map((item)=>{const minute=clockLocalMinuteOfDay(item.scheduledAt,DEFAULT_ATLAS_FARM_TIME_ZONE);if(minute===null)return null;return <div className={styles.cue} style={{top:offsetForMinute(minute)}} key={item.id} data-clock-timed-cue="true" data-clock-day-reservation="point" data-timing-class={item.mobility.timingClass}><i aria-hidden="true"/><div><small>{minuteLabel(minute)} · Cue · {atlasTimingClassLabel(item.mobility)}</small><strong>{item.title}</strong>{item.body?<span>{item.body}</span>:null}</div></div>;})}
 {props.dayReservations.filter((reservation)=>reservation.source!=="timed_cue").map((reservation)=><ClockReservationBlock key={reservation.id} dateIso={props.dateIso} canManage={props.canManage} reservation={reservation} startHour={props.startHour}/>)}
 {props.proposals.map((block)=>{const item=block.item;const height=Math.max(38,(block.durationMinutes/60)*HOUR_HEIGHT-2);return <div className={styles.timedTask} style={{top:offsetForMinute(block.startMinute),height,left:"61px",width:"calc(100% - 69px)",overflow:"hidden",background:"rgba(239,232,249,.94)",borderStyle:"dashed",borderColor:block.conflict?"rgba(156,88,88,.58)":"rgba(121,86,162,.46)",borderLeft:"3px solid rgba(132,92,179,.58)",zIndex:5}} key={block.id} data-clock-proposed-time="true" data-timing-class={item.mobility.constraintClass} data-conflict={block.conflict?"true":"false"}><Link href={item.taskId?taskHref(item.taskId,props.dateIso):`/clock?date=${props.dateIso}`}><small>Atlas proposes · {minuteLabel(block.startMinute)}–{minuteLabel(block.endMinute)}</small><span className={styles.mobility}>{atlasTimingClassLabel({...item.mobility,timingClass:"potential"})}</span><strong>{item.title}</strong><span>{proposalDurationLabel(block)} · {block.reason}</span>{block.conflict?<span className={styles.conflictNote}>Constraint collides with committed Clock time</span>:null}</Link></div>;})}
 {props.layouts.map((layout)=>{const item=layout.item;const height=layout.span.minutes?Math.max(38,(layout.span.minutes/60)*HOUR_HEIGHT-2):42;const available="calc(100% - 69px)";const left=layout.laneCount===1?"61px":`calc(61px + (${available} * ${layout.laneIndex} / ${layout.laneCount}))`;const width=layout.laneCount===1?"calc(100% - 69px)":`calc((${available} / ${layout.laneCount}) - 4px)`;return <div className={styles.timedTask} style={{top:offsetForMinute(layout.startMinute),height,left,width,overflow:"visible"}} key={item.id} data-clock-timed-task="true" data-clock-planned-span={layout.span.minutes?"true":"false"} data-active={props.activeRange?.item.id===item.id?"true":"false"} data-conflict={layout.conflict?"true":"false"} data-timing-class={item.mobility.timingClass}><Link style={{maxHeight:"100%",overflow:"hidden",paddingRight:props.canManage?28:0}} href={item.taskId?taskHref(item.taskId,props.dateIso):`/clock?date=${props.dateIso}`}><small>{layout.span.minutes?`${minuteLabel(layout.startMinute)}–${minuteLabel(layout.endMinute)}`:`${minuteLabel(layout.startMinute)} · Start only`}</small><span className={styles.mobility} title={item.mobility.placementReason}>{atlasTimingClassLabel(item.mobility)}</span><strong>{item.title}</strong>{item.location?<span>{item.location}</span>:null}{layout.conflict?<span className={styles.conflictNote}>Overlaps another planned block</span>:null}</Link><ClockOwnerControls item={item} dateIso={props.dateIso} canManage={props.canManage} onChanged={props.onChanged} onError={props.onError} showTime compact/></div>;})}
 </div>{createMinute!==null?<ReservationEditor dateIso={props.dateIso} defaultStartMinute={createMinute} onClose={()=>setCreateMinute(null)}/>:null}</section>;
}
