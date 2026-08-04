-- Barn Beds end at BB10. Remove BB11 from every live registry while retaining a hidden
-- tombstone UUID required by append-only rhythm satisfaction history.

begin;

do $migration$
declare
  v_farm_id uuid;
  v_zone_id uuid;
  v_bb11_id uuid;
  v_parent_task_id uuid;
begin
  select id into v_farm_id from atlas.farms where stable_key='elm_farm';
  select id into v_zone_id from atlas.zones where farm_id=v_farm_id and stable_key='barn_beds';
  select id into v_bb11_id from atlas.growing_objects
  where farm_id=v_farm_id and stable_key in ('bb_11','historical_tombstone_nonexistent_bb11')
  order by case when stable_key='bb_11' then 0 else 1 end limit 1;
  select id into v_parent_task_id from atlas.tasks
  where farm_id=v_farm_id and metadata->>'task_key'='owner_20260825_sow_procut_horizon_bb10' limit 1;

  if v_bb11_id is not null then
    update atlas.tasks task
    set status='archived',due_date=null,parent_task_id=null,
        metadata=coalesce(task.metadata,'{}'::jsonb)||jsonb_build_object(
          'archived_at',now(),'archived_reason','Barn Bed 11 does not exist; canonical Barn Beds end at BB10.'
        ),updated_at=now()
    where task.id in(select link.task_id from atlas.task_objects link where link.object_id=v_bb11_id)
      and task.id is distinct from v_parent_task_id and task.status in('open','blocked');

    update atlas.planned_work_occurrences occurrence
    set state='cancelled',released_task_id=null,
        metadata=coalesce(occurrence.metadata,'{}'::jsonb)||jsonb_build_object(
          'cancelledAt',now(),'cancelledReason','Barn Bed 11 does not exist.'
        ),updated_at=now()
    where occurrence.id in(
      select task.planned_occurrence_id from atlas.tasks task
      where task.metadata->>'archived_reason'='Barn Bed 11 does not exist; canonical Barn Beds end at BB10.'
    ) and occurrence.state<>'completed';

    update atlas.tasks
    set planned_occurrence_id=null,release_policy_id=null,released_at=null
    where metadata->>'archived_reason'='Barn Bed 11 does not exist; canonical Barn Beds end at BB10.';

    update atlas.planned_work_occurrences occurrence
    set state='cancelled',released_task_id=null,
        metadata=coalesce(occurrence.metadata,'{}'::jsonb)||jsonb_build_object(
          'cancelledAt',now(),
          'cancelledReason','Historical BB11 rhythm retired because the physical bed does not exist.',
          'retiredSubjectId',v_bb11_id
        ),updated_at=now()
    where occurrence.source_kind='rhythm_state' and occurrence.source_id in(
      select id from atlas.rhythm_state
      where farm_id=v_farm_id and subject_kind='growing_object' and subject_id=v_bb11_id
    ) and occurrence.state<>'completed';

    update atlas.rhythm_state
    set state='paused',current_task_id=null,current_occurrence_id=null,assigned_user_id=null,
        visibility_scope='system_internal',warning_at=null,due_at=null,failure_at=null,
        state_reason=coalesce(state_reason,'{}'::jsonb)||jsonb_build_object(
          'retiredAt',now(),'retiredReason','Barn Bed 11 does not exist; canonical Barn Beds end at BB10.'
        ),metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'subjectRetired',true,'retiredSubjectId',v_bb11_id,'retiredSubjectKey','bb_11'
        ),last_transition_at=now(),updated_at=now()
    where farm_id=v_farm_id and subject_kind='growing_object' and subject_id=v_bb11_id;

    delete from atlas.field_log_objects where object_id=v_bb11_id;
    delete from atlas.crop_placements where object_id=v_bb11_id;
    delete from atlas.task_crop_cycles where crop_cycle_id in(select id from atlas.crop_cycles where object_id=v_bb11_id);
    delete from atlas.crop_cycles where object_id=v_bb11_id;
    delete from atlas.task_objects where object_id=v_bb11_id;
    delete from atlas.maintenance_objects where object_id=v_bb11_id;
    delete from atlas.object_state where object_id=v_bb11_id;
    delete from atlas.object_map_frames where object_id=v_bb11_id;

    update atlas.growing_objects
    set zone_id=null,stable_key='historical_tombstone_nonexistent_bb11',
        label='Historical Tombstone — Nonexistent Object',object_type='zone_summary',object_mode='historical_tombstone',
        length_ft=null,width_ft=null,area_sqft=null,guest_visible=false,sort_order=999999,geometry=null,
        metadata=jsonb_build_object(
          'canonicalDeleted',true,'deletedAt',now(),
          'deletedReason','Barn Bed 11 never existed; Barn Beds end at BB10.',
          'formerStableKey','bb_11','formerLabel','Barn Bed 11',
          'auditRetentionReason','Append-only rhythm satisfaction history retains this UUID.'
        ),updated_at=now()
    where id=v_bb11_id;
  end if;

  update atlas.zones
  set metadata=jsonb_set(coalesce(metadata,'{}'::jsonb),'{notes}',to_jsonb('10 Barn Beds, about 18 ft x 3 ft each.'::text),true),
      updated_at=now()
  where id=v_zone_id;
end;
$migration$;

commit;
