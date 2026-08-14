import { clockLocalMinuteOfDay } from "@/lib/atlas/clock-layout";
import type { AtlasClockDraftBlock, AtlasClockDraftDecision } from "@/lib/atlas/clock-plan-draft";
import type { AtlasDaySequenceItem } from "@/lib/atlas/day-sequence";
import { DEFAULT_ATLAS_FARM_TIME_ZONE } from "@/lib/atlas/farm-day";
import { atlasTimingClassLabel } from "@/lib/atlas/timing-mobility";

import ClockPlanningBlock from "./clock-planning-block";
import styles from "./clock-surface-v2.module.css";

type Cue = Extract<AtlasDaySequenceItem, { kind: "cue" }>;
const HOUR_HEIGHT = 64;

function hourLabel(hour:number){const value=((hour%24)+24)%24;if(value===0)return"12 AM";if(value===12)return"12 PM";return value>12?`${value-12} PM`:`${value} AM`;}
function minuteLabel(value:number){const minute=((Math.round(value)%1440)+1440)%1440;const hour=Math.floor(minute/60);return `${hour%12||12}:${String(minute%60).padStart(2,"0")} ${hour>=12?"PM":"AM"}`;}

export default function ClockPlanningTimeline(props:{
  dateIso:string;blocks:AtlasClockDraftBlock[];timedCues:Cue[];selectedToday:boolean;nowMinute:number|null;
  startHour:number;endHour:number;gridHeight:number;
  onMove:(id:string,start:number)=>void;onResize:(id:string,duration:number)=>void;
  onDecision:(id:string,decision:AtlasClockDraftDecision)=>void;onOverride:(id:string,value:boolean)=>void;onUnplace:(id:string)=>void;
}){
  const hours=Array.from({length:props.endHour-props.startHour+1},(_,index)=>props.startHour+index);
  const offset=(minute:number)=>((minute-props.startHour*60)/60)*HOUR_HEIGHT;
  return <section className={styles.gridShell} aria-label="Clock planning timeline" data-clock-plan-timeline="true">
    <header><h2>Time</h2><span>White = committed · purple = proposed</span></header>
    <div className={styles.grid} style={{height:props.gridHeight}}>
      {hours.map((hour)=><div className={styles.hour} style={{top:(hour-props.startHour)*HOUR_HEIGHT}} key={hour}><span>{hourLabel(hour)}</span></div>)}
      {props.selectedToday&&props.nowMinute!==null?<div className={styles.now} style={{top:offset(props.nowMinute)}} data-clock-now-line="true"><span>NOW</span></div>:null}
      {props.timedCues.map((item)=>{const minute=clockLocalMinuteOfDay(item.scheduledAt,DEFAULT_ATLAS_FARM_TIME_ZONE);if(minute===null)return null;return <div className={styles.cue} style={{top:offset(minute)}} key={item.id} data-clock-timed-cue="true" data-clock-day-reservation="point" data-timing-class={item.mobility.timingClass}><i aria-hidden="true"/><div><small>{minuteLabel(minute)} · Cue · {atlasTimingClassLabel(item.mobility)}</small><strong>{item.title}</strong>{item.body?<span>{item.body}</span>:null}</div></div>;})}
      {props.blocks.map((block)=>{if(block.startMinute===null||block.decision==="reject")return null;const height=Math.max(38,(block.durationMinutes/60)*HOUR_HEIGHT-2);return <ClockPlanningBlock key={block.id} block={block} dateIso={props.dateIso} top={offset(block.startMinute)} height={height} onMove={props.onMove} onResize={props.onResize} onDecision={props.onDecision} onOverride={props.onOverride} onUnplace={props.onUnplace}/>;})}
    </div>
  </section>;
}
