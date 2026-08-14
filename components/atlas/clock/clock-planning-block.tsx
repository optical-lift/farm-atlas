"use client";
import Link from "next/link";
import {useRef,type PointerEvent} from "react";
import type {AtlasClockDraftBlock,AtlasClockDraftDecision} from "@/lib/atlas/clock-plan-draft";
import styles from "./clock-surface-v2.module.css";

const PX=64;
type Drag={id:number;y:number;start:number;duration:number;mode:"move"|"resize"};
function label(value:number){const m=((Math.round(value)%1440)+1440)%1440,h=Math.floor(m/60);return `${h%12||12}:${String(m%60).padStart(2,"0")} ${h>=12?"PM":"AM"}`;}
function href(taskId:string,dateIso:string){const back=`/clock?date=${encodeURIComponent(dateIso)}`;return `/task-focus/${encodeURIComponent(taskId)}?returnTo=${encodeURIComponent(back)}`;}

export default function ClockPlanningBlock(props:{block:AtlasClockDraftBlock;dateIso:string;top:number;height:number;onMove:(id:string,start:number)=>void;onResize:(id:string,duration:number)=>void;onDecision:(id:string,decision:AtlasClockDraftDecision)=>void;onOverride:(id:string,value:boolean)=>void;onUnplace:(id:string)=>void;}){
 const {block}=props,drag=useRef<Drag|null>(null);if(block.startMinute===null||block.decision==="reject")return null;
 const purple=block.source==="proposal",warning=block.warnings.length>0;
 function begin(event:PointerEvent<HTMLButtonElement>,mode:Drag["mode"]){event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);drag.current={id:event.pointerId,y:event.clientY,start:block.startMinute as number,duration:block.durationMinutes,mode};}
 function move(event:PointerEvent<HTMLButtonElement>){const d=drag.current;if(!d||d.id!==event.pointerId)return;const delta=Math.round((((event.clientY-d.y)/PX)*60)/5)*5;if(d.mode==="move")props.onMove(block.id,Math.max(0,Math.min(1440-block.durationMinutes,d.start+delta)));else props.onResize(block.id,Math.max(5,Math.min(720,d.duration+delta)));}
 function end(){drag.current=null;}
 return <div className={`${styles.timedTask} ${styles.planningBlock}`} style={{top:props.top,height:props.height,left:"61px",width:"calc(100% - 69px)",overflow:"visible"}} data-clock-plan-block="true" data-clock-plan-source={block.source} data-clock-plan-decision={block.decision} data-clock-readiness-independent="true" data-timing-class={purple?"potential":block.item.mobility.timingClass} data-warning={warning?"true":"false"}>
  <Link className={styles.planningBlockLink} href={block.taskId?href(block.taskId,props.dateIso):`/clock?date=${props.dateIso}`}><small>{purple?"Atlas proposes":"Committed draft"} · {label(block.startMinute)}–{label(block.startMinute+block.durationMinutes)}</small><strong>{block.item.title}</strong><span>{block.durationMinutes}m{block.proposalReason?` · ${block.proposalReason}`:""}</span></Link>
  <button type="button" className={styles.dragHandle} aria-label={`Drag ${block.item.title} earlier or later`} onPointerDown={e=>begin(e,"move")} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>↕</button>
  <button type="button" className={styles.resizeHandle} aria-label={`Resize duration for ${block.item.title}`} onPointerDown={e=>begin(e,"resize")} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>⋮</button>
  <details className={styles.planDetails}><summary>Plan</summary><div className={styles.planPopover}>
   <div className={styles.planButtons}><button onClick={()=>props.onMove(block.id,Math.max(0,block.startMinute as number-15))}>−15m</button><button onClick={()=>props.onMove(block.id,Math.min(1440-block.durationMinutes,(block.startMinute as number)+15))}>+15m</button><button onClick={()=>props.onResize(block.id,Math.max(5,block.durationMinutes-15))}>Shorter</button><button onClick={()=>props.onResize(block.id,Math.min(720,block.durationMinutes+15))}>Longer</button></div>
   {purple?<div className={styles.planButtons}>{block.decision==="accept"?<button onClick={()=>props.onDecision(block.id,"pending")}>Undo use</button>:<button className={styles.planPrimary} onClick={()=>props.onDecision(block.id,"accept")}>Use this</button>}<button onClick={()=>props.onDecision(block.id,"reject")}>Not this</button></div>:<button className={styles.planUnplace} onClick={()=>props.onUnplace(block.id)}>Return to Unplaced</button>}
   {warning?<div className={styles.planWarning} data-clock-plan-warning="true"><strong>Timing warning</strong><ul>{block.warnings.map(w=><li key={w.code}>{w.message}</li>)}</ul><button className={block.overrideWarnings?styles.planOverrideActive:""} onClick={()=>props.onOverride(block.id,!block.overrideWarnings)}>{block.overrideWarnings?"Override recorded":"Override warning"}</button></div>:null}
   <small className={styles.planState}>{purple?"Purple stays proposed until Commit plan.":"White task truth is unchanged until Commit plan."}</small>
  </div></details>
 </div>;
}
