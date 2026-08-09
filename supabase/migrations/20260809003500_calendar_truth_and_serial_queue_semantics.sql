-- Calendar truth and serial queue semantics
-- Future Day views represent work committed to that exact date. Serial maintenance
-- backlog is not calendar work until promoted, except explicit owner/dependency dates.

create or replace function atlas.sync_task_release_queue_summary_v1(p_farm_id uuid,p_queue_key text)
returns void language plpgsql security definer set search_path=pg_catalog,atlas as $function$
declare
  v_active_count integer;
  v_queued_count integer;
  v_completed_count integer;
  v_next_label text;
  v_active_task_id uuid;
  v_active_membership_id uuid;
  v_scheduled_after_count integer := 0;
  v_next_scheduled_label text;
begin
  select
    count(*) filter(where qi.state='active'),
    count(*) filter(where qi.state='queued'),
    count(*) filter(where qi.state='completed'),
    (
      select coalesce(nullif(t.metadata->>'display_subject',''),nullif(o.task_payload->'metadata'->>'display_subject',''),t.title,o.title)
      from atlas.task_release_queue_items next_qi
      left join atlas.tasks t on t.id=next_qi.task_id
      left join atlas.planned_work_occurrences o on o.id=next_qi.planned_occurrence_id
      where next_qi.farm_id=p_farm_id and next_qi.queue_key=p_queue_key and next_qi.state='queued'
      order by next_qi.position limit 1
    )
  into v_active_count,v_queued_count,v_completed_count,v_next_label
  from atlas.task_release_queue_items qi
  where qi.farm_id=p_farm_id and qi.queue_key=p_queue_key;

  select qi.task_id,t.assigned_membership_id
  into v_active_task_id,v_active_membership_id
  from atlas.task_release_queue_items qi
  join atlas.tasks t on t.id=qi.task_id
  where qi.farm_id=p_farm_id and qi.queue_key=p_queue_key and qi.state='active'
    and t.status in ('open','blocked')
  order by qi.position limit 1;

  if v_active_membership_id is not null then
    with committed as (
      select t.title,t.due_date
      from atlas.tasks t
      where t.farm_id=p_farm_id
        and t.assigned_membership_id=v_active_membership_id
        and t.status in ('open','blocked')
        and t.action_key='weed'
        and t.id is distinct from v_active_task_id
        and t.due_date is not null
        and (
          lower(coalesce(t.metadata->>'serial_queue_bypass','false'))='true'
          or lower(coalesce(t.metadata->>'owner_schedule_override','false'))='true'
          or coalesce(t.metadata->>'calendar_commitment_kind','') in ('owner_hard_date','dependency_hard_date')
        )
      union all
      select o.title,o.planned_due_date
      from atlas.planned_work_occurrences o
      where o.farm_id=p_farm_id
        and o.state in ('planned','eligible','failed')
        and o.planned_due_date is not null
        and coalesce(o.task_payload->>'assigned_membership_id','')=v_active_membership_id::text
        and coalesce(o.task_payload->>'action_key','')='weed'
        and coalesce(o.metadata->>'calendar_commitment_kind','') in ('owner_hard_date','dependency_hard_date')
    )
    select count(*)::integer,
           (select title from committed order by due_date,title limit 1)
    into v_scheduled_after_count,v_next_scheduled_label
    from committed;
  end if;

  update atlas.tasks task
  set metadata=coalesce(task.metadata,'{}'::jsonb)||jsonb_build_object(
    'release_queue_key',qi.queue_key,
    'release_queue_state',qi.state,
    'release_queue_position',qi.position,
    'release_queue_initial_batch',qi.initial_batch,
    'release_queue_policy','completion_gated_serial',
    'release_queue_active_count',coalesce(v_active_count,0),
    'release_queue_queued_count',coalesce(v_queued_count,0),
    'release_queue_completed_count',coalesce(v_completed_count,0),
    'release_queue_next_label',coalesce(v_next_label,''),
    'release_queue_scheduled_after_count',coalesce(v_scheduled_after_count,0),
    'release_queue_next_scheduled_label',coalesce(v_next_scheduled_label,''),
    'release_queue_summary_updated_at',now()
  ),updated_at=now()
  from atlas.task_release_queue_items qi
  where qi.task_id=task.id and qi.farm_id=p_farm_id and qi.queue_key=p_queue_key and qi.state in ('active','queued');
end;$function$;

create or replace function atlas.reconcile_anna_serial_weeding_v1(p_farm_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,atlas as $function$
declare
  v_anna uuid; v_keeper uuid; v_keeper_occ uuid; v_next integer; v_retracted integer:=0; v_added integer:=0; r record;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_farm_id::text||':anna_weeding_rotation',0));
  select id into v_anna from atlas.farm_memberships where farm_id=p_farm_id and worker_key='anna' and active=true order by created_at limit 1;
  if v_anna is null then return jsonb_build_object('retracted',0,'queuedAdded',0,'reason','anna_membership_missing'); end if;

  update atlas.task_release_queue_items qi
  set state='active',task_id=o.released_task_id,activated_at=coalesce(qi.activated_at,now()),updated_at=now(),
      metadata=coalesce(qi.metadata,'{}'::jsonb)||jsonb_build_object('promoted_by','reconcile_anna_serial_weeding_v1','promoted_at',now())
  from atlas.planned_work_occurrences o join atlas.tasks t on t.id=o.released_task_id
  where qi.farm_id=p_farm_id and qi.queue_key='anna_weeding_rotation' and qi.state='queued'
    and qi.planned_occurrence_id=o.id and t.status in ('open','blocked') and t.assigned_membership_id=v_anna and t.action_key='weed'
    and lower(coalesce(t.metadata->>'serial_queue_bypass','false'))<>'true'
    and not exists(select 1 from atlas.task_release_queue_items a where a.farm_id=p_farm_id and a.queue_key='anna_weeding_rotation' and a.state='active')
    and qi.position=(select min(h.position) from atlas.task_release_queue_items h where h.farm_id=p_farm_id and h.queue_key='anna_weeding_rotation' and h.state='queued');

  select qi.task_id,qi.planned_occurrence_id into v_keeper,v_keeper_occ
  from atlas.task_release_queue_items qi join atlas.tasks t on t.id=qi.task_id
  where qi.farm_id=p_farm_id and qi.queue_key='anna_weeding_rotation' and qi.state='active' and t.status in ('open','blocked')
  order by qi.position limit 1;

  if v_keeper is null then
    select t.id,t.planned_occurrence_id into v_keeper,v_keeper_occ
    from atlas.tasks t
    where t.farm_id=p_farm_id and t.assigned_membership_id=v_anna and t.status in ('open','blocked')
      and t.action_key='weed' and t.parent_task_id is null
      and lower(coalesce(t.metadata->>'serial_queue_bypass','false'))<>'true'
      and coalesce(t.metadata->>'calendar_commitment_kind','') not in ('owner_hard_date','dependency_hard_date')
    order by t.due_date nulls last,t.released_at nulls last,t.created_at,t.id limit 1;
    if v_keeper is not null and v_keeper_occ is not null then
      if exists(select 1 from atlas.task_release_queue_items where planned_occurrence_id=v_keeper_occ) then
        update atlas.task_release_queue_items set state='active',task_id=v_keeper,activated_at=coalesce(activated_at,now()),updated_at=now() where planned_occurrence_id=v_keeper_occ;
      else
        select coalesce(max(position),0)+1 into v_next from atlas.task_release_queue_items where farm_id=p_farm_id and queue_key='anna_weeding_rotation';
        insert into atlas.task_release_queue_items(farm_id,queue_key,task_id,planned_occurrence_id,position,state,initial_batch,original_due_date,activated_at,metadata)
        select p_farm_id,'anna_weeding_rotation',t.id,t.planned_occurrence_id,v_next,'active',false,t.due_date,now(),
          jsonb_build_object('policy','completion_gated_serial','source','serial_weeding_reconcile_v2','seeded_at',now(),'release_timing','same_day','calendar_commitment_kind','active_serving')
        from atlas.tasks t where t.id=v_keeper;
      end if;
    end if;
  end if;

  for r in
    select t.id,t.due_date,t.planned_occurrence_id
    from atlas.tasks t
    where t.farm_id=p_farm_id and t.assigned_membership_id=v_anna and t.status in ('open','blocked')
      and t.action_key='weed' and t.parent_task_id is null and t.id is distinct from v_keeper
      and lower(coalesce(t.metadata->>'serial_queue_bypass','false'))<>'true'
      and coalesce(t.metadata->>'calendar_commitment_kind','') not in ('owner_hard_date','dependency_hard_date')
    order by t.due_date nulls last,t.created_at,t.id for update
  loop
    if r.planned_occurrence_id is null then continue; end if;
    if exists(select 1 from atlas.task_release_queue_items where planned_occurrence_id=r.planned_occurrence_id) then
      update atlas.task_release_queue_items
      set state='queued',task_id=null,activated_at=null,completed_at=null,updated_at=now(),
          metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
            'requeued_by','reconcile_anna_serial_weeding_v1','requeued_at',now(),
            'release_timing','same_day','calendar_commitment_kind','queue_only')
      where planned_occurrence_id=r.planned_occurrence_id;
    else
      select coalesce(max(position),0)+1 into v_next from atlas.task_release_queue_items where farm_id=p_farm_id and queue_key='anna_weeding_rotation';
      insert into atlas.task_release_queue_items(farm_id,queue_key,task_id,planned_occurrence_id,position,state,initial_batch,original_due_date,metadata)
      values(p_farm_id,'anna_weeding_rotation',null,r.planned_occurrence_id,v_next,'queued',false,r.due_date,
        jsonb_build_object('policy','completion_gated_serial','source','serial_weeding_reconcile_v2','seeded_at',now(),'release_timing','same_day','calendar_commitment_kind','queue_only'));
      v_added:=v_added+1;
    end if;

    update atlas.tasks
    set status='archived',completed_at=null,blocker_text=null,
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'serial_weeding_retracted',true,'serial_weeding_retracted_at',now(),
          'serial_weeding_queue_key','anna_weeding_rotation',
          'archived_reason','Waiting behind the current Weed Card in Anna serial weeding.') ,updated_at=now()
    where id=r.id;

    update atlas.planned_work_occurrences
    set state='planned',released_task_id=null,released_at=null,gate_satisfied_at=null,
        planned_due_date=null,not_before_date=null,
        task_payload=jsonb_set(task_payload,'{metadata}',
          (coalesce(task_payload->'metadata','{}'::jsonb)-'owner_schedule_override'-'serial_queue_bypass'-'calendar_commitment_kind')
          ||jsonb_build_object('serial_queue_state','queued'),true),
        metadata=(coalesce(metadata,'{}'::jsonb)-'releasedBy'-'releasedLane'-'releasedExecutionDate')||jsonb_build_object(
          'serialWeedingQueued',true,'serialWeedingQueuedAt',now(),'serialWeedingQueueKey','anna_weeding_rotation',
          'calendar_commitment_kind','queue_only','queue_original_planned_due_date',r.due_date),updated_at=now()
    where id=r.planned_occurrence_id;

    update atlas.rhythm_state
    set current_task_id=null,current_occurrence_id=r.planned_occurrence_id,
        state_reason=coalesce(state_reason,'{}'::jsonb)||jsonb_build_object('serialWeedingQueued',true,'serialWeedingQueuedAt',now()),updated_at=now()
    where current_task_id=r.id;

    update atlas.task_release_events
    set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
      'retractedBy','reconcile_anna_serial_weeding_v1','retractedAt',now(),
      'retractedReason','Only one ordinary Weed Card may be released to Anna at a time.')
    where task_id=r.id;
    v_retracted:=v_retracted+1;
  end loop;

  perform atlas.sync_task_release_queue_summary_v1(p_farm_id,'anna_weeding_rotation');
  return jsonb_build_object('keeperTaskId',v_keeper,'retracted',v_retracted,'queuedAdded',v_added,
    'queuedAfterCurrent',(select count(*) from atlas.task_release_queue_items where farm_id=p_farm_id and queue_key='anna_weeding_rotation' and state='queued'));
end;$function$;

-- Waiting maintenance is backlog, not calendar truth. Retain its old dates only as provenance.
update atlas.task_release_queue_items qi
set metadata=coalesce(qi.metadata,'{}'::jsonb)||jsonb_build_object(
  'calendar_commitment_kind','queue_only','release_timing','same_day','calendar_semantics_updated_at',now())
where qi.queue_key='anna_weeding_rotation' and qi.state='queued';

update atlas.planned_work_occurrences o
set planned_due_date=null,not_before_date=null,gate_satisfied_at=null,state='planned',released_task_id=null,released_at=null,
    task_payload=jsonb_set(o.task_payload,'{metadata}',
      (coalesce(o.task_payload->'metadata','{}'::jsonb)-'owner_schedule_override'-'serial_queue_bypass'-'calendar_commitment_kind')
      ||jsonb_build_object('serial_queue_state','queued'),true),
    metadata=(coalesce(o.metadata,'{}'::jsonb)-'releasedBy'-'releasedLane'-'releasedExecutionDate')||jsonb_build_object(
      'calendar_commitment_kind','queue_only','queue_original_planned_due_date',coalesce(o.metadata->>'queue_original_planned_due_date',o.planned_due_date::text),
      'calendar_semantics_updated_at',now()),updated_at=now()
from atlas.task_release_queue_items qi
where qi.planned_occurrence_id=o.id and qi.queue_key='anna_weeding_rotation' and qi.state='queued';

-- A real dependency date is not ordinary weed backlog. Restore this existing task as a hard-date exception.
update atlas.task_release_queue_items qi
set state='skipped',task_id=null,updated_at=now(),metadata=coalesce(qi.metadata,'{}'::jsonb)||jsonb_build_object(
  'calendar_commitment_kind','dependency_hard_date','serial_queue_bypass',true,'calendar_exception_at',now(),
  'calendar_exception_reason','Required preparation before the scheduled grass sowing sequence.')
from atlas.planned_work_occurrences o
where qi.planned_occurrence_id=o.id and qi.queue_key='anna_weeding_rotation'
  and o.task_payload->'metadata'->>'sequence_key'='barn_beds_walkway_grass_2026';

update atlas.tasks t
set status='open',completed_at=null,due_date=date '2026-08-25',
    metadata=(coalesce(t.metadata,'{}'::jsonb)-'serial_weeding_retracted'-'archived_reason')||jsonb_build_object(
      'serial_queue_bypass',true,'calendar_commitment_kind','dependency_hard_date',
      'calendar_commitment_reason','Required preparation before the scheduled grass sowing sequence.',
      'calendar_semantics_updated_at',now()),updated_at=now()
where t.metadata->>'task_key'='anna_20260825_weed_barn_beds_walkways_for_grass'
  and t.status='archived'
  and not exists(select 1 from atlas.task_transitions tr where tr.task_id=t.id);

update atlas.planned_work_occurrences o
set state='released',planned_due_date=date '2026-08-25',not_before_date=date '2026-08-25',gate_satisfied_at=now(),
    released_task_id=t.id,released_at=coalesce(o.released_at,now()),work_lane='required',commitment_kind='hard_date',
    task_payload=jsonb_set(o.task_payload,'{metadata}',coalesce(o.task_payload->'metadata','{}'::jsonb)||jsonb_build_object(
      'serial_queue_bypass',true,'calendar_commitment_kind','dependency_hard_date'),true),
    metadata=coalesce(o.metadata,'{}'::jsonb)||jsonb_build_object(
      'calendar_commitment_kind','dependency_hard_date','serial_queue_bypass',true,
      'calendar_commitment_reason','Required preparation before the scheduled grass sowing sequence.',
      'calendar_semantics_updated_at',now()),updated_at=now()
from atlas.tasks t
where t.metadata->>'task_key'='anna_20260825_weed_barn_beds_walkways_for_grass'
  and o.id=t.planned_occurrence_id;

-- Future schedule reads are exact-date calendar reads. Today remains the active-obligation read.
create or replace function atlas.presented_work_rows_v1(p_farm_id uuid, p_membership_id uuid, p_work_date date default null)
returns table(task_id uuid,presentation_state text,presentation_reason text,lane_order integer,selection_rank bigint,work_lane text,commitment_kind text,effort_units numeric,budget_units numeric,notification_planned boolean,overload boolean,task_card jsonb)
language plpgsql stable security definer set search_path=pg_catalog,atlas,auth as $function$
declare
  v_work_date date:=coalesce(p_work_date,(now() at time zone 'America/Chicago')::date);
  v_today date:=(now() at time zone 'America/Chicago')::date;
  v_target_role text;
  v_target_worker_key text;
begin
  select membership.role,membership.worker_key into v_target_role,v_target_worker_key
  from atlas.farm_memberships membership
  where membership.id=p_membership_id and membership.farm_id=p_farm_id and membership.active=true;
  if v_target_role is null then raise exception 'Target membership is not active on this farm.' using errcode='42501'; end if;

  if exists(select 1 from atlas.member_unavailability unavailable where unavailable.farm_id=p_farm_id and unavailable.membership_id=p_membership_id and unavailable.active=true and v_work_date between unavailable.unavailable_start and unavailable.unavailable_end) then return; end if;

  if extract(dow from v_work_date)=0 and v_target_role='farm_hand' then
    return query
    with allowed as (
      select row.* from atlas.presented_work_rows_unfiltered_v1(p_farm_id,p_membership_id,v_work_date) row
      join atlas.tasks task on task.id=row.task_id
      where task.due_date=v_work_date and task.assigned_membership_id=p_membership_id
        and coalesce((task.metadata->>'allow_sunday')::boolean,false) is true
        and coalesce((task.metadata->>'owner_schedule_override')::boolean,false) is true
    )
    select allowed.task_id,'presented'::text,'owner_sunday_override'::text,allowed.lane_order,
      row_number() over(order by allowed.lane_order,allowed.selection_rank,allowed.task_id)::bigint,
      allowed.work_lane,allowed.commitment_kind,allowed.effort_units,allowed.budget_units,allowed.notification_planned,false,allowed.task_card
    from allowed order by 4,5;
    return;
  end if;

  return query
  select row.task_id,
    case
      when coalesce((sky.gate->>'withheldUnderSky')::boolean,false) then 'held'
      when task.status='open' and task.due_date<v_work_date and row.presentation_state='held' and row.presentation_reason in ('held_beyond_regular_minutes','held_beyond_recovery_minutes') then 'presented'
      when task.status='open' and task.due_date=v_work_date and row.presentation_state='held' then 'presented'
      else row.presentation_state end,
    case
      when coalesce((sky.gate->>'withheldUnderSky')::boolean,false) then 'awaiting_favored_sky_window'
      when task.status='open' and task.due_date<v_work_date and accounting.noncounting_overdue then 'overdue_rescheduled_visible_noncounting'
      when task.status='open' and task.due_date<v_work_date and row.presentation_state='held' and row.presentation_reason in ('held_beyond_regular_minutes','held_beyond_recovery_minutes') then 'overdue_visible_over_capacity'
      when task.status='open' and task.due_date=v_work_date and row.presentation_state='held' and row.presentation_reason in ('held_beyond_regular_minutes','held_beyond_recovery_minutes') then 'explicit_due_date_over_capacity'
      when task.status='open' and task.due_date=v_work_date and row.presentation_state='held' then 'explicit_due_date'
      else row.presentation_reason end,
    row.lane_order,row.selection_rank,row.work_lane,row.commitment_kind,row.effort_units,row.budget_units,row.notification_planned,
    case
      when coalesce((sky.gate->>'withheldUnderSky')::boolean,false) then false
      when accounting.noncounting_overdue then false
      when task.status='open' and task.due_date<v_work_date and row.presentation_state='held' and row.presentation_reason in ('held_beyond_regular_minutes','held_beyond_recovery_minutes') then true
      else row.overload or (task.status='open' and task.due_date=v_work_date and row.presentation_state='held' and row.presentation_reason in ('held_beyond_regular_minutes','held_beyond_recovery_minutes')) end,
    row.task_card||jsonb_build_object('sky_timing',sky.gate)
  from atlas.presented_work_rows_unfiltered_v1(p_farm_id,p_membership_id,v_work_date) row
  join atlas.tasks task on task.id=row.task_id
  cross join lateral (select (task.due_date<v_work_date and atlas.task_rescheduled_by_membership_v1(task.id,p_membership_id,v_target_worker_key)) as noncounting_overdue) accounting
  cross join lateral (select atlas.task_sky_presentation_gate_v1(task.id,v_work_date) as gate) sky
  where v_work_date<=v_today or task.due_date=v_work_date
  order by row.lane_order,row.selection_rank;
end;$function$;

-- Recompute the current weed-card cue after the queue/calendar split.
do $block$
declare v_farm uuid;
begin
  for v_farm in select distinct farm_id from atlas.task_release_queue_items where queue_key='anna_weeding_rotation' loop
    perform atlas.sync_task_release_queue_summary_v1(v_farm,'anna_weeding_rotation');
  end loop;
end;$block$;
