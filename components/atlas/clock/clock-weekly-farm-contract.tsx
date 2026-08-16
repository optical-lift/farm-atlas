"use client";

import { useEffect, useMemo, useState } from "react";

import { readAtlasWeeklyFarmContract, type AtlasWeeklyFarmContract } from "@/lib/atlas/worker-weekly-contract-client";
import styles from "./clock-surface-v2.module.css";

function hours(minutes: number | null) {
  if (minutes === null) return "—";
  const value = Math.round((minutes / 60) * 10) / 10;
  return `${value}h`;
}

function stateCopy(contract: AtlasWeeklyFarmContract) {
  switch (contract.state) {
    case "capacity_anchor_required":
      return {
        title: "Weekly capacity not established",
        note: "Atlas knows the work burden, but it will not claim this week is feasible until the Owner authors the Farm Hand's real Worker Day Shape.",
      };
    case "capacity_policy_conflict":
      return { title: "Weekly capacity policy conflict", note: "More than one Day Shape applies. Resolve the policy conflict before Atlas assigns confidence to this week's capacity." };
    case "work_estimate_required":
      return { title: "Work duration still unknown", note: "The weekly work set contains required work without a trustworthy duration. Atlas will not call the week feasible until that uncertainty is resolved." };
    case "readiness_risk":
      return { title: "Weekly work has readiness risk", note: "Known capacity can hold the work, but one or more required items are blocked by prerequisites, resources, or current task state." };
    case "recovery_required":
      return { title: "Normal week is short", note: "Known required work exceeds normal planned capacity. Recovery capacity could cover the arithmetic shortfall, but Atlas keeps that recovery time separate rather than silently spending it." };
    case "capacity_conflict":
      return { title: "Weekly capacity conflict", note: "Known required work exceeds the Farm Hand's normal planned capacity. The week needs an explicit continuity decision before daily planning can be trusted." };
    case "feasible":
      return { title: "Weekly contract is feasible", note: "Known required work fits inside Owner-authored normal capacity before any day-level Clock placement." };
    default:
      return { title: "Weekly contract needs review", note: "Atlas has not established a trustworthy weekly feasibility state yet." };
  }
}

export default function ClockWeeklyFarmContract(props: {
  dateIso: string;
  canManage: boolean;
  refreshToken: string;
  onError: (message: string | null) => void;
}) {
  const [contract, setContract] = useState<AtlasWeeklyFarmContract | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!props.canManage) return;
    let active = true;
    setLoading(true);
    void readAtlasWeeklyFarmContract(props.dateIso)
      .then((value) => { if (active) { setContract(value); props.onError(null); } })
      .catch((error) => { if (active) { setContract(null); props.onError(error instanceof Error ? error.message : "Atlas could not load the Weekly Farm Contract."); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [props.canManage, props.dateIso, props.refreshToken]);

  const copy = useMemo(() => contract ? stateCopy(contract) : null, [contract]);
  if (!props.canManage) return null;

  return <section className={styles.taskShell} data-weekly-farm-contract="true">
    <small style={{ display: "block", color: "#7b80a7", fontSize: 8, fontWeight: 950, letterSpacing: ".12em" }}>WEEKLY FARM CONTRACT</small>
    {loading && !contract ? <strong style={{ display: "block", marginTop: 4, fontSize: 12 }}>Reading the week…</strong> : null}
    {contract && copy ? <>
      <strong style={{ display: "block", marginTop: 4, fontSize: 12 }}>{copy.title}</strong>
      <span style={{ display: "block", marginTop: 3, color: "#777983", fontSize: 9, lineHeight: 1.4 }}>{copy.note}</span>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 6, marginTop: 9 }}>
        <div><small style={{ color: "#8a8b94", fontSize: 7, fontWeight: 900 }}>REQUIRED</small><strong style={{ display: "block", marginTop: 2, fontSize: 11 }}>{hours(contract.requiredEstimatedMinutes)}</strong></div>
        <div><small style={{ color: "#8a8b94", fontSize: 7, fontWeight: 900 }}>PLANNED CAPACITY</small><strong style={{ display: "block", marginTop: 2, fontSize: 11 }}>{hours(contract.plannedCapacityMinutes)}</strong></div>
        <div><small style={{ color: "#8a8b94", fontSize: 7, fontWeight: 900 }}>RECOVERY</small><strong style={{ display: "block", marginTop: 2, fontSize: 11 }}>{hours(contract.recoveryCapacityMinutes)}</strong></div>
      </div>
      <span style={{ display: "block", marginTop: 7, color: "#85868d", fontSize: 8, lineHeight: 1.4 }}>
        {contract.requiredWorkCount} required/carryover item{contract.requiredWorkCount === 1 ? "" : "s"}
        {contract.requiredUnestimatedCount ? ` · ${contract.requiredUnestimatedCount} without a duration estimate` : ""}
        {contract.requiredReadinessRiskCount ? ` · ${contract.requiredReadinessRiskCount} readiness risk${contract.requiredReadinessRiskCount === 1 ? "" : "s"}` : ""}
        {` · ${contract.weekStart}–${contract.weekEnd}`}
      </span>
      <span style={{ display: "block", marginTop: 4, color: "#92939b", fontSize: 7.5, lineHeight: 1.35 }}>
        Weekly feasibility is read before day assignment. Saturday/Sunday capacity is never counted as normal planned capacity.
      </span>
    </> : null}
  </section>;
}
