import Link from "next/link";

import type { AtlasClockProposalUnresolved } from "@/lib/atlas/clock-proposal";
import type { AtlasDaySequenceItem, AtlasDaySequenceWindow } from "@/lib/atlas/day-sequence";
import { atlasTimingClassLabel } from "@/lib/atlas/timing-mobility";
import styles from "./clock-surface-v2.module.css";

const windowLabels:Record<AtlasDaySequenceWindow,string>={morning:"Morning",afternoon:"Afternoon",evening:"Evening"};
function taskHref(taskId:string,dateIso:string){const returnTo=`/clock?date=${encodeURIComponent(dateIso)}`;return `/task-focus/${encodeURIComponent(taskId)}?returnTo=${encodeURIComponent(returnTo)}`;}

export default function ClockPlanningUnplaced(props:{
  items:AtlasDaySequenceItem[];dateIso:string;visibleProposalTaskIds:Set<string>;returnedTaskIds:Set<string>;proposalUnresolved:AtlasClockProposalUnresolved[];
}){
  const unplaced=props.items.filter((item)=>{
    if(item.kind==="committed_task"){
      if(props.returnedTaskIds.has(item.id))return true;
      return !item.plannedStartAt&&!props.visibleProposalTaskIds.has(item.id);
    }
    return item.kind==="cue"&&item.positionResolved&&item.anchorKind!=="at_time"&&!["resolved","dismissed","stale"].includes(item.status);
  });
  const waitingCount=unplaced.filter((item)=>item.kind==="committed_task").length;
  return <section className={styles.unplaced} aria-label="Still unplaced" data-clock-plan-unplaced="true">
    <header><h2>Still unplaced</h2><span>{waitingCount} tasks need a time</span></header>
    <div className={styles.unplacedList}>
      {!unplaced.length&&!props.proposalUnresolved.length?<div className={styles.empty}>Everything in this draft has a Clock position.</div>:null}
      {props.proposalUnresolved.map((entry)=><div className={`${styles.taskShell} ${styles.planUnresolved}`} key={`unresolved:${entry.id}`} data-clock-proposal-unresolved="true"><small>Atlas left unplaced</small><strong>{entry.title}</strong><span>{entry.reason}</span></div>)}
      {unplaced.map((item,index)=>{
        const previous=unplaced[index-1];const showWindow=item.dayWindow&&(!previous||previous.dayWindow!==item.dayWindow);
        return <div key={item.id}>{showWindow?<div className={styles.window}>{windowLabels[item.dayWindow as AtlasDaySequenceWindow]}</div>:null}
          {item.kind==="committed_task"?<div className={styles.taskShell} data-clock-draft-unplaced={props.returnedTaskIds.has(item.id)?"true":"false"} data-timing-class={item.mobility.timingClass}><Link className={styles.task} href={item.taskId?taskHref(item.taskId,props.dateIso):`/clock?date=${props.dateIso}`}><small>{props.returnedTaskIds.has(item.id)?"Draft · returned to Unplaced":"Committed · no Clock time"}</small><span className={styles.mobility}>{atlasTimingClassLabel(item.mobility)}</span><strong>{item.title}</strong>{item.location?<span>{item.location}</span>:null}</Link></div>
          :item.kind==="cue"?<div className={styles.sequenceCue}><small>Cue · {item.anchorKind.replaceAll("_"," ")}</small><strong>{item.title}</strong></div>:null}
        </div>;
      })}
    </div>
  </section>;
}
