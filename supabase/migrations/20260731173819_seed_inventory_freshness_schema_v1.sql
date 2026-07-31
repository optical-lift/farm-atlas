-- Seed inventory freshness foundation: append-only physical observations, current projection, and Clock subject support.

alter table atlas.rhythm_bindings drop constraint if exists rhythm_bindings_subject_kind_check;
alter table atlas.rhythm_bindings add constraint rhythm_bindings_subject_kind_check
check (subject_kind = any (array[
  'farm'::text,'zone'::text,'growing_object'::text,'object_class'::text,
  'crop_profile'::text,'crop_stage'::text,'crop_cycle'::text,'room_state'::text,
  'project'::text,'project_stage'::text,'seed_lot'::text
]));

alter table atlas.rhythm_bindings drop constraint if exists rhythm_bindings_check1;
alter table atlas.rhythm_bindings add constraint rhythm_bindings_check1 check (
  ((inheritance_layer = 'farm_default' and subject_kind = 'farm' and subject_id = farm_id and subject_key is null)
  or (inheritance_layer = 'object_class' and subject_kind = 'object_class' and subject_id is null and nullif(btrim(coalesce(subject_key,'')), '') is not null)
  or (inheritance_layer = 'zone_modifier' and subject_kind = 'zone' and subject_id is not null)
  or (inheritance_layer = 'contents_stage' and subject_kind = any(array['crop_profile','crop_stage','room_state','project_stage']) and (
      (subject_kind='crop_profile' and subject_id is not null)
      or (subject_kind='crop_stage' and nullif(btrim(coalesce(subject_key,'')), '') is not null)
      or (subject_kind='room_state' and nullif(btrim(coalesce(subject_key,'')), '') is not null)
      or (subject_kind='project_stage' and subject_id is not null and nullif(btrim(coalesce(subject_key,'')), '') is not null)
  ))
  or (inheritance_layer = any(array['subject_override','temporary_exception'])
      and subject_kind = any(array['farm','zone','growing_object','crop_cycle','project','seed_lot'])
      and subject_id is not null))
);

alter table atlas.rhythm_state drop constraint if exists rhythm_state_subject_kind_check;
alter table atlas.rhythm_state add constraint rhythm_state_subject_kind_check
check (subject_kind = any(array['farm','zone','growing_object','crop_cycle','project','seed_lot']));

alter table atlas.rhythm_satisfactions drop constraint if exists rhythm_satisfactions_subject_kind_check;
alter table atlas.rhythm_satisfactions add constraint rhythm_satisfactions_subject_kind_check
check (subject_kind = any(array['farm','zone','growing_object','crop_cycle','project','seed_lot']));

alter table atlas.workflow_events drop constraint if exists workflow_events_source_kind_check;
alter table atlas.workflow_events add constraint workflow_events_source_kind_check
check (source_kind = any(array['task','object','maintenance','crop_cycle','production_succession','field_log','rhythm_state','project','seed_lot']));

create table if not exists atlas.seed_inventory_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references atlas.organizations(id) on delete cascade,
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  seed_lot_id uuid not null references atlas.seed_lots(id) on delete restrict,
  task_id uuid references atlas.tasks(id) on delete set null,
  rhythm_state_id uuid references atlas.rhythm_state(id) on delete set null,
  event_key text not null,
  outcome text not null check (outcome = any(array[
    'count_confirmed','count_corrected','restocked','depleted',
    'unable_to_verify','problem_found','retired'
  ])),
  observed_at timestamptz not null default now(),
  observed_quantity numeric check (observed_quantity is null or observed_quantity >= 0),
  quantity_added numeric check (quantity_added is null or quantity_added > 0),
  unit text not null,
  source text,
  problem_kind text check (problem_kind is null or problem_kind = any(array[
    'damaged','mislabeled','missing','contaminated','storage_problem','other'
  ])),
  next_check_date date,
  note text,
  created_by_user_id uuid,
  effective_membership_id uuid references atlas.farm_memberships(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (farm_id,event_key),
  check (
    (outcome in ('count_confirmed','count_corrected','restocked') and observed_quantity is not null)
    or (outcome='depleted' and observed_quantity=0)
    or outcome in ('unable_to_verify','problem_found','retired')
  ),
  check (outcome <> 'restocked' or (quantity_added is not null and nullif(btrim(coalesce(source,'')), '') is not null)),
  check (outcome <> 'problem_found' or (problem_kind is not null and nullif(btrim(coalesce(note,'')), '') is not null)),
  check (outcome <> 'unable_to_verify' or next_check_date is not null)
);

create table if not exists atlas.seed_inventory_state (
  seed_lot_id uuid primary key references atlas.seed_lots(id) on delete cascade,
  organization_id uuid not null references atlas.organizations(id) on delete cascade,
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  status text not null default 'verification_required' check (status = any(array[
    'verification_required','verified','uncertain','problem','depleted','retired'
  ])),
  verified_on_hand_quantity numeric check (verified_on_hand_quantity is null or verified_on_hand_quantity >= 0),
  unit text not null,
  last_verified_at timestamptz,
  last_observed_at timestamptz,
  source_event_id uuid references atlas.seed_inventory_events(id) on delete set null,
  current_task_id uuid references atlas.tasks(id) on delete set null,
  next_check_date date,
  low_stock_threshold numeric check (low_stock_threshold is null or low_stock_threshold >= 0),
  note text,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists atlas.seed_lot_task_links (
  seed_lot_id uuid not null references atlas.seed_lots(id) on delete cascade,
  task_id uuid not null references atlas.tasks(id) on delete cascade,
  link_role text not null default 'inventory_recount' check (link_role = any(array['inventory_recount','inventory_problem','inventory_purchase_decision'])),
  source text not null default 'seed_inventory_freshness_v1',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (seed_lot_id,task_id)
);

create index if not exists seed_inventory_events_lot_time_idx on atlas.seed_inventory_events(seed_lot_id,observed_at desc,id desc);
create index if not exists seed_inventory_events_task_idx on atlas.seed_inventory_events(task_id) where task_id is not null;
create index if not exists seed_inventory_state_farm_status_idx on atlas.seed_inventory_state(farm_id,status,last_verified_at);
create index if not exists seed_lot_task_links_task_idx on atlas.seed_lot_task_links(task_id);

alter table atlas.seed_inventory_events enable row level security;
alter table atlas.seed_inventory_state enable row level security;
alter table atlas.seed_lot_task_links enable row level security;

drop policy if exists seed_inventory_events_member_read on atlas.seed_inventory_events;
create policy seed_inventory_events_member_read on atlas.seed_inventory_events
for select to authenticated using (atlas.is_farm_member(farm_id));

drop policy if exists seed_inventory_state_member_read on atlas.seed_inventory_state;
create policy seed_inventory_state_member_read on atlas.seed_inventory_state
for select to authenticated using (atlas.is_farm_member(farm_id));

drop policy if exists seed_lot_task_links_member_read on atlas.seed_lot_task_links;
create policy seed_lot_task_links_member_read on atlas.seed_lot_task_links
for select to authenticated using (
  exists(select 1 from atlas.seed_lots sl where sl.id=seed_lot_id and atlas.is_farm_member(sl.farm_id))
);

revoke insert,update,delete on atlas.seed_inventory_events from anon,authenticated;
revoke insert,update,delete on atlas.seed_inventory_state from anon,authenticated;
revoke insert,update,delete on atlas.seed_lot_task_links from anon,authenticated;
grant select on atlas.seed_inventory_events,atlas.seed_inventory_state,atlas.seed_lot_task_links to authenticated;

create or replace function atlas.prevent_seed_inventory_history_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,atlas
as $$
begin
  raise exception 'Seed inventory history is append-only; record a new physical observation instead.';
end;
$$;

drop trigger if exists seed_inventory_events_append_only_v1 on atlas.seed_inventory_events;
create trigger seed_inventory_events_append_only_v1
before update or delete on atlas.seed_inventory_events
for each row execute function atlas.prevent_seed_inventory_history_mutation_v1();

create or replace function atlas.set_seed_lot_task_link_updated_at_v1()
returns trigger
language plpgsql
set search_path=pg_catalog,atlas
as $$
begin new.updated_at:=now();return new;end;
$$;

drop trigger if exists seed_lot_task_links_updated_at_v1 on atlas.seed_lot_task_links;
create trigger seed_lot_task_links_updated_at_v1
before update on atlas.seed_lot_task_links
for each row execute function atlas.set_seed_lot_task_link_updated_at_v1();