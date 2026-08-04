begin;

create table if not exists atlas.task_prerequisites (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  downstream_task_id uuid not null references atlas.tasks(id) on delete cascade,
  prerequisite_task_id uuid not null references atlas.tasks(id) on delete cascade,
  required_status text not null default 'done' check (required_status in ('done','skipped','archived')),
  hold_mode text not null default 'blocked_visible' check (hold_mode in ('blocked_visible','deferred_hidden')),
  sequence_order integer not null default 100,
  active boolean not null default true,
  satisfied_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (downstream_task_id, prerequisite_task_id),
  check (downstream_task_id <> prerequisite_task_id)
);

create index if not exists task_prerequisites_prerequisite_idx
  on atlas.task_prerequisites(prerequisite_task_id)
  where active;

create index if not exists task_prerequisites_downstream_idx
  on atlas.task_prerequisites(downstream_task_id)
  where active;

create or replace function atlas.task_prerequisites_ready_v1(p_downstream_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, atlas
as $function$
  select not exists (
    select 1
    from atlas.task_prerequisites prerequisite
    join atlas.tasks source on source.id = prerequisite.prerequisite_task_id
    where prerequisite.downstream_task_id = p_downstream_task_id
      and prerequisite.active
      and source.status <> prerequisite.required_status
  );
$function$;

create or replace function atlas.task_prerequisite_waiting_text_v1(p_downstream_task_id uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog, atlas
as $function$
  select coalesce(
    nullif(downstream.metadata ->> 'prerequisite_waiting_text', ''),
    'Waiting for ' || string_agg(source.title, ', ' order by prerequisite.sequence_order, source.title)
  )
  from atlas.tasks downstream
  left join atlas.task_prerequisites prerequisite
    on prerequisite.downstream_task_id = downstream.id
   and prerequisite.active
  left join atlas.tasks source
    on source.id = prerequisite.prerequisite_task_id
   and source.status <> prerequisite.required_status
  where downstream.id = p_downstream_task_id
  group by downstream.id, downstream.metadata;
$function$;

create or replace function atlas.reconcile_task_prerequisite_gate_v1(
  p_downstream_task_id uuid,
  p_as_of timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_task atlas.tasks%rowtype;
  v_restore jsonb;
  v_ready boolean;
  v_hidden boolean;
  v_waiting_text text;
  v_assigned_membership_id uuid;
  v_assigned_user_id uuid;
  v_visibility_scope text;
  v_status text;
  v_blocker_text text;
  v_metadata jsonb;
begin
  select * into v_task
  from atlas.tasks
  where id = p_downstream_task_id
  for update;

  if v_task.id is null then
    return jsonb_build_object('taskId', p_downstream_task_id, 'state', 'missing');
  end if;

  update atlas.task_prerequisites prerequisite
  set satisfied_at = case
        when source.status = prerequisite.required_status then coalesce(prerequisite.satisfied_at, p_as_of)
        else null
      end,
      updated_at = p_as_of
  from atlas.tasks source
  where prerequisite.downstream_task_id = p_downstream_task_id
    and prerequisite.active
    and source.id = prerequisite.prerequisite_task_id
    and prerequisite.satisfied_at is distinct from case
      when source.status = prerequisite.required_status then coalesce(prerequisite.satisfied_at, p_as_of)
      else null
    end;

  if v_task.status not in ('open','blocked') then
    return jsonb_build_object('taskId', v_task.id, 'state', 'terminal', 'status', v_task.status);
  end if;

  v_restore := v_task.metadata -> 'prerequisite_gate_restore';
  if v_restore is null or jsonb_typeof(v_restore) <> 'object' then
    v_restore := jsonb_build_object(
      'status', v_task.status,
      'due_date', v_task.due_date,
      'assigned_membership_id', v_task.assigned_membership_id,
      'assigned_user_id', v_task.assigned_user_id,
      'visibility_scope', v_task.visibility_scope,
      'blocker_text', v_task.blocker_text,
      'assigned_to', v_task.metadata -> 'assigned_to',
      'assignee_key', v_task.metadata -> 'assignee_key'
    );
  end if;

  v_ready := atlas.task_prerequisites_ready_v1(v_task.id);

  select exists (
    select 1
    from atlas.task_prerequisites prerequisite
    join atlas.tasks source on source.id = prerequisite.prerequisite_task_id
    where prerequisite.downstream_task_id = v_task.id
      and prerequisite.active
      and prerequisite.hold_mode = 'deferred_hidden'
      and source.status <> prerequisite.required_status
  ) into v_hidden;

  if not v_ready then
    v_waiting_text := atlas.task_prerequisite_waiting_text_v1(v_task.id);

    v_metadata := (
      coalesce(v_task.metadata, '{}'::jsonb)
      - 'assigned_to'
      - 'assignee_key'
      - 'executor_membership_id'
      - 'executor_worker_key'
      - 'executor_role'
      - 'executor_label'
    ) || jsonb_build_object(
      'prerequisite_gate_restore', v_restore,
      'prerequisite_gate_state', case when v_hidden then 'deferred_hidden' else 'blocked_visible' end,
      'prerequisite_gate_updated_at', p_as_of
    );

    update atlas.tasks
    set status = 'blocked',
        blocker_text = v_waiting_text,
        assigned_membership_id = case when v_hidden then null else v_task.assigned_membership_id end,
        assigned_user_id = case when v_hidden then null else v_task.assigned_user_id end,
        visibility_scope = case when v_hidden then 'management' else v_task.visibility_scope end,
        metadata = v_metadata,
        updated_at = p_as_of
    where id = v_task.id;

    return jsonb_build_object(
      'taskId', v_task.id,
      'state', case when v_hidden then 'deferred_hidden' else 'blocked_visible' end,
      'blockerText', v_waiting_text
    );
  end if;

  if v_restore is null or jsonb_typeof(v_restore) <> 'object' then
    return jsonb_build_object('taskId', v_task.id, 'state', 'ready_without_restore');
  end if;

  v_assigned_membership_id := case
    when nullif(v_restore ->> 'assigned_membership_id', '') is null then null
    else (v_restore ->> 'assigned_membership_id')::uuid
  end;
  v_assigned_user_id := case
    when nullif(v_restore ->> 'assigned_user_id', '') is null then null
    else (v_restore ->> 'assigned_user_id')::uuid
  end;
  v_visibility_scope := coalesce(nullif(v_restore ->> 'visibility_scope', ''), v_task.visibility_scope);
  v_status := case
    when coalesce(v_restore ->> 'status', 'open') in ('open','blocked') then v_restore ->> 'status'
    else 'open'
  end;
  v_blocker_text := nullif(v_restore ->> 'blocker_text', '');

  v_metadata := (
    coalesce(v_task.metadata, '{}'::jsonb)
    - 'assigned_to'
    - 'assignee_key'
    - 'executor_membership_id'
    - 'executor_worker_key'
    - 'executor_role'
    - 'executor_label'
  ) || jsonb_strip_nulls(jsonb_build_object(
    'assigned_to', v_restore -> 'assigned_to',
    'assignee_key', v_restore -> 'assignee_key',
    'prerequisite_gate_restore', v_restore,
    'prerequisite_gate_state', 'ready',
    'prerequisite_gate_satisfied_at', p_as_of,
    'prerequisite_gate_updated_at', p_as_of
  ));

  update atlas.tasks
  set status = v_status,
      blocker_text = v_blocker_text,
      assigned_membership_id = v_assigned_membership_id,
      assigned_user_id = v_assigned_user_id,
      visibility_scope = v_visibility_scope,
      metadata = v_metadata,
      updated_at = p_as_of
  where id = v_task.id;

  return jsonb_build_object('taskId', v_task.id, 'state', 'ready', 'status', v_status);
end;
$function$;

create or replace function atlas.reconcile_task_prerequisite_source_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_downstream_task_id uuid;
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  if old.status is not distinct from new.status then
    return new;
  end if;

  for v_downstream_task_id in
    select prerequisite.downstream_task_id
    from atlas.task_prerequisites prerequisite
    where prerequisite.prerequisite_task_id = new.id
      and prerequisite.active
    order by prerequisite.sequence_order, prerequisite.downstream_task_id
  loop
    perform atlas.reconcile_task_prerequisite_gate_v1(v_downstream_task_id, now());
  end loop;

  return new;
end;
$function$;

create or replace function atlas.reconcile_task_prerequisite_link_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_downstream_task_id uuid;
begin
  if tg_op = 'DELETE' then
    v_downstream_task_id := old.downstream_task_id;
    perform atlas.reconcile_task_prerequisite_gate_v1(v_downstream_task_id, now());
    return old;
  end if;

  v_downstream_task_id := new.downstream_task_id;
  perform atlas.reconcile_task_prerequisite_gate_v1(v_downstream_task_id, now());

  if tg_op = 'UPDATE' and old.downstream_task_id is distinct from new.downstream_task_id then
    perform atlas.reconcile_task_prerequisite_gate_v1(old.downstream_task_id, now());
  end if;

  return new;
end;
$function$;

drop trigger if exists task_prerequisites_set_updated_at_v1 on atlas.task_prerequisites;
create trigger task_prerequisites_set_updated_at_v1
before update on atlas.task_prerequisites
for each row execute function atlas.set_updated_at();

drop trigger if exists tasks_reconcile_prerequisite_dependents_v1 on atlas.tasks;
create trigger tasks_reconcile_prerequisite_dependents_v1
after update of status on atlas.tasks
for each row execute function atlas.reconcile_task_prerequisite_source_v1();

drop trigger if exists task_prerequisites_reconcile_link_v1 on atlas.task_prerequisites;
create trigger task_prerequisites_reconcile_link_v1
after insert or delete or update of downstream_task_id, prerequisite_task_id, required_status, hold_mode, sequence_order, active, metadata on atlas.task_prerequisites
for each row execute function atlas.reconcile_task_prerequisite_link_v1();

DO $install_network_gate$
DECLARE
  v_network_task atlas.tasks%rowtype;
  v_reconstruct_task atlas.tasks%rowtype;
  v_owner_membership atlas.farm_memberships%rowtype;
  v_google_voice_task_id uuid;
  v_script_task_id uuid;
  v_today date := (now() at time zone 'America/Chicago')::date;
BEGIN
  select * into v_network_task
  from atlas.tasks
  where metadata ->> 'task_key' = 'anna_20260730_source_free_farm_inputs'
    and status in ('open','blocked')
  order by created_at
  limit 1;

  if v_network_task.id is null then
    raise exception 'Anna network input task was not found.';
  end if;

  select * into v_reconstruct_task
  from atlas.tasks
  where farm_id = v_network_task.farm_id
    and metadata ->> 'task_key' = 'owner_marshall_20260730_reconstruct_florist_inputs_contacts'
    and status in ('open','blocked')
  order by created_at
  limit 1;

  if v_reconstruct_task.id is null then
    raise exception 'The florist and inputs contact-list reconstruction task was not found.';
  end if;

  select * into v_owner_membership
  from atlas.farm_memberships
  where farm_id = v_network_task.farm_id
    and role = 'owner'
    and active
  order by created_at
  limit 1;

  if v_owner_membership.id is null then
    raise exception 'Elm Farm owner membership was not found.';
  end if;

  select id into v_google_voice_task_id
  from atlas.tasks
  where farm_id = v_network_task.farm_id
    and metadata ->> 'task_key' = 'owner_20260804_get_elm_google_voice_number'
  order by created_at
  limit 1;

  if v_google_voice_task_id is null then
    insert into atlas.tasks (
      farm_id, title, task_type, status, priority, due_date, blocker_text, note,
      metadata, action_key, work_class, visibility_scope, assigned_membership_id,
      assigned_user_id, created_by_user_id, origin_kind, task_scope, work_lane,
      commitment_kind, effort_units
    ) values (
      v_network_task.farm_id,
      'Get Elm''s Google Voice Phone Number',
      'network_setup',
      'open',
      'normal',
      v_today,
      null,
      null,
      jsonb_build_object(
        'task_key', 'owner_20260804_get_elm_google_voice_number',
        'owner_task', true,
        'anna_task', false,
        'assigned_to', 'owner',
        'assignee_key', 'owner',
        'work_route', 'network',
        'work_rhythm', 'Owner Network Setup',
        'display_action', 'Set up',
        'display_subject', 'Elm Google Voice Number',
        'display_location', 'Google Voice',
        'collection_zone', 'Network',
        'collection_label', 'Network Setup',
        'detail_heading', 'Set up',
        'detail_lines', jsonb_build_array(
          'Choose and claim the Elm Farm Google Voice number.',
          'Confirm that calls and messages can be received before giving the number to Anna.'
        ),
        'estimated_minutes', 20,
        'prerequisite_waiting_text', 'Finish reconstructing the florist + inputs contact list first.',
        'created_source', 'owner_instruction_20260804'
      ),
      'network', 'standard', 'owner', v_owner_membership.id,
      v_owner_membership.user_id, v_owner_membership.user_id,
      'owner_assigned', 'farm_operation', 'discretionary', 'dependency', 0.5
    ) returning id into v_google_voice_task_id;
  end if;

  select id into v_script_task_id
  from atlas.tasks
  where farm_id = v_network_task.farm_id
    and metadata ->> 'task_key' = 'owner_20260804_write_anna_network_call_script'
  order by created_at
  limit 1;

  if v_script_task_id is null then
    insert into atlas.tasks (
      farm_id, title, task_type, status, priority, due_date, blocker_text, note,
      metadata, action_key, work_class, visibility_scope, assigned_membership_id,
      assigned_user_id, created_by_user_id, origin_kind, task_scope, work_lane,
      commitment_kind, effort_units
    ) values (
      v_network_task.farm_id,
      'Write Anna''s Florist + Farm Inputs Call Script',
      'network_setup',
      'open',
      'normal',
      v_today,
      null,
      null,
      jsonb_build_object(
        'task_key', 'owner_20260804_write_anna_network_call_script',
        'owner_task', true,
        'anna_task', false,
        'assigned_to', 'owner',
        'assignee_key', 'owner',
        'work_route', 'network',
        'work_rhythm', 'Owner Network Setup',
        'display_action', 'Write',
        'display_subject', 'Anna''s Florist + Farm Inputs Call Script',
        'display_location', 'Network',
        'collection_zone', 'Network',
        'collection_label', 'Network Setup',
        'detail_heading', 'Prepare',
        'detail_lines', jsonb_build_array(
          'Write the opening, Elm Farm introduction, request, and next-step language Anna should use.',
          'Cover both florist-bucket calls and free farm-input calls from the reconstructed contact list.'
        ),
        'estimated_minutes', 30,
        'prerequisite_waiting_text', 'Finish reconstructing the florist + inputs contact list first.',
        'created_source', 'owner_instruction_20260804'
      ),
      'network', 'standard', 'owner', v_owner_membership.id,
      v_owner_membership.user_id, v_owner_membership.user_id,
      'owner_assigned', 'farm_operation', 'discretionary', 'dependency', 0.75
    ) returning id into v_script_task_id;
  end if;

  update atlas.tasks
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'prerequisite_waiting_text', 'Waiting for Lex to finish the florist + inputs contact list, claim the Elm Google Voice number, and write the call script.',
        'prerequisite_sequence_key', 'anna_network_outreach_setup_v1',
        'prerequisite_gate_requested_at', now()
      ),
      updated_at = now()
  where id = v_network_task.id;

  insert into atlas.task_prerequisites (
    farm_id, downstream_task_id, prerequisite_task_id, required_status,
    hold_mode, sequence_order, metadata
  ) values
    (
      v_network_task.farm_id, v_google_voice_task_id, v_reconstruct_task.id, 'done',
      'blocked_visible', 10,
      jsonb_build_object('sequenceKey','anna_network_outreach_setup_v1','role','contact_list_before_phone')
    ),
    (
      v_network_task.farm_id, v_script_task_id, v_reconstruct_task.id, 'done',
      'blocked_visible', 20,
      jsonb_build_object('sequenceKey','anna_network_outreach_setup_v1','role','contact_list_before_script')
    ),
    (
      v_network_task.farm_id, v_network_task.id, v_reconstruct_task.id, 'done',
      'deferred_hidden', 10,
      jsonb_build_object('sequenceKey','anna_network_outreach_setup_v1','role','owner_contact_list')
    ),
    (
      v_network_task.farm_id, v_network_task.id, v_google_voice_task_id, 'done',
      'deferred_hidden', 20,
      jsonb_build_object('sequenceKey','anna_network_outreach_setup_v1','role','owner_google_voice')
    ),
    (
      v_network_task.farm_id, v_network_task.id, v_script_task_id, 'done',
      'deferred_hidden', 30,
      jsonb_build_object('sequenceKey','anna_network_outreach_setup_v1','role','owner_call_script')
    )
  on conflict (downstream_task_id, prerequisite_task_id)
  do update set
    required_status = excluded.required_status,
    hold_mode = excluded.hold_mode,
    sequence_order = excluded.sequence_order,
    active = true,
    metadata = atlas.task_prerequisites.metadata || excluded.metadata,
    updated_at = now();

  perform atlas.reconcile_task_prerequisite_gate_v1(v_google_voice_task_id, now());
  perform atlas.reconcile_task_prerequisite_gate_v1(v_script_task_id, now());
  perform atlas.reconcile_task_prerequisite_gate_v1(v_network_task.id, now());
END;
$install_network_gate$;

DO $verify$
DECLARE
  v_network_task atlas.tasks%rowtype;
  v_google_voice_task atlas.tasks%rowtype;
  v_script_task atlas.tasks%rowtype;
BEGIN
  select * into v_network_task from atlas.tasks
  where metadata ->> 'task_key' = 'anna_20260730_source_free_farm_inputs'
  order by created_at limit 1;
  select * into v_google_voice_task from atlas.tasks
  where metadata ->> 'task_key' = 'owner_20260804_get_elm_google_voice_number'
  order by created_at limit 1;
  select * into v_script_task from atlas.tasks
  where metadata ->> 'task_key' = 'owner_20260804_write_anna_network_call_script'
  order by created_at limit 1;

  if v_network_task.status <> 'blocked'
     or v_network_task.assigned_membership_id is not null
     or v_network_task.assigned_user_id is not null
     or v_network_task.visibility_scope <> 'management'
     or v_network_task.metadata ? 'assigned_to'
     or v_network_task.metadata ? 'assignee_key'
     or v_network_task.metadata ? 'executor_membership_id'
     or v_network_task.metadata ? 'executor_worker_key'
  then
    raise exception 'Anna network task was not deferred behind owner prerequisites.';
  end if;

  if v_google_voice_task.status <> 'blocked' or v_script_task.status <> 'blocked' then
    raise exception 'Owner network setup tasks are not blocked behind contact reconstruction.';
  end if;

  if (select count(*) from atlas.task_prerequisites where active and downstream_task_id = v_network_task.id) <> 3 then
    raise exception 'Anna network task does not have exactly three active prerequisites.';
  end if;

  if (select count(*) from atlas.tasks where parent_task_id = v_network_task.id) <> 8 then
    raise exception 'Anna network checklist children were not preserved.';
  end if;
END;
$verify$;

commit;
