create or replace function atlas.farm_continuity_audit_v2(
  p_farm_id uuid,
  p_as_of_date date default null
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_base jsonb;
  v_harvest_gap_count integer:=0;
  v_reforecast_gap_count integer:=0;
  v_harvest_items jsonb:='[]'::jsonb;
  v_reforecast_items jsonb:='[]'::jsonb;
  v_high integer:=0;
  v_medium integer:=0;
  v_state text;
begin
  if p_farm_id is null then raise exception 'A farm is required.' using errcode='22023'; end if;
  if auth.uid() is not null and not atlas.is_farm_member(p_farm_id) then raise exception 'Active farm membership required.' using errcode='42501'; end if;

  v_base:=atlas.farm_continuity_audit_v1(p_farm_id,p_as_of_date);

  with complete_harvest as (
    select distinct on (e.production_lot_id) e.production_lot_id,e.id,e.event_date,e.metadata
    from atlas.production_lot_events e
    where e.farm_id=p_farm_id and e.event_type='harvest_recorded' and coalesce(e.metadata->>'harvest_action','')='complete'
    order by e.production_lot_id,e.event_date desc,e.created_at desc
  ), gaps as (
    select ch.*,pl.lot_label
    from complete_harvest ch
    join atlas.production_lots pl on pl.id=ch.production_lot_id
    where not exists(select 1 from atlas.production_lot_events x where x.production_lot_id=ch.production_lot_id and x.event_type in ('cleared','turnover_completed') and x.event_date>=ch.event_date)
      and not exists(
        select 1 from atlas.production_lot_tasks plt join atlas.tasks t on t.id=plt.task_id
        where plt.production_lot_id=ch.production_lot_id and plt.link_role in ('clear','termination_decision','turnover') and t.status in ('open','blocked')
      )
  )
  select count(*)::integer,
    coalesce(jsonb_agg(jsonb_build_object('productionLotId',production_lot_id,'lotLabel',lot_label,'completeHarvestEventId',id,'completeHarvestDate',event_date,'repairOwner','farm_operations_management','reason','Counted complete harvest has no clear, termination-decision, turnover task, or later clear/turnover actual.')),'[]'::jsonb)
  into v_harvest_gap_count,v_harvest_items from gaps;

  with relevant_events as (
    select e.id,e.production_lot_id,e.event_type,e.event_date,pl.lot_label
    from atlas.production_lot_events e join atlas.production_lots pl on pl.id=e.production_lot_id
    where e.farm_id=p_farm_id and e.event_type in (
      'sown','germinated','germination_failed','transplanted','established','establishment_failed',
      'harvest_readiness_confirmed','harvest_not_ready','harvest_recorded','cleared','turnover_completed','labor_actual',
      'water_care_completed','weed_care_completed','pinch_care_completed','support_care_completed','fertility_care_completed'
    )
  ), gaps as (
    select r.* from relevant_events r
    where not exists(select 1 from atlas.production_reforecast_events rf where rf.source_event_id=r.id and rf.reforecast_version='production_actual_reforecast_v1')
  )
  select count(*)::integer,
    coalesce(jsonb_agg(jsonb_build_object('productionLotId',production_lot_id,'lotLabel',lot_label,'sourceEventId',id,'eventType',event_type,'eventDate',event_date,'repairOwner','production_systems','reason','Actual production event is missing its downstream reforecast evidence record.') order by event_date,lot_label),'[]'::jsonb)
  into v_reforecast_gap_count,v_reforecast_items from gaps;

  v_high:=coalesce((v_base->'summary'->>'highPriorityIssueCount')::integer,0)+v_harvest_gap_count;
  v_medium:=coalesce((v_base->'summary'->>'mediumPriorityIssueCount')::integer,0)+v_reforecast_gap_count;
  v_state:=case when v_high>0 then 'high_priority_continuity_attention' when v_medium>0 then 'continuity_attention' else 'no_actionable_continuity_gap_detected' end;

  return v_base
    || jsonb_build_object(
      'contractVersion','farm_continuity_audit_v2',
      'state',v_state,
      'summary',(v_base->'summary')||jsonb_build_object(
        'highPriorityIssueCount',v_high,
        'mediumPriorityIssueCount',v_medium,
        'completeHarvestWithoutTerminationPathCount',v_harvest_gap_count,
        'actualEventWithoutReforecastCount',v_reforecast_gap_count
      ),
      'issueFamilies',(v_base->'issueFamilies')||jsonb_build_array(
        jsonb_build_object('key','complete_harvest_without_termination_path','severity','high','count',v_harvest_gap_count,'items',v_harvest_items),
        jsonb_build_object('key','actual_event_without_reforecast','severity','medium','count',v_reforecast_gap_count,'items',v_reforecast_items)
      ),
      'auditCoverage',(v_base->'auditCoverage')||jsonb_build_object(
        'harvestEndToTermination','production_lot_path_audited; legacy crop-cycle harvest path remains partial',
        'actualEventToReforecast','audited'
      )
    );
end;
$function$;

revoke all on function atlas.farm_continuity_audit_v2(uuid,date) from public;
grant execute on function atlas.farm_continuity_audit_v2(uuid,date) to authenticated,service_role;