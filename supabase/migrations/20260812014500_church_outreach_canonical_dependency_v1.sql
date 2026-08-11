-- The second church-outreach batch is not blocked by a vague date or by UI
-- choreography. It becomes actionable when the first outreach batch is actually
-- complete. Model that relationship in task_prerequisites so the shared task
-- transition engine releases the next batch atomically with farm truth.

create or replace function atlas.release_network_outreach_batch_v1(
  p_source_task_id uuid,
  p_next_task_key text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_source atlas.tasks%rowtype;
  v_next atlas.tasks%rowtype;
  v_has_canonical_prerequisite boolean:=false;
  v_child record;
begin
  select * into v_source
  from atlas.tasks
  where id=p_source_task_id
  for update;

  if v_source.id is null then
    raise exception 'Source outreach batch not found.' using errcode='P0002';
  end if;
  if not atlas.is_farm_member(v_source.farm_id) then
    raise exception 'Farm access is not active.' using errcode='42501';
  end if;
  if v_source.task_type is distinct from 'network' then
    raise exception 'Source task is not a network outreach batch.' using errcode='22023';
  end if;
  if v_source.status is distinct from 'done' then
    raise exception 'Finish the current outreach batch before releasing the next one.' using errcode='23514';
  end if;
  if nullif(btrim(coalesce(p_next_task_key,'')),'') is null then
    raise exception 'Next outreach batch key is required.' using errcode='22023';
  end if;

  select * into v_next
  from atlas.tasks
  where farm_id=v_source.farm_id
    and metadata->>'task_key'=p_next_task_key
  order by created_at desc
  limit 1
  for update;

  if v_next.id is null then
    raise exception 'Next outreach batch not found.' using errcode='P0002';
  end if;
  if v_next.task_type is distinct from 'network' then
    raise exception 'Next task is not a network outreach batch.' using errcode='22023';
  end if;

  select exists(
    select 1
    from atlas.task_prerequisites prerequisite
    where prerequisite.downstream_task_id=v_next.id
      and prerequisite.prerequisite_task_id=v_source.id
      and prerequisite.required_status='done'
      and prerequisite.active
  ) into v_has_canonical_prerequisite;

  if v_has_canonical_prerequisite then
    perform atlas.reconcile_task_prerequisite_gate_v1(v_next.id,now());

    for v_child in
      select child.id
      from atlas.tasks child
      join atlas.task_prerequisites prerequisite
        on prerequisite.downstream_task_id=child.id
       and prerequisite.prerequisite_task_id=v_source.id
       and prerequisite.required_status='done'
       and prerequisite.active
      where child.parent_task_id=v_next.id
      order by child.created_at,child.id
    loop
      perform atlas.reconcile_task_prerequisite_gate_v1(v_child.id,now());
    end loop;

    select * into v_next from atlas.tasks where id=v_next.id;
    return jsonb_build_object(
      'released',v_next.status in ('open','done'),
      'nextTaskId',v_next.id,
      'state',v_next.status,
      'releaseSource','canonical_prerequisite',
      'alreadyReleased',v_next.status in ('open','done')
    );
  end if;

  -- Compatibility only for an older outreach batch that has not yet been migrated
  -- to task_prerequisites. Current Atlas batches should use the canonical path.
  if v_next.status is distinct from 'blocked' then
    return jsonb_build_object(
      'released',v_next.status in ('open','done'),
      'nextTaskId',v_next.id,
      'state',v_next.status,
      'releaseSource','legacy_compatibility',
      'alreadyReleased',v_next.status in ('open','done')
    );
  end if;

  update atlas.tasks
  set status='open',
      blocker_text=null,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'released_from_task_id',v_source.id,
        'released_at',now(),
        'release_source','network_outreach_batch_v1_legacy_compatibility'
      ),
      updated_at=now()
  where id=v_next.id;

  update atlas.tasks
  set status='open',
      blocker_text=null,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'released_from_task_id',v_source.id,
        'released_at',now(),
        'release_source','network_outreach_batch_v1_legacy_compatibility'
      ),
      updated_at=now()
  where parent_task_id=v_next.id
    and status='blocked';

  return jsonb_build_object(
    'released',true,
    'nextTaskId',v_next.id,
    'state','open',
    'releaseSource','legacy_compatibility',
    'alreadyReleased',false
  );
end;
$function$;

-- Reconcile the current two-batch church sequence by stable task identity. The
-- second batch and its five checklist contacts all depend on completion of the
-- first batch. We briefly restore their intended ready state inside this same
-- transaction so prerequisite_gate_restore captures `open`; the prerequisite
-- trigger immediately returns them to blocked before the migration commits.
do $block$
declare
  v_source atlas.tasks%rowtype;
  v_next atlas.tasks%rowtype;
  v_child_count integer;
begin
  select * into v_source
  from atlas.tasks task
  where task.metadata->>'task_key'='network_20260725_call_10_churches'
  order by task.created_at desc
  limit 1;

  select * into v_next
  from atlas.tasks task
  where task.metadata->>'task_key'='anna_20260812_church_outreach_batch_2'
  order by task.created_at desc
  limit 1;

  if v_source.id is null or v_next.id is null then
    raise exception 'Church outreach batch sequence is incomplete; refusing prerequisite reconciliation.';
  end if;
  if v_source.farm_id is distinct from v_next.farm_id then
    raise exception 'Church outreach batches belong to different farms; refusing prerequisite reconciliation.';
  end if;
  if v_source.task_type is distinct from 'network' or v_next.task_type is distinct from 'network' then
    raise exception 'Church outreach batch task type drifted; refusing prerequisite reconciliation.';
  end if;

  select count(*)::integer into v_child_count
  from atlas.tasks child
  where child.parent_task_id=v_next.id
    and child.task_type='checklist_step';

  if v_child_count<>5 then
    raise exception 'Expected five church contacts in batch 2, found %; refusing prerequisite reconciliation.',v_child_count;
  end if;

  if not exists(
    select 1
    from atlas.task_prerequisites prerequisite
    where prerequisite.downstream_task_id=v_next.id
      and prerequisite.prerequisite_task_id=v_source.id
  ) then
    if v_next.status='blocked' and coalesce(v_next.blocker_text,'')='Finish the first five church contacts first.' then
      update atlas.tasks
      set status='open',
          blocker_text=null,
          metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
            'prerequisite_waiting_text','Finish the first five church contacts first.'
          ),
          updated_at=now()
      where id=v_next.id;
    elsif v_next.status not in ('open','done') then
      raise exception 'Church outreach batch 2 has an unexpected state/blocker; refusing prerequisite reconciliation.';
    end if;

    update atlas.tasks child
    set status='open',
        blocker_text=null,
        metadata=coalesce(child.metadata,'{}'::jsonb)||jsonb_build_object(
          'prerequisite_waiting_text','Waiting for the first church outreach batch.'
        ),
        updated_at=now()
    where child.parent_task_id=v_next.id
      and child.task_type='checklist_step'
      and child.status='blocked'
      and coalesce(child.blocker_text,'')='Waiting for the first church outreach batch.';

    if exists(
      select 1
      from atlas.tasks child
      where child.parent_task_id=v_next.id
        and child.task_type='checklist_step'
        and child.status='blocked'
    ) then
      raise exception 'A church outreach batch-2 checklist child has an unknown blocker; refusing prerequisite reconciliation.';
    end if;
  end if;

  insert into atlas.task_prerequisites(
    farm_id,downstream_task_id,prerequisite_task_id,required_status,hold_mode,sequence_order,active,metadata
  )
  values(
    v_source.farm_id,v_next.id,v_source.id,'done','blocked_visible',10,true,
    jsonb_build_object('source','church_outreach_batch_sequence_v1','relationship','batch_1_completes_before_batch_2')
  )
  on conflict (downstream_task_id,prerequisite_task_id) do update
  set required_status='done',hold_mode='blocked_visible',sequence_order=10,active=true,
      metadata=atlas.task_prerequisites.metadata||excluded.metadata,
      updated_at=now();

  insert into atlas.task_prerequisites(
    farm_id,downstream_task_id,prerequisite_task_id,required_status,hold_mode,sequence_order,active,metadata
  )
  select
    v_source.farm_id,child.id,v_source.id,'done','blocked_visible',10,true,
    jsonb_build_object('source','church_outreach_batch_sequence_v1','relationship','batch_1_completes_before_batch_2_contact')
  from atlas.tasks child
  where child.parent_task_id=v_next.id
    and child.task_type='checklist_step'
  on conflict (downstream_task_id,prerequisite_task_id) do update
  set required_status='done',hold_mode='blocked_visible',sequence_order=10,active=true,
      metadata=atlas.task_prerequisites.metadata||excluded.metadata,
      updated_at=now();
end;
$block$;
