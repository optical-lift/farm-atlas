-- One visible, stateful Wednesday closing round for regular Thursday mornings.
-- Checklist items are canonical conditions, not child tasks or collapsed detail lines.

begin;

create table if not exists atlas.task_execution_checklist_items (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  task_id uuid not null references atlas.tasks(id) on delete cascade,
  item_key text not null,
  section_key text not null,
  section_label text not null,
  item_label text not null,
  sort_order integer not null,
  required boolean not null default true,
  checked boolean not null default false,
  checked_at timestamptz,
  checked_by_membership_id uuid references atlas.farm_memberships(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (task_id, item_key)
);

create index if not exists task_execution_checklist_items_task_idx
  on atlas.task_execution_checklist_items(task_id, sort_order);

create table if not exists atlas.task_execution_checklist_events (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  task_id uuid not null references atlas.tasks(id) on delete cascade,
  item_id uuid not null references atlas.task_execution_checklist_items(id) on delete cascade,
  item_key text not null,
  event_kind text not null check (event_kind in ('checked','reopened')),
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_membership_id uuid references atlas.farm_memberships(id) on delete set null,
  effective_membership_id uuid references atlas.farm_memberships(id) on delete set null,
  occurred_at timestamptz not null default now(),
  idempotency_key text not null,
  payload jsonb not null default '{}'::jsonb,
  unique (farm_id, idempotency_key)
);

create index if not exists task_execution_checklist_events_task_idx
  on atlas.task_execution_checklist_events(task_id, occurred_at desc);

alter table atlas.task_execution_checklist_items enable row level security;
alter table atlas.task_execution_checklist_events enable row level security;

revoke all on atlas.task_execution_checklist_items from public, anon, authenticated;
revoke all on atlas.task_execution_checklist_events from public, anon, authenticated;
grant all on atlas.task_execution_checklist_items to service_role;
grant all on atlas.task_execution_checklist_events to service_role;

create or replace function atlas.task_execution_checklist_context_v1(
  p_task_id uuid,
  p_effective_membership_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas, auth
as $function$
declare
  v_task atlas.tasks%rowtype;
  v_context jsonb;
  v_role text;
  v_current_membership_id uuid;
  v_actor_membership_id uuid;
  v_effective_membership_id uuid;
  v_effective_role text;
  v_visible boolean := false;
begin
  select * into v_task from atlas.tasks where id = p_task_id;
  if v_task.id is null then
    raise exception 'Task was not found.' using errcode = 'P0002';
  end if;

  if p_effective_membership_id is not null then
    v_context := atlas.owner_operator_context_v1(p_effective_membership_id);
    if v_task.farm_id <> (v_context ->> 'farmId')::uuid then
      raise exception 'The task is outside the operated farm.' using errcode = '42501';
    end if;

    v_actor_membership_id := (v_context #>> '{actor,membershipId}')::uuid;
    v_effective_membership_id := (v_context #>> '{effective,membershipId}')::uuid;
    v_effective_role := v_context #>> '{effective,role}';

    v_visible := case
      when v_effective_role = 'owner' then v_task.visibility_scope in ('owner','management','assigned_worker','farm_shared')
      when v_effective_role = 'manager' then
        v_task.visibility_scope in ('management','farm_shared')
        or (v_task.visibility_scope = 'assigned_worker' and v_task.assigned_membership_id = v_effective_membership_id)
      else
        v_task.visibility_scope = 'farm_shared'
        or (v_task.visibility_scope = 'assigned_worker' and v_task.assigned_membership_id = v_effective_membership_id)
    end;
  else
    v_role := atlas.current_farm_role(v_task.farm_id);
    v_current_membership_id := atlas.current_membership_id(v_task.farm_id);
    v_actor_membership_id := v_current_membership_id;
    v_effective_membership_id := v_current_membership_id;
    v_effective_role := v_role;

    v_visible := case
      when v_role = 'owner' then true
      when v_role = 'manager' then
        v_task.visibility_scope in ('management','farm_shared')
        or (v_task.visibility_scope = 'assigned_worker' and v_task.assigned_membership_id = v_current_membership_id)
      else
        v_task.visibility_scope = 'farm_shared'
        or (v_task.visibility_scope = 'assigned_worker' and v_task.assigned_membership_id = v_current_membership_id)
    end;
  end if;

  if not v_visible or v_actor_membership_id is null then
    raise exception 'This checklist is not visible to the selected account.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'farmId', v_task.farm_id,
    'taskId', v_task.id,
    'actorMembershipId', v_actor_membership_id,
    'effectiveMembershipId', v_effective_membership_id,
    'effectiveRole', v_effective_role
  );
end;
$function$;

create or replace function atlas.task_execution_checklist_v1(
  p_task_id uuid,
  p_effective_membership_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_context jsonb;
  v_task atlas.tasks%rowtype;
  v_items jsonb;
  v_total integer;
  v_complete integer;
begin
  v_context := atlas.task_execution_checklist_context_v1(p_task_id, p_effective_membership_id);
  select * into v_task from atlas.tasks where id = p_task_id;

  select
    coalesce(jsonb_agg(
      jsonb_build_object(
        'itemId', item.id,
        'itemKey', item.item_key,
        'sectionKey', item.section_key,
        'sectionLabel', item.section_label,
        'label', item.item_label,
        'sortOrder', item.sort_order,
        'required', item.required,
        'checked', item.checked,
        'checkedAt', item.checked_at
      ) order by item.sort_order, item.item_key
    ), '[]'::jsonb),
    count(*)::integer,
    count(*) filter (where item.checked)::integer
  into v_items, v_total, v_complete
  from atlas.task_execution_checklist_items item
  where item.task_id = p_task_id;

  return jsonb_build_object(
    'taskId', v_task.id,
    'title', coalesce(nullif(v_task.metadata ->> 'execution_checklist_title',''), 'Wednesday closing round'),
    'completionLabel', coalesce(nullif(v_task.metadata ->> 'execution_checklist_completion_label',''), 'Done'),
    'items', v_items,
    'totalCount', coalesce(v_total,0),
    'completeCount', coalesce(v_complete,0),
    'ready', not exists (
      select 1
      from atlas.task_execution_checklist_items required_item
      where required_item.task_id = p_task_id
        and required_item.required
        and not required_item.checked
    ) and coalesce(v_total,0) > 0
  );
end;
$function$;

create or replace function atlas.record_task_execution_check_v1(
  p_task_id uuid,
  p_item_key text,
  p_checked boolean,
  p_idempotency_key text,
  p_effective_membership_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas, auth
as $function$
declare
  v_context jsonb;
  v_item atlas.task_execution_checklist_items%rowtype;
  v_actor_membership_id uuid;
  v_effective_membership_id uuid;
begin
  if p_item_key is null or btrim(p_item_key) = '' or p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'Checklist item and idempotency key are required.' using errcode = '22023';
  end if;

  v_context := atlas.task_execution_checklist_context_v1(p_task_id, p_effective_membership_id);
  v_actor_membership_id := (v_context ->> 'actorMembershipId')::uuid;
  v_effective_membership_id := (v_context ->> 'effectiveMembershipId')::uuid;

  if exists (
    select 1 from atlas.task_execution_checklist_events event
    where event.farm_id = (v_context ->> 'farmId')::uuid
      and event.idempotency_key = p_idempotency_key
  ) then
    return atlas.task_execution_checklist_v1(p_task_id, p_effective_membership_id);
  end if;

  select * into v_item
  from atlas.task_execution_checklist_items item
  where item.task_id = p_task_id and item.item_key = p_item_key
  for update;

  if v_item.id is null then
    raise exception 'Checklist item was not found.' using errcode = 'P0002';
  end if;

  update atlas.task_execution_checklist_items
  set checked = p_checked,
      checked_at = case when p_checked then now() else null end,
      checked_by_membership_id = case when p_checked then v_actor_membership_id else null end,
      updated_at = now()
  where id = v_item.id;

  insert into atlas.task_execution_checklist_events (
    farm_id, task_id, item_id, item_key, event_kind,
    actor_user_id, actor_membership_id, effective_membership_id,
    idempotency_key, payload
  ) values (
    (v_context ->> 'farmId')::uuid,
    p_task_id,
    v_item.id,
    p_item_key,
    case when p_checked then 'checked' else 'reopened' end,
    auth.uid(),
    v_actor_membership_id,
    v_effective_membership_id,
    p_idempotency_key,
    jsonb_build_object('source','visible_execution_checklist','checked',p_checked)
  )
  on conflict (farm_id, idempotency_key) do nothing;

  return atlas.task_execution_checklist_v1(p_task_id, p_effective_membership_id);
end;
$function$;

create or replace function atlas.seed_task_execution_checklist_v1(p_task_id uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_task atlas.tasks%rowtype;
  v_inserted integer := 0;
begin
  select * into v_task from atlas.tasks where id = p_task_id;
  if v_task.id is null then return 0; end if;
  if coalesce(v_task.metadata ->> 'execution_checklist_template_key','') <> 'community_thursday_morning_v1' then
    return 0;
  end if;

  insert into atlas.task_execution_checklist_items (
    farm_id, task_id, item_key, section_key, section_label, item_label, sort_order, required, metadata
  )
  select v_task.farm_id, v_task.id, template.item_key, template.section_key,
         template.section_label, template.item_label, template.sort_order, true,
         jsonb_build_object('templateKey','community_thursday_morning_v1')
  from (values
    ('store_farm_tools','farm_close','Farm close','Store farm tools in their proper places',10),
    ('tidy_farm_work_areas','farm_close','Farm close','Tidy the farm work areas',20),
    ('wash_stage_harvest_buckets','farm_close','Farm close','Wash and stage the harvest buckets',30),
    ('make_cold_brew','coffee_water','Coffee and water','Make cold brew and refrigerate it overnight',40),
    ('restock_reset_coffee_bar','coffee_water','Coffee and water','Restock and reset the coffee bar',50),
    ('refill_water_dispenser','coffee_water','Coffee and water','Refill the water dispenser',60),
    ('bathroom_clean_ready','bathroom','Bathroom','Clean the bathroom and leave it ready for guests',70),
    ('bathroom_supplies_stocked','bathroom','Bathroom','Stock the bathroom supplies',80),
    ('library_surfaces_clear','library','Library','Clear the Library surfaces',90),
    ('library_furniture_reset','library','Library','Reset the Library furniture',100),
    ('library_visibly_ready','library','Library','Leave the Library visibly guest-ready',110),
    ('meeting_surfaces_clear','meeting_room','Meeting room','Clear the meeting room surfaces',120),
    ('meeting_furniture_reset','meeting_room','Meeting room','Reset the meeting room furniture',130),
    ('meeting_visibly_ready','meeting_room','Meeting room','Leave the meeting room visibly guest-ready',140),
    ('take_out_kitchen_trash','closing','Closing','Take out the kitchen trash',150),
    ('final_guest_ready_walk','closing','Closing','Confirm the bathroom, coffee bar, Library, and meeting room are ready',160)
  ) as template(item_key, section_key, section_label, item_label, sort_order)
  on conflict (task_id, item_key) do update
  set section_key = excluded.section_key,
      section_label = excluded.section_label,
      item_label = excluded.item_label,
      sort_order = excluded.sort_order,
      required = true,
      metadata = atlas.task_execution_checklist_items.metadata || excluded.metadata,
      updated_at = now();

  get diagnostics v_inserted = row_count;

  insert into atlas.task_capacity_profiles (
    task_id, farm_id, expected_active_minutes, physical_load, base_obligation_class,
    micro_round_key, estimate_source, estimate_confidence, owner_locked, owner_note, metadata
  ) values (
    v_task.id, v_task.farm_id, 120, 'moderate', 'hard_window',
    'thursday_morning_close', 'template:community_thursday_morning_v1', 'rule', false,
    'Private owner capacity estimate for the full Wednesday closing round.',
    jsonb_build_object('templateKey','community_thursday_morning_v1')
  )
  on conflict (task_id) do update
  set expected_active_minutes = 120,
      physical_load = 'moderate',
      base_obligation_class = 'hard_window',
      micro_round_key = 'thursday_morning_close',
      estimate_source = 'template:community_thursday_morning_v1',
      estimate_confidence = 'rule',
      owner_note = 'Private owner capacity estimate for the full Wednesday closing round.',
      metadata = atlas.task_capacity_profiles.metadata || excluded.metadata,
      updated_at = now()
  where not atlas.task_capacity_profiles.owner_locked;

  return v_inserted;
end;
$function$;

create or replace function atlas.seed_task_execution_checklist_trigger_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
begin
  perform atlas.seed_task_execution_checklist_v1(new.id);
  return new;
end;
$function$;

drop trigger if exists seed_task_execution_checklist_v1 on atlas.tasks;
create trigger seed_task_execution_checklist_v1
after insert or update of metadata, task_series_key on atlas.tasks
for each row
when ((new.metadata ->> 'execution_checklist_template_key') is not null)
execute function atlas.seed_task_execution_checklist_trigger_v1();

create or replace function atlas.guard_required_execution_checklist_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
begin
  if new.status = 'done'
     and old.status is distinct from 'done'
     and coalesce(new.metadata ->> 'execution_checklist_template_key','') <> ''
     and exists (
       select 1
       from atlas.task_execution_checklist_items item
       where item.task_id = new.id
         and item.required
         and not item.checked
     )
  then
    raise exception 'Complete every required checklist item before marking this round ready.' using errcode = '22023';
  end if;
  return new;
end;
$function$;

drop trigger if exists guard_required_execution_checklist_v1 on atlas.tasks;
create trigger guard_required_execution_checklist_v1
before update of status on atlas.tasks
for each row execute function atlas.guard_required_execution_checklist_v1();

-- Current released Wednesday round.
update atlas.tasks
set title = 'Prepare Elm for Thursday Morning',
    priority = 'high',
    note = 'Complete the visible Wednesday closing round so the regular Thursday morning spaces are guest-ready.',
    metadata = (coalesce(metadata,'{}'::jsonb) - 'detail_lines') || jsonb_build_object(
      'execution_checklist_template_key','community_thursday_morning_v1',
      'execution_checklist_title','Wednesday closing round',
      'execution_checklist_completion_label','Elm is ready for Thursday morning',
      'hide_details',true,
      'task_instruction','Prepare Elm for Thursday Morning',
      'display_action','Prepare',
      'display_subject','Elm for Thursday morning',
      'display_detail','Wednesday closing round',
      'collection_label','Thursday Morning Prep',
      'display_location','Bathroom · Coffee Bar · Library · Meeting Room',
      'checklist_visibility','fully_visible_on_task_card',
      'paid_event_scope',false
    ),
    updated_at = now()
where task_series_key = 'community_thursday_wednesday_setup'
  and status in ('open','blocked');

-- Every already-planned future regular Thursday morning occurrence.
update atlas.planned_work_occurrences
set title = 'Prepare Elm for Thursday Morning',
    task_payload = coalesce(task_payload,'{}'::jsonb)
      || jsonb_build_object('title','Prepare Elm for Thursday Morning','priority','high')
      || jsonb_build_object(
        'metadata',
        (coalesce(task_payload -> 'metadata','{}'::jsonb) - 'detail_lines') || jsonb_build_object(
          'execution_checklist_template_key','community_thursday_morning_v1',
          'execution_checklist_title','Wednesday closing round',
          'execution_checklist_completion_label','Elm is ready for Thursday morning',
          'hide_details',true,
          'task_instruction','Prepare Elm for Thursday Morning',
          'display_action','Prepare',
          'display_subject','Elm for Thursday morning',
          'display_detail','Wednesday closing round',
          'collection_label','Thursday Morning Prep',
          'display_location','Bathroom · Coffee Bar · Library · Meeting Room',
          'checklist_visibility','fully_visible_on_task_card',
          'paid_event_scope',false
        )
      ),
    metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
      'executionChecklistTemplateKey','community_thursday_morning_v1',
      'updatedBy','thursday_morning_execution_checklist_v1'
    ),
    updated_at = now()
where occurrence_key like 'community_thursday_wednesday_setup:%'
  and state in ('planned','released');

select atlas.seed_task_execution_checklist_v1(task.id)
from atlas.tasks task
where task.task_series_key = 'community_thursday_wednesday_setup'
  and task.status in ('open','blocked');

grant execute on function atlas.task_execution_checklist_v1(uuid,uuid) to authenticated, service_role;
grant execute on function atlas.record_task_execution_check_v1(uuid,text,boolean,text,uuid) to authenticated, service_role;
revoke execute on function atlas.task_execution_checklist_context_v1(uuid,uuid) from public, anon, authenticated;
revoke execute on function atlas.seed_task_execution_checklist_v1(uuid) from public, anon, authenticated;

commit;
