create or replace function atlas.sync_future_truth_preflight_farm_v1(p_farm_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_cycle record;
  v_preflight jsonb;
  v_reconciled integer:=0;
  v_future_count integer:=0;
  v_due_count integer:=0;
  v_open_count integer:=0;
  v_results jsonb:='[]'::jsonb;
begin
  if not exists(select 1 from atlas.farms where id=p_farm_id and status='active') then raise exception 'Active farm not found.' using errcode='P0002'; end if;

  for v_cycle in
    select cc.id,cc.crop_label,cc.variety
    from atlas.crop_cycles cc
    where cc.farm_id=p_farm_id and coalesce(cc.lifecycle_status,'active')='active'
      and (
        exists (
          select 1 from atlas.planned_work_occurrences pwo
          where pwo.farm_id=p_farm_id and pwo.state in ('planned','eligible','released')
            and coalesce(pwo.planned_due_date,pwo.earliest_lawful_date,pwo.preferred_start_date) between (now() at time zone 'America/Chicago')::date and (now() at time zone 'America/Chicago')::date+42
            and coalesce(pwo.task_payload->>'task_type','')='transplanting'
            and (
              exists (
                select 1 from jsonb_array_elements_text(
                  case when jsonb_typeof(pwo.task_payload->'metadata'->'crop_cycle_ids')='array' then pwo.task_payload->'metadata'->'crop_cycle_ids' else '[]'::jsonb end
                ) x(value) where x.value=cc.id::text
              )
              or exists (
                select 1 from jsonb_array_elements(
                  case when jsonb_typeof(pwo.relation_payload->'task_crop_cycles')='array' then pwo.relation_payload->'task_crop_cycles' else '[]'::jsonb end
                ) x(value) where x.value->>'crop_cycle_id'=cc.id::text
              )
            )
        )
        or exists (
          select 1 from atlas.state_consequence_instances i join atlas.state_consequence_policies p on p.id=i.policy_id
          where i.subject_kind='crop_cycle' and i.subject_id=cc.id and i.status='open' and p.stable_key='crop-future-transplant-destination-truth-preflight-v1'
        )
      )
    order by cc.id
  loop
    v_preflight:=atlas.crop_cycle_future_transplant_preflight_v1(v_cycle.id,(now() at time zone 'America/Chicago')::date,42,14);
    if coalesce((v_preflight->>'futureOperationPlanned')::boolean,false) then v_future_count:=v_future_count+1; end if;
    if coalesce((v_preflight->>'transplantDestinationPreflightDue')::boolean,false) then v_due_count:=v_due_count+1; end if;
    perform atlas.reconcile_crop_cycle_requirement_state_v1(v_cycle.id);
    v_reconciled:=v_reconciled+1;
    v_results:=v_results||jsonb_build_array(jsonb_build_object('cropCycleId',v_cycle.id,'cropLabel',v_cycle.crop_label,'variety',v_cycle.variety,'preflight',v_preflight));
  end loop;

  select count(*)::integer into v_open_count
  from atlas.state_consequence_instances i join atlas.state_consequence_policies p on p.id=i.policy_id
  where i.farm_id=p_farm_id and i.status='open' and p.stable_key='crop-future-transplant-destination-truth-preflight-v1';

  return jsonb_build_object('contractVersion','sync_future_truth_preflight_farm_v1','farmId',p_farm_id,'asOfDate',(now() at time zone 'America/Chicago')::date,
    'horizonDays',42,'acquisitionLeadDays',14,'reconciledCropCycleCount',v_reconciled,'futureCandidateCount',v_future_count,'duePreflightCount',v_due_count,'openPreflightCount',v_open_count,'candidates',v_results,
    'truthBoundary',jsonb_build_object('futurePlanningEvidenceDoesNotCreateCurrentRequirement',true,'onlyAcquisitionWindowCreatesOwnerGap',true,'cancelledOrMovedFutureWorkIsReconciled',true,'structuredOccurrenceRelationsAreRecognized',true));
end;
$function$;

revoke all on function atlas.sync_future_truth_preflight_farm_v1(uuid) from public,anon,authenticated;
grant execute on function atlas.sync_future_truth_preflight_farm_v1(uuid) to service_role;