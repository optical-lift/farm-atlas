"use client";

import { useEffect, useMemo, useState } from "react";

import CropOccupancyBedMap from "@/components/atlas/crop-occupancy-bed-map";
import AtlasTaskCardFrame from "@/components/atlas/task-card-frame";
import TaskPrimaryResultControls from "@/components/atlas/task-primary-result-controls";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import type { AtlasWeedCardContext } from "@/lib/atlas/weed-card-contract";
import { postAtlasTaskTransition } from "@/lib/atlas/task-transition-client";
import styles from "./weed-card-task-focus.module.css";

type Props = { task: AtlasTaskCard; childTasks: AtlasTaskCard[]; assignee: AtlasAssigneeConfig };

function text(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : ""; }
function textList(value: unknown) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()) : []; }
function prettyDate(value: string | null | undefined) { if (!value) return null; const date = new Date(`${value.slice(0,10)}T12:00:00`); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US",{month:"short",day:"numeric"}); }
function returnDestination(fallback: string) { const value = new URLSearchParams(window.location.search).get("returnTo"); return value && value.startsWith("/") && !value.startsWith("//") ? value : fallback; }
function completeTaskExit(taskId: string,fallback: string) { const returnTo=returnDestination(fallback); const event=new CustomEvent("atlas:task-completed",{cancelable:true,detail:{taskId,returnTo}}); window.dispatchEvent(event); if(!event.defaultPrevented) window.location.assign(returnTo); }

export default function VegetationControlTaskDetail({ task, assignee }: Props) {
  const [card,setCard]=useState<AtlasWeedCardContext|null>(null);
  const [contextLoaded,setContextLoaded]=useState(false);
  const [saving,setSaving]=useState<string|null>(null);
  const [unfinishedOpen,setUnfinishedOpen]=useState(false);
  const [message,setMessage]=useState<string|null>(null);

  useEffect(()=>{
    let active=true;
    setContextLoaded(false);
    void fetch(`/api/atlas/weed-card?taskId=${encodeURIComponent(task.task_id)}`,{headers:{Accept:"application/json"},cache:"no-store"})
      .then(async response=>{ const data=await response.json() as {ok?:boolean;card?:AtlasWeedCardContext}; if(!response.ok||!data.ok||!data.card) return null; return data.card; })
      .then(value=>{ if(active) setCard(value); })
      .catch(()=>{ if(active) setCard(null); })
      .finally(()=>{ if(active) setContextLoaded(true); });
    return()=>{active=false;};
  },[task.task_id]);

  const metadata=task.metadata??{};
  const broadProtection=task.task_type==="deer_deterrent" || text(metadata.action_requirement_template_key)==="garlic_deer_deterrent_spray";
  const targetObjectId=text(metadata.target_object_id);
  const targetObjectKey=text(metadata.target_object_key);
  const target=task.objects.find(object=>(targetObjectId&&object.object_id===targetObjectId)||(targetObjectKey&&object.object_key===targetObjectKey))??task.objects[0];
  const specificObjectLabel=card?.objectLabel||target?.object_label||text(metadata.display_location)||text(metadata.execution_place)||text(metadata.display_subject)||"Protection area";
  const protectionArea=text(metadata.execution_place)||text(metadata.display_location)||specificObjectLabel;
  const objectLabel=broadProtection ? (text(metadata.display_subject)||specificObjectLabel) : specificObjectLabel;
  const zoneLabel=broadProtection ? "Elm Farm" : (card?.zoneLabel||text(task.zone_label)||text(metadata.collection_zone)||"Elm Farm");
  const objectType=text(target?.object_type)||"area";
  const method=textList(metadata.execution_how);
  const warnings=Array.from(new Set([
    ...textList(metadata.safety_warnings),
    ...textList(metadata.safety_notes),
    ...textList(metadata.application_warnings),
    ...textList(metadata.warnings),
  ]));
  const resources=task.resource_requirements??[];
  const passLabel=text(metadata.display_detail)||text(metadata.sequence_restart_reason)||text(metadata.execution_do)||task.title;
  const activeCrops=useMemo(()=>broadProtection?[]:(card?.occupancyGroups.flatMap(group=>group.cohorts)??[]),[broadProtection,card]);

  async function transition(kind:"done"|"partial"|"blocked") {
    const note=kind==="done"?"":window.prompt(kind==="partial"?"What is left?":"What problem did you find?","")?.trim();
    if(kind!=="done"&&!note) return;
    try{
      setSaving(kind);setMessage(null);
      await postAtlasTaskTransition({taskId:task.task_id,transition:kind,note:note||undefined,reason:note||undefined,laneKey:task.action_key||undefined,workKey:task.action_key||undefined,payload:{protectCardFamily:true,vegetationControlFamily:true,targetObjectId:target?.object_id||card?.objectId||targetObjectId||undefined,targetObjectKey:targetObjectKey||card?.objectKey||target?.object_key||undefined}});
      if(kind==="done") completeTaskExit(task.task_id,assignee.listPath); else window.location.assign(returnDestination(assignee.listPath));
    }catch(error){setMessage(error instanceof Error?error.message:"Protection result failed.");}
    finally{setSaving(null);}
  }

  const busy=Boolean(saving);
  const completion=(
    <div className={styles.finish}>
      <TaskPrimaryResultControls busy={busy} doneBusy={saving==="done"} unfinishedOpen={unfinishedOpen} onToggleUnfinished={()=>setUnfinishedOpen(open=>!open)} onDone={()=>void transition("done")}>
        <section className="atlas-task-unfinished-panel atlas-task-result-unfinished"><strong>What happened?</strong><div className="atlas-task-unfinished-grid"><button type="button" disabled={busy} onClick={()=>void transition("partial")}>Partly done</button><button type="button" disabled={busy} onClick={()=>void transition("blocked")}>Problem found</button></div></section>
      </TaskPrimaryResultControls>
      {message?<p className={styles.message}>{message}</p>:null}
    </div>
  );

  return(
    <main className={styles.shell} data-atlas-protect-card="resource-grammar-v1" data-atlas-vegetation-control="protect-family-v1">
      <style>{`
        .atlas-protect-target{display:grid;gap:4px;padding:13px 18px;border-bottom:1px solid rgba(215,204,189,.62);background:rgba(242,239,231,.6)}.atlas-protect-target span{color:#858bb8;font-size:8px;font-weight:950;letter-spacing:.12em;text-transform:uppercase}.atlas-protect-target strong{font-size:15px;color:#343542}.atlas-protect-target small{color:#85867f;font-size:9px;font-weight:800}
        .atlas-protect-recipe{display:grid;gap:12px;padding:18px;border-bottom:1px solid rgba(215,204,189,.62);background:#fff}.atlas-protect-recipe>header{display:grid;gap:5px}.atlas-protect-recipe>header span,.atlas-protect-tools>header span,.atlas-protect-warnings>header span{color:#858bb8;font-size:10px;line-height:1;font-weight:950;letter-spacing:.15em;text-transform:uppercase}.atlas-protect-recipe>header strong{color:var(--atlas-text);font-size:19px;line-height:1.1;font-weight:950;letter-spacing:-.035em}.atlas-protect-recipe>header small{color:#7b7c74;font-size:10px;line-height:1.35;font-weight:800}
        .atlas-protect-method{display:grid;gap:0;border:1px solid rgba(207,196,179,.64);border-radius:13px;overflow:hidden}.atlas-protect-method div{padding:10px 11px;border-top:1px solid rgba(207,196,179,.5);background:rgba(255,255,255,.9);color:#4e504b;font-size:11px;line-height:1.35;font-weight:800}.atlas-protect-method div:first-child{border-top:0}
        .atlas-protect-warnings{display:grid;gap:9px;padding:15px 18px;border-bottom:1px solid rgba(215,204,189,.62);background:rgba(244,235,222,.58)}.atlas-protect-warning{margin:0;padding-left:11px;border-left:3px solid rgba(175,139,91,.5);color:#675b4b;font-size:11px;line-height:1.4;font-weight:800}
        .atlas-protect-tools{display:grid;gap:9px;padding:16px 18px;border-bottom:1px solid rgba(215,204,189,.62);background:rgba(248,246,238,.42)}
        .atlas-protect-tool{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;padding:10px 11px;border:1px solid rgba(207,196,179,.64);border-radius:13px;background:#fff}.atlas-protect-tool strong{color:#41433f;font-size:12px;font-weight:920}.atlas-protect-tool small{color:#7b7c74;font-size:9px;font-weight:800;text-align:right}
      `}</style>
      <div className={styles.body}>
        <AtlasTaskCardFrame family="Protect" familyDetail={broadProtection?"deer deterrent":"treatment"} title={objectLabel} subtitle={zoneLabel} timing={task.due_date?`Protect · ${prettyDate(task.due_date)}`:undefined} completion={completion}>
          {!broadProtection&&card?.bedTrail.length?<div className={styles.trail} aria-label={`${objectLabel} bed history`}>{card.bedTrail.map(step=><span key={`${step.taskId}-${step.eventDate}`}><b>{step.eventKind}</b><small>{step.cropLabel||step.title}</small><em>{prettyDate(step.eventDate)}</em></span>)}</div>:null}
          <section className="atlas-protect-target"><span>{broadProtection?"Area":objectType==="bed"?"Bed":"Target"}</span><strong>{broadProtection?protectionArea:objectLabel}</strong><small>{broadProtection?(text(metadata.display_detail)||"protect this area"):targetObjectKey||target?.object_key||zoneLabel}</small></section>
          {!broadProtection&&card?.bedMap?<section className={styles.bedMapSection}><header><span>Bed map</span><small>treatment travels with this bed</small></header><CropOccupancyBedMap map={card.bedMap} variant="notebook"/></section>:null}
          {activeCrops.length?<section className={styles.activeCrops}><header><span>Active Crops</span></header><div className={styles.cropRows}>{activeCrops.map(cohort=><article className={styles.cropRow} key={cohort.cropCycleId}><div className={styles.cropIdentity}><strong>{cohort.displayLabel}</strong><small>{cohort.lifeCycle}</small></div><div className={styles.cropState}><b>{cohort.stageLabel}</b></div></article>)}</div></section>:null}
          {!broadProtection&&!contextLoaded?<section className="atlas-protect-target"><span>Bed context</span><strong>Loading…</strong></section>:null}
          <section className="atlas-protect-recipe"><header><span>{broadProtection?"Recipe":"Action"}</span><strong>{text(metadata.execution_do)||task.title}</strong><small>{passLabel}</small></header>{method.length?<div className="atlas-protect-method">{method.map(line=><div key={line}>{line}</div>)}</div>:null}</section>
          {warnings.length?<section className="atlas-protect-warnings"><header><span>Warnings + safety</span></header>{warnings.map(warning=><p className="atlas-protect-warning" key={warning}>{warning}</p>)}</section>:null}
          <section className="atlas-protect-tools"><header><span>Tools + readiness</span></header>{resources.length?resources.map(resource=><div className="atlas-protect-tool" key={resource.requirement_id}><strong>{resource.resource_label||resource.resource_key||"Resource"}</strong><small>{text(resource.note)||text(resource.status)||text(resource.resource_status)||"required"}</small></div>):<div className="atlas-protect-tool"><strong>Method resource not attached</strong><small>do not infer product</small></div>}</section>
        </AtlasTaskCardFrame>
      </div>
    </main>
  );
}
