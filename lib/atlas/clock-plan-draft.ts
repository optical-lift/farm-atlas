import { buildClockTaskRanges, clockLocalMinuteOfDay } from "@/lib/atlas/clock-layout";
import type { AtlasClockProposalBlock, AtlasClockProposalPlan } from "@/lib/atlas/clock-proposal";
import { atlasClockReservationConflicts, type AtlasClockReservation } from "@/lib/atlas/clock-reservations";
import type { AtlasDaySequenceItem } from "@/lib/atlas/day-sequence";

export type AtlasClockDraftDecision = "committed" | "pending" | "accept" | "reject";
export type AtlasClockDraftSource = "committed" | "proposal";
export type AtlasClockDraftWarningCode = "outside_day" | "fixed_time" | "window" | "anchor" | "overlap" | "reservation";
export type AtlasClockDraftWarning = { code: AtlasClockDraftWarningCode; message: string };
type CommittedItem = Extract<AtlasDaySequenceItem, { kind: "committed_task" }>;

export type AtlasClockDraftBlock = {
  id: string; item: CommittedItem; taskId: string | null; source: AtlasClockDraftSource; decision: AtlasClockDraftDecision;
  startMinute: number | null; durationMinutes: number; initialStartMinute: number | null; initialPlannedDurationMinutes: number | null;
  durationSource: "planned" | "estimate" | "planning_default"; startTouched: boolean; durationTouched: boolean;
  overrideWarnings: boolean; warnings: AtlasClockDraftWarning[]; proposalReason: string | null;
};
export type AtlasClockDraftCommitChange = {
  taskId: string; setStart: boolean; startLocalTime: string | null; setDuration: boolean; durationMinutes: number | null;
  expectedStartAt: string | null; expectedDurationMinutes: number | null; source: AtlasClockDraftSource;
  warningCodes: AtlasClockDraftWarningCode[]; overrideWarnings: boolean;
};
export type AtlasClockDraftSummary = { acceptedProposalCount: number; changedCommittedCount: number; warningCount: number; unresolvedWarningCount: number; changeCount: number };

function planningDuration(item: CommittedItem) {
  if (item.plannedDurationMinutes && item.plannedDurationMinutes > 0) return { minutes: item.plannedDurationMinutes, source: "planned" as const };
  if (item.estimatedMinutes && item.estimatedMinutes > 0) return { minutes: item.estimatedMinutes, source: "estimate" as const };
  return { minutes: 30, source: "planning_default" as const };
}
function proposalDraft(block: AtlasClockProposalBlock): AtlasClockDraftBlock {
  return { id:block.id,item:block.item,taskId:block.taskId,source:"proposal",decision:"pending",startMinute:block.startMinute,durationMinutes:block.durationMinutes,initialStartMinute:null,initialPlannedDurationMinutes:null,durationSource:block.durationSource,startTouched:true,durationTouched:true,overrideWarnings:false,warnings:[],proposalReason:block.reason };
}
export function buildAtlasClockPlanDraft(items: CommittedItem[], proposal: AtlasClockProposalPlan) {
  const ranges=buildClockTaskRanges(items,{allowPrivateEstimate:true});
  const committedBlocks:AtlasClockDraftBlock[]=ranges.map((range)=>{const duration=planningDuration(range.item);return {id:`clock-draft:${range.item.id}`,item:range.item,taskId:range.item.taskId,source:"committed",decision:"committed",startMinute:range.startMinute,durationMinutes:duration.minutes,initialStartMinute:range.startMinute,initialPlannedDurationMinutes:range.item.plannedDurationMinutes,durationSource:duration.source,startTouched:false,durationTouched:false,overrideWarnings:false,warnings:[],proposalReason:null};});
  return [...committedBlocks,...proposal.blocks.map(proposalDraft)].sort((a,b)=>(a.startMinute??10000)-(b.startMinute??10000)||a.item.sequenceOrder-b.item.sequenceOrder);
}

export function reconcileAtlasClockPlanDraftWithProposal(blocks: AtlasClockDraftBlock[], items: CommittedItem[], proposal: AtlasClockProposalPlan) {
  const baseline = buildAtlasClockPlanDraft(items, proposal);
  const currentCommitted = new Map(blocks.filter((block) => block.source === "committed").map((block) => [block.taskId ?? block.id, block]));
  const currentProposal = new Map(blocks.filter((block) => block.source === "proposal").map((block) => [block.taskId ?? block.id, block]));
  const next: AtlasClockDraftBlock[] = [];

  for (const block of baseline.filter((candidate) => candidate.source === "committed")) {
    next.push(currentCommitted.get(block.taskId ?? block.id) ?? block);
  }
  for (const block of baseline.filter((candidate) => candidate.source === "proposal")) {
    const current = currentProposal.get(block.taskId ?? block.id);
    next.push(current && (current.decision === "accept" || current.decision === "reject") ? current : block);
  }
  const baselineProposalKeys = new Set(baseline.filter((block) => block.source === "proposal").map((block) => block.taskId ?? block.id));
  for (const block of blocks) {
    if (block.source === "proposal" && block.decision === "accept" && !baselineProposalKeys.has(block.taskId ?? block.id)) next.push(block);
  }
  return next.sort((a,b)=>(a.startMinute??10000)-(b.startMinute??10000)||a.item.sequenceOrder-b.item.sequenceOrder);
}

function localTimeMinute(value:string|null){if(!value)return null;const match=value.match(/^([01]\d|2[0-3]):([0-5]\d)$/);return match?Number(match[1])*60+Number(match[2]):null;}
function activeBlock(block:AtlasClockDraftBlock){return block.startMinute!==null&&block.decision!=="reject";}
function blockEnd(block:AtlasClockDraftBlock){return block.startMinute===null?null:block.startMinute+block.durationMinutes;}
function blockChanged(block:AtlasClockDraftBlock){return block.source==="proposal"?block.decision==="accept":block.startTouched||block.durationTouched;}
function taskBlock(taskId:string|null,blocks:AtlasClockDraftBlock[]){return taskId?blocks.find(candidate=>candidate.taskId===taskId&&activeBlock(candidate))??null:null;}

function warningsForBlock(block:AtlasClockDraftBlock,blocks:AtlasClockDraftBlock[],reservations:AtlasClockReservation[]){
 if(!activeBlock(block))return [] as AtlasClockDraftWarning[];
 const warnings:AtlasClockDraftWarning[]=[],start=block.startMinute as number,end=start+block.durationMinutes,mobility=block.item.mobility;
 const shouldValidate=block.source==="proposal"||block.startTouched||block.durationTouched;
 if(start<0||end>1440)warnings.push({code:"outside_day",message:"This block extends outside the Elm Farm service day."});
 if(shouldValidate&&mobility.constraintClass==="fixed"){
   const fixed=localTimeMinute(mobility.fixedLocalTime)??clockLocalMinuteOfDay(mobility.windowStartAt);
   if(fixed!==null&&start!==fixed)warnings.push({code:"fixed_time",message:"This move breaks the task's recorded fixed clock time."});
 }
 if(shouldValidate&&mobility.constraintClass==="windowed"){
   const windowStart=clockLocalMinuteOfDay(mobility.windowStartAt),windowEnd=clockLocalMinuteOfDay(mobility.windowEndAt);
   if((windowStart!==null&&start<windowStart)||(windowEnd!==null&&end>windowEnd))warnings.push({code:"window",message:"This block falls outside the task's recorded execution window."});
 }
 if(shouldValidate&&mobility.constraintClass==="anchored"&&mobility.anchorTaskId&&mobility.anchorRelation){
   const anchor=taskBlock(mobility.anchorTaskId,blocks);
   if(anchor&&anchor.startMinute!==null){
     const anchorEnd=blockEnd(anchor)??anchor.startMinute,gap=mobility.minimumGapMinutes??0;
     const obeys=mobility.anchorRelation==="before"?end+gap<=anchor.startMinute:start>=anchorEnd+gap;
     if(!obeys)warnings.push({code:"anchor",message:`This move breaks the recorded ${mobility.anchorRelation}-task anchor${gap?` and ${gap}-minute gap`:""}.`});
   }
 }
 if(shouldValidate){
   const collision=blocks.some(other=>{if(other.id===block.id||!activeBlock(other)||other.startMinute===null)return false;const otherEnd=blockEnd(other)??other.startMinute;return start<otherEnd&&end>other.startMinute;});
   if(collision)warnings.push({code:"overlap",message:"This block overlaps another active Clock block."});
   const dayReservation=reservations.find(reservation=>reservation.blocking&&atlasClockReservationConflicts(start,end,reservation));
   if(dayReservation)warnings.push({code:"reservation",message:`This block crosses the real day reservation “${dayReservation.title}”.`});
 }
 return warnings;
}
export function evaluateAtlasClockPlanDraft(blocks:AtlasClockDraftBlock[],reservations:AtlasClockReservation[]=[]){return blocks.map(block=>({...block,warnings:warningsForBlock(block,blocks,reservations)}));}
export function updateAtlasClockDraftBlock(blocks:AtlasClockDraftBlock[],id:string,patch:Partial<Pick<AtlasClockDraftBlock,"startMinute"|"durationMinutes"|"decision"|"overrideWarnings"|"startTouched"|"durationTouched">>){return blocks.map(block=>block.id===id?{...block,...patch}:block);}
export function clockMinuteToLocalTime(value:number){const minute=Math.max(0,Math.min(1439,Math.round(value)));return `${String(Math.floor(minute/60)).padStart(2,"0")}:${String(minute%60).padStart(2,"0")}`;}
export function buildAtlasClockDraftCommitChanges(blocks:AtlasClockDraftBlock[],reservations:AtlasClockReservation[]=[]):AtlasClockDraftCommitChange[]{
 const evaluated=evaluateAtlasClockPlanDraft(blocks,reservations),changes:AtlasClockDraftCommitChange[]=[];
 for(const block of evaluated){if(!block.taskId)continue;if(block.source==="proposal"&&block.decision!=="accept")continue;if(block.source==="committed"&&!blockChanged(block))continue;const unplaced=block.startMinute===null;changes.push({taskId:block.taskId,setStart:block.source==="proposal"||block.startTouched,startLocalTime:unplaced?null:clockMinuteToLocalTime(block.startMinute as number),setDuration:block.source==="proposal"||block.durationTouched||unplaced,durationMinutes:unplaced?null:block.durationMinutes,expectedStartAt:block.item.plannedStartAt,expectedDurationMinutes:block.item.plannedDurationMinutes,source:block.source,warningCodes:block.warnings.map(w=>w.code),overrideWarnings:block.overrideWarnings});}
 return changes;
}
export function summarizeAtlasClockDraft(blocks:AtlasClockDraftBlock[],reservations:AtlasClockReservation[]=[]):AtlasClockDraftSummary{const evaluated=evaluateAtlasClockPlanDraft(blocks,reservations),changes=buildAtlasClockDraftCommitChanges(evaluated,reservations),warningChanges=changes.filter(change=>change.warningCodes.length>0);return {acceptedProposalCount:evaluated.filter(block=>block.source==="proposal"&&block.decision==="accept").length,changedCommittedCount:evaluated.filter(block=>block.source==="committed"&&blockChanged(block)).length,warningCount:warningChanges.reduce((sum,change)=>sum+change.warningCodes.length,0),unresolvedWarningCount:warningChanges.filter(change=>!change.overrideWarnings).length,changeCount:changes.length};}
export function atlasClockDraftVisibleTaskIds(blocks:AtlasClockDraftBlock[]){return new Set(blocks.filter(block=>block.source==="proposal"&&block.decision!=="reject"&&block.startMinute!==null).map(block=>block.item.id));}
export function atlasClockDraftReturnedTaskIds(blocks:AtlasClockDraftBlock[]){return new Set(blocks.filter(block=>block.source==="committed"&&block.startTouched&&block.startMinute===null).map(block=>block.item.id));}
