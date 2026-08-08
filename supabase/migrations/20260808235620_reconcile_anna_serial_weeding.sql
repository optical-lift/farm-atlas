create or replace function atlas.reconcile_anna_serial_weeding_v1(p_farm_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,atlas as $function$
declare
  v_anna uuid; v_keeper uuid; v_keeper_occ uuid; v_next integer; v_retracted integer:=0; v_added integer:=0; r record;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_farm_id::text||':anna_weeding_rotation',0));
  select id into v_anna from atlas.farm_memberships
  where farm_id=p_farm_id and worker_key='anna' and active=true order by created_at limit 1;
  if v_anna is null then return jsonb_build_object('retracted',0,'queuedAdded',0,'reason','anna_membership_missing'); end if;

  update atlas.task_release_queue_items qi
  set state='active',task_id=o.released_task_id,activated_at=coalesce(qi.activated_at,now()),updated_at=now(),
      metadata=coalesce(qi.metadata,'{}'::jsonb)||jsonb_build_object('promoted_by','reconcile_anna_serial_weeding_v1','promoted_at',now())
  from atlas.planned_work_occurrences o join atlas.tasks t on t.id=o.released_task_id
  where qi.farm_id=p_farm_id and qi.queue_key='anna_weeding_rotation' and qi.state='queued'
    and qi.planned_occurrence_id=o.id and t.status in ('open','blocked') and t.assigned_membership_id=v_anna and t.action_key='weed'
    and not exists(select 1 from atlas.task_release_queue_items a where a.farm_id=p_farm_id and a.queue_key='anna_weeding_rotation' and a.state='active')
    and qi.position=(select min(h.position) from atlas.task_release_queue_items h where h.farm_id=p_farm_id and h.queue_key='anna_weeding_rotation' and h.state='queued');

  select qi.task_id,qi.planned_occurrence_id into v_keeper,v_keeper_occ
  from atlas.task_release_queue_items qi join atlas.tasks t on t.id=qi.task_id
  where qi.farm_id=p_farm_id and qi.queue_key='anna_weeding_rotation' and qi.state='active' and t.status in ('open','blocked')
  order by qi.position limit 1;

  if v_keeper is null then
    select t.id,t.planned_occurrence_id into v_keeper,v_keeper_occ
    from atlas.tasks t
    where t.farm_id=p_farm_id and t.assigned_membership_id=v_anna and t.status in ('open','blocked') and t.action_key='weed' and t.parent_task_id is null
    order by t.due_date nulls last,t.released_at nulls last,t.created_at,t.id limit 1;
    if v_keeper is not null and v_keeper_occ is not null then
      if exists(select 1 from atlas.task_release_queue_items where planned_occurrence_id=v_keeper_occ) then
        update atlas.task_release_queue_items set state='active',task_id=v_keeper,activated_at=coalesce(activated_at,now()),updated_at=now() where planned_occurrence_id=v_keeper_occ;
      else
        select coalesce(max(position),0)+1 into v_next from atlas.task_release_queue_items where farm_id=p_farm_id and queue_key='anna_weeding_rotation';
        insert into atlas.task_release_queue_items(farm_id,queue_key,task_id,planned_occurrence_id,position,state,initial_batch,original_due_date,activated_at,metadata)
        select p_farm_id,'anna_weeding_rotation',t.id,t.planned_occurrence_id,v_next,'active',false,t.due_date,now(),jsonb_build_object('policy','completion_gated_serial','source','serial_weeding_reconcile_v1','seeded_at',now()) from atlas.tasks t where t.id=v_keeper;
      end if;
    end if;
  end if;

  for r in
    select t.id,t.due_date,t.planned_occurrence_id
    from atlas.tasks t
    where t.farm_id=p_farm_id and t.assigned_membership_id=v_anna and t.status in ('open','blocked') and t.action_key='weed'
      and t.parent_task_id is null and t.id is distinct from v_keeper
    order by t.due_date nulls last,t.created_at,t.id for update
  loop
    if r.planned_occurrence_id is null then continue; end if;
    if exists(select 1 from atlas.task_release_queue_items where planned_occurrence_id=r.planned_occurrence_id) then
      update atlas.task_release_queue_items
      set state='queued',task_id=null,activated_at=null,completed_at=null,updated_at=now(),
          metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('requeued_by','reconcile_anna_serial_weeding_v1','requeued_at',now())
      where planned_occurrence_id=r.planned_occurrence_id;
    else
      select coalesce(max(position),0)+1 into v_next from atlas.task_release_queue_items where farm_id=p_farm_id and queue_key='anna_weeding_rotation';
      insert into atlas.task_release_queue_items(farm_id,queue_key,task_id,planned_occurrence_id,position,state,initial_batch,original_due_date,metadata)
      values(p_farm_id,'anna_weeding_rotation',null,r.planned_occurrence_id,v_next,'queued',false,r.due_date,jsonb_build_object('policy','completion_gated_serial','source','serial_weeding_reconcile_v1','seeded_at',now()));
      v_added:=v_added+1;
    end if;
    update atlas.tasks set status='archived',completed_at=null,blocker_text=null,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('serial_weeding_retracted',true,'serial_weeding_retracted_at',now(),
        'serial_weeding_queue_key','anna_weeding_rotation','archived_reason','Waiting behind the current Weed Card in Anna serial weeding.'),updated_at=now()
    where id=r.id;
    update atlas.planned_work_occurrences
    set state='planned',released_task_id=null,released_at=null,gate_satisfied_at=null,
        metadata=(coalesce(metadata,'{}'::jsonb)-'releasedBy'-'releasedLane'-'releasedExecutionDate')||jsonb_build_object(
          'serialWeedingQueued',true,'serialWeedingQueuedAt',now(),'serialWeedingQueueKey','anna_weeding_rotation'),updated_at=now()
    where id=r.planned_occurrence_id;
    update atlas.rhythm_state
    set current_task_id=null,current_occurrence_id=r.planned_occurrence_id,
        state_reason=coalesce(state_reason,'{}'::jsonb)||jsonb_build_object('serialWeedingQueued',true,'serialWeedingQueuedAt',now()),updated_at=now()
    where current_task_id=r.id;
    update atlas.task_release_events
    set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('retractedBy','reconcile_anna_serial_weeding_v1','retractedAt',now(),
      'retractedReason','Only one ordinary Weed Card may be released to Anna at a time.')
    where task_id=r.id;
    v_retracted:=v_retracted+1;
  end loop;

  perform atlas.sync_task_release_queue_summary_v1(p_farm_id,'anna_weeding_rotation');
  return jsonb_build_object('keeperTaskId',v_keeper,'retracted',v_retracted,'queuedAdded',v_added,
    'queuedAfterCurrent',(select count(*) from atlas.task_release_queue_items where farm_id=p_farm_id and queue_key='anna_weeding_rotation' and state='queued'));
end;$function$;

create or replace function atlas.release_eligible_work_v1(p_farm_id uuid,p_as_of_date date default null,p_limit integer default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,atlas as $function$
declare v_today date:=coalesce(p_as_of_date,(now() at time zone 'America/Chicago')::date); v_suppressed uuid[]:='{}'::uuid[]; v_result jsonb; v_serial jsonb;
begin
  select coalesce(array_agg(x.id),'{}'::uuid[]) into v_suppressed from(
    select o.id from atlas.planned_work_occurrences o join atlas.rhythm_state s on o.source_kind='rhythm_state' and o.source_id=s.id
    where o.farm_id=p_farm_id and o.state in ('planned','eligible','failed','releasing') and s.rhythm_key='weed_stewardship'
      and s.subject_kind='growing_object' and not atlas.weed_card_allows_ordinary_work_v1(s.subject_id,v_today) for update of o)x;
  if cardinality(v_suppressed)>0 then
    update atlas.planned_work_occurrences
    set state='cancelled',metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('cancelledBy','weed_physical_need_release_gate','cancelledAt',now(),
      'cancelledAsOfDate',v_today,'cancelledReason','The canonical Weed Card no longer has current physical need.'),updated_at=now()
    where id=any(v_suppressed);
    update atlas.rhythm_state s
    set current_occurrence_id=null,current_task_id=case when s.current_task_id is not null and exists(select 1 from atlas.tasks t where t.id=s.current_task_id and t.status in ('open','blocked')) then s.current_task_id else null end,
        state_reason=coalesce(s.state_reason,'{}'::jsonb)||jsonb_build_object('occurrenceClearedBy','weed_physical_need_release_gate','occurrenceClearedAt',now(),'physicalCondition','clear_or_not_ordinary_weed_work'),updated_at=now()
    where s.current_occurrence_id=any(v_suppressed);
  end if;
  v_result:=atlas.release_eligible_work_without_weed_physical_gate_v1(p_farm_id,p_as_of_date,p_limit);
  v_serial:=atlas.reconcile_anna_serial_weeding_v1(p_farm_id);
  return coalesce(v_result,'{}'::jsonb)||jsonb_build_object('weedPhysicalNeedGateVersion','release_boundary_v1','weedOccurrencesSuppressed',cardinality(v_suppressed),'serialWeeding',coalesce(v_serial,'{}'::jsonb));
end;$function$;

revoke all on function atlas.reconcile_anna_serial_weeding_v1(uuid) from public,anon,authenticated;
revoke all on function atlas.release_eligible_work_v1(uuid,date,integer) from public,anon,authenticated,service_role;

do $repair$
declare v_farm uuid;
begin
  select id into v_farm from atlas.farms where stable_key='elm_farm' limit 1;
  if v_farm is not null then perform atlas.reconcile_anna_serial_weeding_v1(v_farm); end if;
end;$repair$;