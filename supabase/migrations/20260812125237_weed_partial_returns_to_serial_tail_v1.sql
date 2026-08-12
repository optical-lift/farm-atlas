create or replace function atlas.release_weed_card_continuation_v1(p_occurrence_id uuid,p_source_task_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_occ atlas.planned_work_occurrences%rowtype;
  v_source atlas.tasks%rowtype;
  v_template atlas.tasks%rowtype;
  v_task_id uuid;
  v_card_id uuid;
  v_existing uuid;
  v_queue_position integer;
  v_active_queue_task_id uuid;
begin
  if p_occurrence_id is null or p_source_task_id is null then
    raise exception 'Occurrence and source task are required.' using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('weed-card-replacement:' || p_occurrence_id::text,0));

  select * into v_source from atlas.tasks where id=p_source_task_id;
  if v_source.id is null or v_source.status <> 'done' then
    raise exception 'The prior Weed Card session must be done before its replacement is released.' using errcode='22023';
  end if;

  select * into v_occ
  from atlas.planned_work_occurrences
  where id=p_occurrence_id
  for update;

  if v_occ.id is null or v_occ.farm_id <> v_source.farm_id or v_occ.source_kind <> 'weed_card' then
    raise exception 'The replacement occurrence is not a Weed Card continuation for this farm.' using errcode='22023';
  end if;

  v_card_id := v_occ.source_id;
  if v_card_id is null or v_source.metadata ->> 'weed_card_id' is distinct from v_card_id::text then
    raise exception 'The replacement occurrence does not match the completed Weed Card.' using errcode='22023';
  end if;

  -- Anna's ordinary weeding is a completion-gated rotation. A partly finished
  -- bed may remain physically unfinished, but its continuation must go to the
  -- back of that rotation instead of immediately replacing tomorrow's next bed.
  -- This preserves both truths: the bed can still need work later, and closing
  -- today's Weed Card advances the worker Day to the next queued bed.
  if exists(
    select 1
    from atlas.task_release_queue_items qi
    where qi.farm_id=v_source.farm_id
      and qi.queue_key='anna_weeding_rotation'
      and qi.task_id=v_source.id
      and qi.state in ('active','completed')
  ) then
    if not exists(
      select 1 from atlas.task_release_queue_items qi
      where qi.planned_occurrence_id=v_occ.id
        and qi.queue_key='anna_weeding_rotation'
    ) then
      select coalesce(max(qi.position),0)+1 into v_queue_position
      from atlas.task_release_queue_items qi
      where qi.farm_id=v_source.farm_id and qi.queue_key='anna_weeding_rotation';

      insert into atlas.task_release_queue_items(
        farm_id,queue_key,task_id,planned_occurrence_id,position,state,initial_batch,original_due_date,metadata
      ) values (
        v_source.farm_id,'anna_weeding_rotation',null,v_occ.id,v_queue_position,'queued',false,v_occ.planned_due_date,
        jsonb_build_object(
          'policy','completion_gated_serial',
          'source','weed_card_partial_returns_to_serial_tail_v1',
          'release_timing','next_workday',
          'requeued_partial_card',true,
          'requeued_from_task_id',v_source.id,
          'requeued_at',now()
        )
      );
    else
      update atlas.task_release_queue_items
      set task_id=null,
          state='queued',
          activated_at=null,
          completed_at=null,
          metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
            'policy','completion_gated_serial',
            'release_timing','next_workday',
            'requeued_partial_card',true,
            'requeued_from_task_id',v_source.id,
            'requeued_at',now()
          ),
          updated_at=now()
      where planned_occurrence_id=v_occ.id
        and queue_key='anna_weeding_rotation';
    end if;

    update atlas.work_release_policies
    set gate_type='serial_queue',horizon_days=0,maximum_active_instances=1,updated_at=now()
    where id=v_occ.release_policy_id;

    update atlas.planned_work_occurrences
    set state='planned',
        planned_due_date=null,
        not_before_date=null,
        gate_satisfied_at=null,
        released_at=null,
        released_task_id=null,
        task_payload=jsonb_set(
          coalesce(task_payload,'{}'::jsonb),
          '{metadata}',
          (coalesce(task_payload->'metadata','{}'::jsonb)-'calendar_commitment_kind')
            ||jsonb_build_object('serial_queue_state','queued','partial_card_requeued',true),
          true
        ),
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'partialCardRequeued',true,
          'partialCardRequeuedAt',now(),
          'serialWeedingQueueKey','anna_weeding_rotation',
          'releaseTiming','next_workday'
        ),
        updated_at=now()
    where id=v_occ.id;

    perform atlas.sync_task_release_queue_summary_v1(v_source.farm_id,'anna_weeding_rotation');

    select qi.task_id into v_active_queue_task_id
    from atlas.task_release_queue_items qi
    join atlas.tasks t on t.id=qi.task_id
    where qi.farm_id=v_source.farm_id
      and qi.queue_key='anna_weeding_rotation'
      and qi.state='active'
      and t.status in ('open','blocked')
    order by qi.position
    limit 1;

    return v_active_queue_task_id;
  end if;

  if v_occ.state='released' and v_occ.released_task_id is not null then
    return v_occ.released_task_id;
  end if;
  if v_occ.state not in ('planned','eligible','failed','releasing') then
    raise exception 'The Weed Card occurrence cannot be released from state %.',v_occ.state using errcode='22023';
  end if;

  select t.id into v_existing
  from atlas.tasks t
  where t.farm_id=v_occ.farm_id
    and t.status in ('open','blocked')
    and t.metadata ->> 'weed_card_id'=v_card_id::text
    and t.due_date=v_occ.planned_due_date
  order by t.created_at
  limit 1;
  if v_existing is not null then
    update atlas.planned_work_occurrences
    set state='released',released_at=coalesce(released_at,now()),released_task_id=v_existing,updated_at=now()
    where id=v_occ.id;
    return v_existing;
  end if;

  select * into v_template
  from jsonb_populate_record(null::atlas.tasks,v_occ.task_payload);

  if coalesce(v_template.metadata ->> 'weed_card_id','') <> v_card_id::text
     or lower(coalesce(v_template.metadata ->> 'weed_card_session_task','false')) not in ('true','yes','1')
  then
    raise exception 'The occurrence payload is not a governed Weed Card session.' using errcode='22023';
  end if;

  update atlas.planned_work_occurrences
  set state='releasing',updated_at=now(),metadata=metadata || jsonb_build_object(
    'replacement_source_task_id',v_source.id,
    'replacement_release_at',now(),
    'replacement_release_reason','same_card_daily_session'
  )
  where id=v_occ.id;

  insert into atlas.tasks(
    farm_id,zone_id,title,task_type,status,priority,due_date,
    unlock_text,blocker_text,generated_from,generated_from_id,note,metadata,
    action_key,work_class,parent_task_id,task_series_key,engine_instance_key,
    visibility_scope,assigned_membership_id,planned_occurrence_id,
    release_policy_id,released_at,release_reason,organization_id,task_scope,
    assigned_user_id,created_by_user_id,origin_kind
  ) values (
    v_occ.farm_id,
    v_template.zone_id,
    v_occ.title,
    coalesce(nullif(v_template.task_type,''),'maintenance'),
    'open',
    coalesce(nullif(v_template.priority,''),'normal'),
    v_occ.planned_due_date,
    v_template.unlock_text,
    null,
    'weed_card',
    v_card_id,
    v_template.note,
    coalesce(v_template.metadata,'{}'::jsonb) || jsonb_build_object(
      'released_by','release_weed_card_continuation_v1',
      'replacement_source_task_id',v_source.id
    ),
    coalesce(nullif(v_template.action_key,''),'weed'),
    coalesce(nullif(v_template.work_class,''),'standard'),
    null,
    v_template.task_series_key,
    v_template.engine_instance_key,
    coalesce(v_template.visibility_scope,v_source.visibility_scope),
    coalesce(v_template.assigned_membership_id,v_source.assigned_membership_id),
    v_occ.id,
    v_occ.release_policy_id,
    now(),
    'weed_card_replacement',
    v_source.organization_id,
    v_source.task_scope,
    v_source.assigned_user_id,
    auth.uid(),
    'generated'
  ) returning id into v_task_id;

  perform atlas.restore_task_relation_payload_v1(v_task_id,v_occ.relation_payload);
  perform atlas.attach_released_task_to_source_v1(v_occ.id,v_task_id);

  return v_task_id;
end;
$function$;

revoke all on function atlas.release_weed_card_continuation_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function atlas.release_weed_card_continuation_v1(uuid,uuid) to service_role;
