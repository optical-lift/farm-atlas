create or replace function atlas.harvest_readiness_round_sync_v1(
  p_farm_id uuid,
  p_as_of_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_as_of date:=coalesce(p_as_of_date,current_date);
  v_group record;
  v_zone_label text;
  v_parent_id uuid;
  v_occurrence_id uuid;
  v_materialized jsonb;
  v_cohort_hash text;
  v_child_json jsonb;
  v_created integer:=0;
  v_reused integer:=0;
  v_grouped integer:=0;
  v_was_created boolean:=false;
  v_groups jsonb:='[]'::jsonb;
begin
  if p_farm_id is null then raise exception 'A farm is required.' using errcode='22023'; end if;

  for v_group in
    with child_zone as (
      select
        t.id task_id,
        t.assigned_membership_id,
        t.assigned_user_id,
        min(go.zone_id::text)::uuid zone_id,
        count(distinct go.zone_id)::integer zone_count
      from atlas.tasks t
      join atlas.task_crop_cycles tc on tc.task_id=t.id
      join atlas.crop_cycles cc on cc.id=tc.crop_cycle_id
      join atlas.growing_objects go on go.id=cc.object_id
      where t.farm_id=p_farm_id
        and t.status='open'
        and t.task_type='harvest_watch'
        and coalesce(t.metadata->>'harvest_watch_mode','')='boundary_observation'
        and t.due_date is not null
        and t.due_date<=v_as_of
        and t.visibility_scope='assigned_worker'
        and t.assigned_membership_id is not null
        and t.parent_task_id is null
      group by t.id,t.assigned_membership_id,t.assigned_user_id
      having count(distinct go.zone_id)=1
    )
    select
      cz.zone_id,
      cz.assigned_membership_id,
      min(cz.assigned_user_id::text)::uuid assigned_user_id,
      array_agg(cz.task_id order by cz.task_id) child_ids,
      count(*)::integer child_count
    from child_zone cz
    group by cz.zone_id,cz.assigned_membership_id
    order by cz.zone_id,cz.assigned_membership_id
  loop
    v_was_created:=false;
    select z.label into v_zone_label from atlas.zones z where z.id=v_group.zone_id;
    if v_zone_label is null then continue; end if;

    select t.id into v_parent_id
    from atlas.tasks t
    where t.farm_id=p_farm_id
      and t.status in ('open','blocked')
      and t.assigned_membership_id=v_group.assigned_membership_id
      and t.zone_id=v_group.zone_id
      and t.due_date=v_as_of
      and coalesce(t.metadata->>'task_style','')='harvest_readiness_round'
    order by t.created_at,t.id
    limit 1;

    if v_parent_id is null then
      v_cohort_hash:=md5(array_to_string(v_group.child_ids,','));
      v_occurrence_id:=atlas.plan_work_occurrence_v1(
        p_farm_id=>p_farm_id,
        p_definition_key=>'harvest-readiness-round:'||v_group.zone_id::text,
        p_policy_key=>'harvest-readiness-round:'||v_group.zone_id::text||':one-active',
        p_occurrence_key=>'harvest-readiness-round:'||v_group.zone_id::text||':'||v_group.assigned_membership_id::text||':'||v_as_of::text||':'||v_cohort_hash,
        p_title=>'Harvest readiness round · '||v_zone_label,
        p_task_type=>'field_check',
        p_due_date=>v_as_of,
        p_source_kind=>'harvest_readiness_round',
        p_source_id=>v_group.zone_id,
        p_gate_type=>'time_window',
        p_horizon_days=>0,
        p_maximum_active_instances=>1,
        p_task_payload=>jsonb_build_object(
          'title','Harvest readiness round · '||v_zone_label,
          'task_type','field_check',
          'priority','high',
          'zone_id',v_group.zone_id,
          'note','Walk this zone once. Open each crop check inside the round and record what is physically true before moving on.',
          'action_key','harvest_readiness_round',
          'work_class','harvest',
          'visibility_scope','assigned_worker',
          'assigned_membership_id',v_group.assigned_membership_id,
          'assigned_user_id',v_group.assigned_user_id,
          'origin_kind','generated',
          'task_scope','farm_operation',
          'metadata',jsonb_build_object(
            'task_style','harvest_readiness_round',
            'estimated_minutes',30,
            'estimate_source','provisional:existing_field_check_rule',
            'round_date',v_as_of,
            'round_zone_id',v_group.zone_id,
            'round_zone_label',v_zone_label,
            'structured_child_results_required',true,
            'parent_done_requires_children_resolved',true,
            'physical_round_carrier_only',true,
            'children_hold_crop_truth',true,
            'work_window_key','anytime'
          )
        ),
        p_relation_payload=>'{}'::jsonb,
        p_gate_config=>jsonb_build_object('requiresDueHarvestObservationChildren',true),
        p_not_before_date=>v_as_of,
        p_metadata=>jsonb_build_object(
          'truthBoundary','harvest_readiness_zone_round_v1',
          'zoneId',v_group.zone_id,
          'zoneLabel',v_zone_label
        )
      );

      update atlas.planned_work_occurrences
      set work_lane='process_continuation',
          commitment_kind='dependency',
          effort_units=1,
          earliest_lawful_date=v_as_of,
          preferred_start_date=v_as_of,
          miss_consequence=jsonb_build_object(
            'class','biological_deadline',
            'detail','Harvest readiness remains physically unknown for unresolved crop observations in this zone until the round is performed and each crop result is recorded.'
          ),
          temporal_contract_source='harvest_readiness_zone_round_v1',
          temporal_contract_updated_at=now(),
          state='eligible',
          gate_satisfied_at=coalesce(gate_satisfied_at,now()),
          updated_at=now()
      where id=v_occurrence_id;

      v_materialized:=atlas.materialize_specific_work_occurrence_v1(v_occurrence_id,v_as_of);
      v_parent_id=nullif(v_materialized->>'taskId','')::uuid;
      if v_parent_id is null then
        v_groups:=v_groups||jsonb_build_array(jsonb_build_object(
          'zoneId',v_group.zone_id,'zoneLabel',v_zone_label,'state','parent_not_materialized','materialization',v_materialized,'childCount',v_group.child_count
        ));
        continue;
      end if;

      update atlas.tasks
      set operation_class='inspect_assess',
          operation_class_source='harvest_readiness_zone_round_v1',
          metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
            'operation_class','inspect_assess',
            'round_date',v_as_of,
            'round_zone_id',v_group.zone_id,
            'round_zone_label',v_zone_label
          )
      where id=v_parent_id;
      v_created:=v_created+1;
      v_was_created:=true;
    else
      v_reused:=v_reused+1;
    end if;

    update atlas.tasks child
    set parent_task_id=v_parent_id,
        metadata=coalesce(child.metadata,'{}'::jsonb)||jsonb_build_object(
          'harvest_readiness_round_role','observation_child',
          'harvest_readiness_round_parent_id',v_parent_id,
          'harvest_readiness_round_date',v_as_of,
          'harvest_readiness_round_zone_id',v_group.zone_id,
          'harvest_readiness_round_zone',v_zone_label,
          'structured_harvest_result_required',true
        )
    where child.id=any(v_group.child_ids)
      and child.parent_task_id is null;
    get diagnostics v_grouped = row_count;

    select coalesce(jsonb_agg(x.task_id order by x.task_id),'[]'::jsonb)
    into v_child_json
    from (
      select distinct value::uuid task_id
      from jsonb_array_elements_text(coalesce((select metadata->'round_child_task_ids' from atlas.tasks where id=v_parent_id),'[]'::jsonb)) old_ids(value)
      union
      select unnest(v_group.child_ids)
    ) x;

    update atlas.tasks
    set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
      'round_child_task_ids',v_child_json,
      'round_child_count',jsonb_array_length(v_child_json),
      'round_sync_at',now()
    )
    where id=v_parent_id;

    v_groups:=v_groups||jsonb_build_array(jsonb_build_object(
      'zoneId',v_group.zone_id,
      'zoneLabel',v_zone_label,
      'parentTaskId',v_parent_id,
      'state',case when v_was_created then 'round_created' else 'round_reused' end,
      'candidateChildCount',v_group.child_count,
      'newlyGroupedChildCount',v_grouped,
      'roundChildCount',jsonb_array_length(v_child_json)
    ));
  end loop;

  return jsonb_build_object(
    'contractVersion','harvest_readiness_round_sync_v1',
    'farmId',p_farm_id,
    'asOfDate',v_as_of,
    'createdRoundCount',v_created,
    'reusedRoundCount',v_reused,
    'groups',v_groups,
    'truthBoundary',jsonb_build_object(
      'onlyDuePhysicalObservationsAreGrouped',true,
      'futureRechecksRemainFutureObligationsUntilTheirDateArrives',true,
      'roundCarriesPhysicalVisitLabor',true,
      'childrenRetainCropSpecificObservationTruth',true,
      'zoneComesFromCanonicalGrowingObjectPlacement',true,
      'roundEstimateIsProvisionalNotActual',true
    )
  );
end;
$function$;