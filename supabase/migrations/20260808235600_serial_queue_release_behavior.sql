create or replace function atlas.sync_task_release_queue_summary_v1(p_farm_id uuid,p_queue_key text)
returns void language plpgsql security definer set search_path=pg_catalog,atlas as $function$
declare v_active_count integer; v_queued_count integer; v_completed_count integer; v_next_label text;
begin
  select count(*) filter(where qi.state='active'),count(*) filter(where qi.state='queued'),count(*) filter(where qi.state='completed'),(
    select coalesce(nullif(t.metadata->>'display_subject',''),nullif(o.task_payload->'metadata'->>'display_subject',''),t.title,o.title)
    from atlas.task_release_queue_items next_qi
    left join atlas.tasks t on t.id=next_qi.task_id
    left join atlas.planned_work_occurrences o on o.id=next_qi.planned_occurrence_id
    where next_qi.farm_id=p_farm_id and next_qi.queue_key=p_queue_key and next_qi.state='queued'
    order by next_qi.position limit 1)
  into v_active_count,v_queued_count,v_completed_count,v_next_label
  from atlas.task_release_queue_items qi where qi.farm_id=p_farm_id and qi.queue_key=p_queue_key;
  update atlas.tasks task set metadata=coalesce(task.metadata,'{}'::jsonb)||jsonb_build_object(
    'release_queue_key',qi.queue_key,'release_queue_state',qi.state,'release_queue_position',qi.position,
    'release_queue_initial_batch',qi.initial_batch,'release_queue_policy','completion_gated_serial',
    'release_queue_active_count',coalesce(v_active_count,0),'release_queue_queued_count',coalesce(v_queued_count,0),
    'release_queue_completed_count',coalesce(v_completed_count,0),'release_queue_next_label',coalesce(v_next_label,''),
    'release_queue_summary_updated_at',now()),updated_at=now()
  from atlas.task_release_queue_items qi
  where qi.task_id=task.id and qi.farm_id=p_farm_id and qi.queue_key=p_queue_key and qi.state in ('active','queued');
end;$function$;

create or replace function atlas.release_next_task_in_queue_v1(p_farm_id uuid,p_queue_key text,p_completed_date date default null)
returns uuid language plpgsql security definer set search_path=pg_catalog,atlas as $function$
declare
  v_next_item atlas.task_release_queue_items%rowtype;
  v_due_date date;
  v_completed_date date:=coalesce(p_completed_date,(now() at time zone 'America/Chicago')::date);
  v_occurrence_id uuid; v_task_id uuid; v_release_timing text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_farm_id::text||':'||p_queue_key,0));

  -- Older queues may intentionally begin with a multi-item initial batch. Do
  -- not release the serial tail until that historical batch is fully closed.
  if exists(
    select 1
    from atlas.task_release_queue_items qi
    left join atlas.tasks task on task.id=qi.task_id
    left join atlas.planned_work_occurrences occurrence on occurrence.id=qi.planned_occurrence_id
    where qi.farm_id=p_farm_id
      and qi.queue_key=p_queue_key
      and qi.initial_batch
      and qi.state<>'completed'
      and coalesce(task.status,'open')<>'done'
      and coalesce(occurrence.state,'released')<>'completed'
  ) then
    perform atlas.sync_task_release_queue_summary_v1(p_farm_id,p_queue_key);
    return null;
  end if;

  select qi.* into v_next_item from atlas.task_release_queue_items qi
  where qi.farm_id=p_farm_id and qi.queue_key=p_queue_key and qi.state='queued'
  order by qi.position for update limit 1;
  if not found then perform atlas.sync_task_release_queue_summary_v1(p_farm_id,p_queue_key); return null; end if;

  v_occurrence_id:=coalesce(v_next_item.planned_occurrence_id,(select t.planned_occurrence_id from atlas.tasks t where t.id=v_next_item.task_id));
  if v_occurrence_id is null then raise exception 'Queued item % has no planned occurrence.',v_next_item.id using errcode='23514'; end if;

  v_release_timing:=coalesce(nullif(v_next_item.metadata->>'release_timing',''),'next_workday');
  if v_release_timing='same_day' then
    v_due_date:=v_completed_date;
  else
    v_due_date:=v_completed_date+1;
    if extract(dow from v_due_date)=0 then v_due_date:=v_due_date+1; end if;
  end if;

  update atlas.planned_work_occurrences
  set planned_due_date=v_due_date,
      not_before_date=least(coalesce(not_before_date,v_due_date),v_due_date),
      gate_satisfied_at=now(),
      state=case when state in ('released','completed') then state else 'eligible' end,
      metadata=metadata||jsonb_build_object(
        'release_queue_key',p_queue_key,
        'release_queue_position',v_next_item.position,
        'released_after_previous_completion',true,
        'released_for_date',v_due_date,
        'queue_gate_satisfied_at',now(),
        'queue_release_timing',v_release_timing
      ),updated_at=now()
  where id=v_occurrence_id;

  perform atlas.release_eligible_work_v1(p_farm_id,v_due_date,1);
  select released_task_id into v_task_id from atlas.planned_work_occurrences where id=v_occurrence_id;

  if v_task_id is not null and exists(select 1 from atlas.tasks where id=v_task_id and status in ('open','blocked')) then
    update atlas.task_release_queue_items
    set task_id=v_task_id,planned_occurrence_id=v_occurrence_id,state='active',activated_at=now(),updated_at=now(),
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'released_after_completion',true,'released_for_date',v_due_date,'released_at',now(),
          'release_timing',v_release_timing,'release_architecture','planned_occurrence_gate'
        )
    where id=v_next_item.id;
  else
    update atlas.task_release_queue_items
    set planned_occurrence_id=v_occurrence_id,task_id=null,state='queued',updated_at=now(),
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'release_attempted_at',now(),'release_waiting_on_capacity',true,
          'release_timing',v_release_timing,'release_architecture','planned_occurrence_gate'
        )
    where id=v_next_item.id;
    v_task_id:=null;
  end if;

  perform atlas.sync_task_release_queue_summary_v1(p_farm_id,p_queue_key);
  return v_task_id;
end;$function$;