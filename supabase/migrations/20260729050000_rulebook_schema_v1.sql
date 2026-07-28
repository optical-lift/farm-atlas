-- Build 2: owner-authored Rulebook schema and effective-rule resolver.
-- Additive foundation only. No live Elm rhythm values are seeded here.

create table if not exists atlas.rhythm_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references atlas.organizations(id) on delete cascade,
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  rule_key text not null,
  rhythm_key text not null,
  version integer not null check (version > 0),
  label text not null,
  status text not null default 'draft' check (status in (
    'draft',
    'active',
    'superseded',
    'paused',
    'retired'
  )),
  applicability jsonb not null default '{}'::jsonb,
  validity_interval_seconds integer not null check (validity_interval_seconds > 0),
  warning_window_seconds integer not null default 0 check (warning_window_seconds >= 0),
  grace_window_seconds integer not null default 0 check (grace_window_seconds >= 0),
  qualifying_touches jsonb not null default '[]'::jsonb,
  failure_consequence jsonb not null default '{}'::jsonb,
  player_routing jsonb not null default '{}'::jsonb,
  created_by_user_id uuid references auth.users(id) on delete set null,
  supersedes_rule_id uuid references atlas.rhythm_rules(id) on delete set null,
  activated_at timestamptz,
  retired_at timestamptz,
  owner_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (farm_id, rule_key, version),
  check (length(btrim(rule_key)) > 0),
  check (length(btrim(rhythm_key)) > 0),
  check (length(btrim(label)) > 0),
  check (warning_window_seconds <= validity_interval_seconds),
  check (jsonb_typeof(applicability) = 'object'),
  check (jsonb_typeof(qualifying_touches) = 'array'),
  check (jsonb_typeof(failure_consequence) = 'object'),
  check (jsonb_typeof(player_routing) = 'object')
);

comment on table atlas.rhythm_rules is
  'Versioned Owner-authored farm rhythm definitions. A rule describes how long a stewardship state remains valid and what evidence, routing, and consequence govern it.';
comment on column atlas.rhythm_rules.rule_key is
  'Stable lineage key. New decisions create a new version rather than rewriting an active historical rule.';
comment on column atlas.rhythm_rules.rhythm_key is
  'Shared rhythm family such as weed_readability or grow_room_water; multiple scoped rule lineages may belong to one rhythm family.';

create unique index if not exists rhythm_rules_one_active_lineage_idx
  on atlas.rhythm_rules(farm_id, rule_key)
  where status = 'active';
create index if not exists rhythm_rules_farm_rhythm_idx
  on atlas.rhythm_rules(farm_id, rhythm_key, status, version desc);
create index if not exists rhythm_rules_supersedes_idx
  on atlas.rhythm_rules(supersedes_rule_id)
  where supersedes_rule_id is not null;

create table if not exists atlas.rhythm_bindings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references atlas.organizations(id) on delete cascade,
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  rhythm_rule_id uuid not null references atlas.rhythm_rules(id) on delete cascade,
  binding_key text not null,
  inheritance_layer text not null check (inheritance_layer in (
    'farm_default',
    'object_class',
    'zone_modifier',
    'contents_stage',
    'subject_override',
    'temporary_exception'
  )),
  subject_kind text not null check (subject_kind in (
    'farm',
    'zone',
    'growing_object',
    'object_class',
    'crop_profile',
    'crop_stage',
    'crop_cycle',
    'room_state',
    'project',
    'project_stage'
  )),
  subject_id uuid,
  subject_key text,
  priority integer not null default 0,
  active_from timestamptz,
  active_until timestamptz,
  active boolean not null default true,
  created_by_user_id uuid references auth.users(id) on delete set null,
  owner_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (farm_id, binding_key),
  check (length(btrim(binding_key)) > 0),
  check (active_until is null or active_from is null or active_until > active_from),
  check (
    (inheritance_layer = 'farm_default'
      and subject_kind = 'farm'
      and subject_id = farm_id
      and subject_key is null)
    or
    (inheritance_layer = 'object_class'
      and subject_kind = 'object_class'
      and subject_id is null
      and nullif(btrim(coalesce(subject_key, '')), '') is not null)
    or
    (inheritance_layer = 'zone_modifier'
      and subject_kind = 'zone'
      and subject_id is not null)
    or
    (inheritance_layer = 'contents_stage'
      and subject_kind in ('crop_profile', 'crop_stage', 'room_state', 'project_stage')
      and (
        (subject_kind = 'crop_profile' and subject_id is not null)
        or (subject_kind = 'crop_stage' and nullif(btrim(coalesce(subject_key, '')), '') is not null)
        or (subject_kind = 'room_state' and nullif(btrim(coalesce(subject_key, '')), '') is not null)
        or (subject_kind = 'project_stage' and subject_id is not null and nullif(btrim(coalesce(subject_key, '')), '') is not null)
      ))
    or
    (inheritance_layer in ('subject_override', 'temporary_exception')
      and subject_kind in ('farm', 'zone', 'growing_object', 'crop_cycle', 'project')
      and subject_id is not null)
  ),
  check (inheritance_layer <> 'temporary_exception' or active_until is not null)
);

comment on table atlas.rhythm_bindings is
  'Owner-authored bindings that place a versioned rhythm rule into the farm inheritance chain. The nearest active explicit binding wins.';
comment on column atlas.rhythm_bindings.inheritance_layer is
  'Resolution order: farm default, object class, zone modifier, contents/stage, subject override, temporary exception.';

create index if not exists rhythm_bindings_rule_idx
  on atlas.rhythm_bindings(rhythm_rule_id);
create index if not exists rhythm_bindings_resolution_idx
  on atlas.rhythm_bindings(farm_id, inheritance_layer, subject_kind, subject_id, subject_key)
  where active = true;
create index if not exists rhythm_bindings_window_idx
  on atlas.rhythm_bindings(farm_id, active_from, active_until)
  where active = true;

alter table atlas.rhythm_rules enable row level security;
alter table atlas.rhythm_bindings enable row level security;

drop policy if exists rhythm_rules_owner_read on atlas.rhythm_rules;
create policy rhythm_rules_owner_read on atlas.rhythm_rules
for select to authenticated
using ((select atlas.is_farm_owner(farm_id)));

drop policy if exists rhythm_bindings_owner_read on atlas.rhythm_bindings;
create policy rhythm_bindings_owner_read on atlas.rhythm_bindings
for select to authenticated
using ((select atlas.is_farm_owner(farm_id)));

grant select on atlas.rhythm_rules, atlas.rhythm_bindings to authenticated;
revoke insert, update, delete, truncate, references, trigger
  on atlas.rhythm_rules, atlas.rhythm_bindings
  from authenticated, anon;
revoke all on atlas.rhythm_rules, atlas.rhythm_bindings from anon;

create or replace function atlas.rhythm_subject_belongs_to_farm_v1(
  p_farm_id uuid,
  p_subject_kind text,
  p_subject_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, atlas
as $$
  select case p_subject_kind
    when 'farm' then p_subject_id = p_farm_id
    when 'zone' then exists (
      select 1 from atlas.zones z
      where z.id = p_subject_id and z.farm_id = p_farm_id
    )
    when 'growing_object' then exists (
      select 1 from atlas.growing_objects o
      where o.id = p_subject_id and o.farm_id = p_farm_id
    )
    when 'crop_cycle' then exists (
      select 1 from atlas.crop_cycles c
      where c.id = p_subject_id and c.farm_id = p_farm_id
    )
    when 'project' then exists (
      select 1 from atlas.projects p
      where p.id = p_subject_id and p.farm_id = p_farm_id
    )
    when 'crop_profile' then exists (
      select 1 from atlas.crop_profiles cp
      where cp.id = p_subject_id
    )
    else false
  end;
$$;

revoke all on function atlas.rhythm_subject_belongs_to_farm_v1(uuid, text, uuid)
  from public, anon, authenticated;

create or replace function atlas.create_rhythm_rule_version_v1(
  p_farm_id uuid,
  p_rule_key text,
  p_rhythm_key text,
  p_label text,
  p_validity_interval_seconds integer,
  p_warning_window_seconds integer default 0,
  p_grace_window_seconds integer default 0,
  p_applicability jsonb default '{}'::jsonb,
  p_qualifying_touches jsonb default '[]'::jsonb,
  p_failure_consequence jsonb default '{}'::jsonb,
  p_player_routing jsonb default '{}'::jsonb,
  p_owner_reason text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_activate boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_organization_id uuid;
  v_next_version integer;
  v_previous_rule_id uuid;
  v_rule_id uuid;
  v_status text;
begin
  if auth.uid() is null or not atlas.is_farm_owner(p_farm_id) then
    raise exception 'Only a farm Owner may author Rulebook versions.' using errcode = '42501';
  end if;

  if nullif(btrim(coalesce(p_rule_key, '')), '') is null
     or nullif(btrim(coalesce(p_rhythm_key, '')), '') is null
     or nullif(btrim(coalesce(p_label, '')), '') is null then
    raise exception 'Rule key, rhythm key, and label are required.' using errcode = '22023';
  end if;

  if p_validity_interval_seconds is null or p_validity_interval_seconds <= 0
     or coalesce(p_warning_window_seconds, 0) < 0
     or coalesce(p_grace_window_seconds, 0) < 0
     or coalesce(p_warning_window_seconds, 0) > p_validity_interval_seconds then
    raise exception 'Rhythm timing values are invalid.' using errcode = '22023';
  end if;

  if jsonb_typeof(coalesce(p_applicability, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_qualifying_touches, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_failure_consequence, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_player_routing, '{}'::jsonb)) <> 'object' then
    raise exception 'Rulebook JSON fields have invalid shapes.' using errcode = '22023';
  end if;

  select f.organization_id into v_organization_id
  from atlas.farms f
  where f.id = p_farm_id;

  if v_organization_id is null then
    raise exception 'Farm not found.' using errcode = 'P0002';
  end if;

  perform 1
  from atlas.rhythm_rules r
  where r.farm_id = p_farm_id
    and r.rule_key = btrim(p_rule_key)
  for update;

  select coalesce(max(r.version), 0) + 1,
         (array_agg(r.id order by r.version desc) filter (where r.status = 'active'))[1]
  into v_next_version, v_previous_rule_id
  from atlas.rhythm_rules r
  where r.farm_id = p_farm_id
    and r.rule_key = btrim(p_rule_key);

  if p_activate and v_previous_rule_id is not null then
    update atlas.rhythm_rules
    set status = 'superseded',
        retired_at = now(),
        updated_at = now()
    where id = v_previous_rule_id;
  end if;

  v_status := case when p_activate then 'active' else 'draft' end;

  insert into atlas.rhythm_rules (
    organization_id,
    farm_id,
    rule_key,
    rhythm_key,
    version,
    label,
    status,
    applicability,
    validity_interval_seconds,
    warning_window_seconds,
    grace_window_seconds,
    qualifying_touches,
    failure_consequence,
    player_routing,
    created_by_user_id,
    supersedes_rule_id,
    activated_at,
    owner_reason,
    metadata
  ) values (
    v_organization_id,
    p_farm_id,
    btrim(p_rule_key),
    btrim(p_rhythm_key),
    v_next_version,
    btrim(p_label),
    v_status,
    coalesce(p_applicability, '{}'::jsonb),
    p_validity_interval_seconds,
    coalesce(p_warning_window_seconds, 0),
    coalesce(p_grace_window_seconds, 0),
    coalesce(p_qualifying_touches, '[]'::jsonb),
    coalesce(p_failure_consequence, '{}'::jsonb),
    coalesce(p_player_routing, '{}'::jsonb),
    auth.uid(),
    v_previous_rule_id,
    case when p_activate then now() else null end,
    nullif(btrim(coalesce(p_owner_reason, '')), ''),
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_rule_id;

  return jsonb_build_object(
    'ruleId', v_rule_id,
    'ruleKey', btrim(p_rule_key),
    'rhythmKey', btrim(p_rhythm_key),
    'version', v_next_version,
    'status', v_status,
    'supersedesRuleId', v_previous_rule_id
  );
end;
$$;

revoke all on function atlas.create_rhythm_rule_version_v1(
  uuid, text, text, text, integer, integer, integer, jsonb, jsonb, jsonb,
  jsonb, text, jsonb, boolean
) from public, anon, authenticated;
grant execute on function atlas.create_rhythm_rule_version_v1(
  uuid, text, text, text, integer, integer, integer, jsonb, jsonb, jsonb,
  jsonb, text, jsonb, boolean
) to authenticated;

create or replace function atlas.activate_rhythm_rule_version_v1(
  p_rule_id uuid,
  p_owner_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_rule atlas.rhythm_rules%rowtype;
begin
  select * into v_rule
  from atlas.rhythm_rules
  where id = p_rule_id
  for update;

  if v_rule.id is null then
    raise exception 'Rhythm rule not found.' using errcode = 'P0002';
  end if;

  if auth.uid() is null or not atlas.is_farm_owner(v_rule.farm_id) then
    raise exception 'Only a farm Owner may activate Rulebook versions.' using errcode = '42501';
  end if;

  update atlas.rhythm_rules
  set status = 'superseded',
      retired_at = now(),
      updated_at = now()
  where farm_id = v_rule.farm_id
    and rule_key = v_rule.rule_key
    and status = 'active'
    and id <> v_rule.id;

  update atlas.rhythm_rules
  set status = 'active',
      activated_at = coalesce(activated_at, now()),
      retired_at = null,
      owner_reason = coalesce(nullif(btrim(coalesce(p_owner_reason, '')), ''), owner_reason),
      updated_at = now()
  where id = v_rule.id;

  return jsonb_build_object(
    'ruleId', v_rule.id,
    'ruleKey', v_rule.rule_key,
    'rhythmKey', v_rule.rhythm_key,
    'version', v_rule.version,
    'status', 'active'
  );
end;
$$;

revoke all on function atlas.activate_rhythm_rule_version_v1(uuid, text)
  from public, anon, authenticated;
grant execute on function atlas.activate_rhythm_rule_version_v1(uuid, text)
  to authenticated;

create or replace function atlas.bind_rhythm_rule_v1(
  p_rule_id uuid,
  p_binding_key text,
  p_inheritance_layer text,
  p_subject_kind text,
  p_subject_id uuid default null,
  p_subject_key text default null,
  p_priority integer default 0,
  p_active_from timestamptz default null,
  p_active_until timestamptz default null,
  p_owner_reason text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_rule atlas.rhythm_rules%rowtype;
  v_binding_id uuid;
  v_normal_subject_key text := nullif(btrim(coalesce(p_subject_key, '')), '');
begin
  select * into v_rule
  from atlas.rhythm_rules
  where id = p_rule_id;

  if v_rule.id is null then
    raise exception 'Rhythm rule not found.' using errcode = 'P0002';
  end if;

  if auth.uid() is null or not atlas.is_farm_owner(v_rule.farm_id) then
    raise exception 'Only a farm Owner may bind Rulebook versions.' using errcode = '42501';
  end if;

  if nullif(btrim(coalesce(p_binding_key, '')), '') is null then
    raise exception 'Binding key is required.' using errcode = '22023';
  end if;

  if p_active_until is not null and p_active_from is not null and p_active_until <= p_active_from then
    raise exception 'Binding active window is invalid.' using errcode = '22023';
  end if;

  if p_inheritance_layer = 'farm_default' then
    if p_subject_kind <> 'farm' or p_subject_id <> v_rule.farm_id or v_normal_subject_key is not null then
      raise exception 'Farm defaults must bind directly to the owning farm.' using errcode = '22023';
    end if;
  elsif p_inheritance_layer = 'object_class' then
    if p_subject_kind <> 'object_class' or p_subject_id is not null or v_normal_subject_key is null then
      raise exception 'Object-class bindings require a semantic subject key and no subject id.' using errcode = '22023';
    end if;
  elsif p_inheritance_layer = 'zone_modifier' then
    if p_subject_kind <> 'zone'
       or p_subject_id is null
       or not atlas.rhythm_subject_belongs_to_farm_v1(v_rule.farm_id, 'zone', p_subject_id) then
      raise exception 'Zone modifiers must bind to a zone on the same farm.' using errcode = '22023';
    end if;
  elsif p_inheritance_layer = 'contents_stage' then
    if p_subject_kind = 'crop_profile' then
      if p_subject_id is null
         or not atlas.rhythm_subject_belongs_to_farm_v1(v_rule.farm_id, 'crop_profile', p_subject_id) then
        raise exception 'Crop-profile bindings require a valid crop profile.' using errcode = '22023';
      end if;
    elsif p_subject_kind = 'crop_stage' then
      if p_subject_id is not null or v_normal_subject_key is null then
        raise exception 'Crop-stage bindings require a semantic stage key.' using errcode = '22023';
      end if;
    elsif p_subject_kind = 'room_state' then
      if v_normal_subject_key is null then
        raise exception 'Room-state bindings require a semantic state key.' using errcode = '22023';
      end if;
      if p_subject_id is not null
         and not atlas.rhythm_subject_belongs_to_farm_v1(v_rule.farm_id, 'growing_object', p_subject_id) then
        raise exception 'Room-state object is not on the same farm.' using errcode = '22023';
      end if;
    elsif p_subject_kind = 'project_stage' then
      if p_subject_id is null
         or v_normal_subject_key is null
         or not atlas.rhythm_subject_belongs_to_farm_v1(v_rule.farm_id, 'project', p_subject_id) then
        raise exception 'Project-stage bindings require a same-farm project and stage key.' using errcode = '22023';
      end if;
    else
      raise exception 'Unsupported contents/stage binding kind.' using errcode = '22023';
    end if;
  elsif p_inheritance_layer in ('subject_override', 'temporary_exception') then
    if p_subject_kind not in ('farm', 'zone', 'growing_object', 'crop_cycle', 'project')
       or p_subject_id is null
       or not atlas.rhythm_subject_belongs_to_farm_v1(v_rule.farm_id, p_subject_kind, p_subject_id) then
      raise exception 'Subject overrides must bind to a canonical subject on the same farm.' using errcode = '22023';
    end if;
    if p_inheritance_layer = 'temporary_exception' and p_active_until is null then
      raise exception 'Temporary exceptions require an end time.' using errcode = '22023';
    end if;
  else
    raise exception 'Unsupported Rulebook inheritance layer.' using errcode = '22023';
  end if;

  insert into atlas.rhythm_bindings (
    organization_id,
    farm_id,
    rhythm_rule_id,
    binding_key,
    inheritance_layer,
    subject_kind,
    subject_id,
    subject_key,
    priority,
    active_from,
    active_until,
    active,
    created_by_user_id,
    owner_reason,
    metadata
  ) values (
    v_rule.organization_id,
    v_rule.farm_id,
    v_rule.id,
    btrim(p_binding_key),
    p_inheritance_layer,
    p_subject_kind,
    p_subject_id,
    v_normal_subject_key,
    coalesce(p_priority, 0),
    p_active_from,
    p_active_until,
    true,
    auth.uid(),
    nullif(btrim(coalesce(p_owner_reason, '')), ''),
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (farm_id, binding_key) do update
    set rhythm_rule_id = excluded.rhythm_rule_id,
        inheritance_layer = excluded.inheritance_layer,
        subject_kind = excluded.subject_kind,
        subject_id = excluded.subject_id,
        subject_key = excluded.subject_key,
        priority = excluded.priority,
        active_from = excluded.active_from,
        active_until = excluded.active_until,
        active = true,
        created_by_user_id = auth.uid(),
        owner_reason = excluded.owner_reason,
        metadata = excluded.metadata,
        updated_at = now()
  returning id into v_binding_id;

  return jsonb_build_object(
    'bindingId', v_binding_id,
    'bindingKey', btrim(p_binding_key),
    'ruleId', v_rule.id,
    'rhythmKey', v_rule.rhythm_key,
    'inheritanceLayer', p_inheritance_layer,
    'subjectKind', p_subject_kind,
    'subjectId', p_subject_id,
    'subjectKey', v_normal_subject_key
  );
end;
$$;

revoke all on function atlas.bind_rhythm_rule_v1(
  uuid, text, text, text, uuid, text, integer, timestamptz, timestamptz, text, jsonb
) from public, anon, authenticated;
grant execute on function atlas.bind_rhythm_rule_v1(
  uuid, text, text, text, uuid, text, integer, timestamptz, timestamptz, text, jsonb
) to authenticated;

create or replace function atlas.set_rhythm_binding_active_v1(
  p_binding_id uuid,
  p_active boolean,
  p_owner_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_binding atlas.rhythm_bindings%rowtype;
begin
  select * into v_binding
  from atlas.rhythm_bindings
  where id = p_binding_id
  for update;

  if v_binding.id is null then
    raise exception 'Rhythm binding not found.' using errcode = 'P0002';
  end if;

  if auth.uid() is null or not atlas.is_farm_owner(v_binding.farm_id) then
    raise exception 'Only a farm Owner may change Rulebook bindings.' using errcode = '42501';
  end if;

  update atlas.rhythm_bindings
  set active = p_active,
      owner_reason = coalesce(nullif(btrim(coalesce(p_owner_reason, '')), ''), owner_reason),
      updated_at = now()
  where id = v_binding.id;

  return jsonb_build_object(
    'bindingId', v_binding.id,
    'bindingKey', v_binding.binding_key,
    'active', p_active
  );
end;
$$;

revoke all on function atlas.set_rhythm_binding_active_v1(uuid, boolean, text)
  from public, anon, authenticated;
grant execute on function atlas.set_rhythm_binding_active_v1(uuid, boolean, text)
  to authenticated;

create or replace function atlas.resolve_effective_rhythm_rule_v1(
  p_farm_id uuid,
  p_rhythm_key text,
  p_subject_kind text,
  p_subject_id uuid,
  p_as_of timestamptz default now()
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_organization_id uuid;
  v_zone_id uuid;
  v_object_id uuid;
  v_object_type text;
  v_object_mode text;
  v_life_status text;
  v_care_state text;
  v_crop_profile_id uuid;
  v_stage_key text;
  v_project_id uuid;
  v_project_stage text;
  v_candidate_count integer := 0;
  v_winner jsonb;
  v_as_of timestamptz := coalesce(p_as_of, now());
begin
  if auth.uid() is null or not atlas.is_farm_member(p_farm_id) then
    raise exception 'Farm membership is required to resolve a Rulebook rhythm.' using errcode = '42501';
  end if;

  if nullif(btrim(coalesce(p_rhythm_key, '')), '') is null
     or p_subject_kind not in ('farm', 'zone', 'growing_object', 'crop_cycle', 'project')
     or p_subject_id is null then
    raise exception 'Rhythm key and canonical subject are required.' using errcode = '22023';
  end if;

  if not atlas.rhythm_subject_belongs_to_farm_v1(p_farm_id, p_subject_kind, p_subject_id) then
    raise exception 'The Rulebook subject is not part of this farm.' using errcode = '22023';
  end if;

  select f.organization_id into v_organization_id
  from atlas.farms f
  where f.id = p_farm_id;

  if p_subject_kind = 'zone' then
    v_zone_id := p_subject_id;
  elsif p_subject_kind = 'growing_object' then
    v_object_id := p_subject_id;
    select o.zone_id, o.object_type, o.object_mode,
           os.life_status, os.care_state
    into v_zone_id, v_object_type, v_object_mode,
         v_life_status, v_care_state
    from atlas.growing_objects o
    left join atlas.object_state os on os.object_id = o.id
    where o.id = p_subject_id;

    select cc.crop_profile_id, cc.cycle_state
    into v_crop_profile_id, v_stage_key
    from atlas.crop_cycles cc
    where cc.object_id = p_subject_id
      and cc.lifecycle_status in ('planned', 'active')
    order by
      case cc.lifecycle_status when 'active' then 0 else 1 end,
      coalesce(cc.planted_date, cc.sown_date, cc.created_at::date) desc,
      cc.created_at desc
    limit 1;
  elsif p_subject_kind = 'crop_cycle' then
    select cc.object_id, cc.crop_profile_id, cc.cycle_state,
           o.zone_id, o.object_type, o.object_mode,
           os.life_status, os.care_state
    into v_object_id, v_crop_profile_id, v_stage_key,
         v_zone_id, v_object_type, v_object_mode,
         v_life_status, v_care_state
    from atlas.crop_cycles cc
    left join atlas.growing_objects o on o.id = cc.object_id
    left join atlas.object_state os on os.object_id = cc.object_id
    where cc.id = p_subject_id;
  elsif p_subject_kind = 'project' then
    v_project_id := p_subject_id;
    select p.zone_id, p.current_milestone
    into v_zone_id, v_project_stage
    from atlas.projects p
    where p.id = p_subject_id;
  end if;

  with candidates as (
    select
      b.id as binding_id,
      b.binding_key,
      b.inheritance_layer,
      b.subject_kind as binding_subject_kind,
      b.subject_id as binding_subject_id,
      b.subject_key as binding_subject_key,
      b.priority,
      r.id as rule_id,
      r.rule_key,
      r.rhythm_key,
      r.version,
      r.label,
      r.applicability,
      r.validity_interval_seconds,
      r.warning_window_seconds,
      r.grace_window_seconds,
      r.qualifying_touches,
      r.failure_consequence,
      r.player_routing,
      case b.inheritance_layer
        when 'temporary_exception' then 600
        when 'subject_override' then 500
        when 'contents_stage' then 400
        when 'zone_modifier' then 300
        when 'object_class' then 200
        when 'farm_default' then 100
        else 0
      end as layer_rank,
      case
        when b.inheritance_layer = 'farm_default' then 'farm:' || p_farm_id::text
        when b.inheritance_layer = 'object_class' then 'object_class:' || b.subject_key
        when b.inheritance_layer = 'zone_modifier' then 'zone:' || b.subject_id::text
        when b.subject_kind = 'crop_profile' then 'crop_profile:' || b.subject_id::text
        when b.subject_kind = 'crop_stage' then 'crop_stage:' || b.subject_key
        when b.subject_kind = 'room_state' then 'room_state:' || b.subject_key
        when b.subject_kind = 'project_stage' then 'project_stage:' || b.subject_key
        else b.subject_kind || ':' || b.subject_id::text
      end as matched_on
    from atlas.rhythm_bindings b
    join atlas.rhythm_rules r on r.id = b.rhythm_rule_id
    where b.farm_id = p_farm_id
      and r.farm_id = p_farm_id
      and r.rhythm_key = btrim(p_rhythm_key)
      and r.status = 'active'
      and b.active = true
      and (b.active_from is null or b.active_from <= v_as_of)
      and (b.active_until is null or b.active_until > v_as_of)
      and (
        (b.inheritance_layer = 'farm_default'
          and b.subject_kind = 'farm'
          and b.subject_id = p_farm_id)
        or
        (b.inheritance_layer = 'object_class'
          and b.subject_kind = 'object_class'
          and v_object_id is not null
          and b.subject_key = any(array_remove(array[
            v_object_type,
            case when v_object_type is not null then 'type:' || v_object_type end,
            v_object_mode,
            case when v_object_mode is not null then 'mode:' || v_object_mode end
          ], null)))
        or
        (b.inheritance_layer = 'zone_modifier'
          and b.subject_kind = 'zone'
          and v_zone_id is not null
          and b.subject_id = v_zone_id)
        or
        (b.inheritance_layer = 'contents_stage'
          and (
            (b.subject_kind = 'crop_profile'
              and v_crop_profile_id is not null
              and b.subject_id = v_crop_profile_id)
            or
            (b.subject_kind = 'crop_stage'
              and v_stage_key is not null
              and b.subject_key = any(array[v_stage_key, 'stage:' || v_stage_key]))
            or
            (b.subject_kind = 'room_state'
              and v_object_type = 'room'
              and (b.subject_id is null or b.subject_id = v_object_id)
              and b.subject_key = any(array_remove(array[
                v_life_status,
                case when v_life_status is not null then 'life:' || v_life_status end,
                v_care_state,
                case when v_care_state is not null then 'care:' || v_care_state end
              ], null)))
            or
            (b.subject_kind = 'project_stage'
              and v_project_id is not null
              and b.subject_id = v_project_id
              and v_project_stage is not null
              and b.subject_key = any(array[v_project_stage, 'stage:' || v_project_stage]))
          ))
        or
        (b.inheritance_layer in ('subject_override', 'temporary_exception')
          and (
            (b.subject_kind = p_subject_kind and b.subject_id = p_subject_id)
            or
            (p_subject_kind = 'crop_cycle'
              and b.subject_kind = 'growing_object'
              and v_object_id is not null
              and b.subject_id = v_object_id)
          ))
      )
  )
  select count(*) into v_candidate_count
  from candidates;

  with candidates as (
    select
      b.id as binding_id,
      b.binding_key,
      b.inheritance_layer,
      b.subject_kind as binding_subject_kind,
      b.subject_id as binding_subject_id,
      b.subject_key as binding_subject_key,
      b.priority,
      r.id as rule_id,
      r.rule_key,
      r.rhythm_key,
      r.version,
      r.label,
      r.applicability,
      r.validity_interval_seconds,
      r.warning_window_seconds,
      r.grace_window_seconds,
      r.qualifying_touches,
      r.failure_consequence,
      r.player_routing,
      case b.inheritance_layer
        when 'temporary_exception' then 600
        when 'subject_override' then 500
        when 'contents_stage' then 400
        when 'zone_modifier' then 300
        when 'object_class' then 200
        when 'farm_default' then 100
        else 0
      end as layer_rank,
      case
        when b.inheritance_layer = 'farm_default' then 'farm:' || p_farm_id::text
        when b.inheritance_layer = 'object_class' then 'object_class:' || b.subject_key
        when b.inheritance_layer = 'zone_modifier' then 'zone:' || b.subject_id::text
        when b.subject_kind = 'crop_profile' then 'crop_profile:' || b.subject_id::text
        when b.subject_kind = 'crop_stage' then 'crop_stage:' || b.subject_key
        when b.subject_kind = 'room_state' then 'room_state:' || b.subject_key
        when b.subject_kind = 'project_stage' then 'project_stage:' || b.subject_key
        else b.subject_kind || ':' || b.subject_id::text
      end as matched_on
    from atlas.rhythm_bindings b
    join atlas.rhythm_rules r on r.id = b.rhythm_rule_id
    where b.farm_id = p_farm_id
      and r.farm_id = p_farm_id
      and r.rhythm_key = btrim(p_rhythm_key)
      and r.status = 'active'
      and b.active = true
      and (b.active_from is null or b.active_from <= v_as_of)
      and (b.active_until is null or b.active_until > v_as_of)
      and (
        (b.inheritance_layer = 'farm_default'
          and b.subject_kind = 'farm'
          and b.subject_id = p_farm_id)
        or
        (b.inheritance_layer = 'object_class'
          and b.subject_kind = 'object_class'
          and v_object_id is not null
          and b.subject_key = any(array_remove(array[
            v_object_type,
            case when v_object_type is not null then 'type:' || v_object_type end,
            v_object_mode,
            case when v_object_mode is not null then 'mode:' || v_object_mode end
          ], null)))
        or
        (b.inheritance_layer = 'zone_modifier'
          and b.subject_kind = 'zone'
          and v_zone_id is not null
          and b.subject_id = v_zone_id)
        or
        (b.inheritance_layer = 'contents_stage'
          and (
            (b.subject_kind = 'crop_profile'
              and v_crop_profile_id is not null
              and b.subject_id = v_crop_profile_id)
            or
            (b.subject_kind = 'crop_stage'
              and v_stage_key is not null
              and b.subject_key = any(array[v_stage_key, 'stage:' || v_stage_key]))
            or
            (b.subject_kind = 'room_state'
              and v_object_type = 'room'
              and (b.subject_id is null or b.subject_id = v_object_id)
              and b.subject_key = any(array_remove(array[
                v_life_status,
                case when v_life_status is not null then 'life:' || v_life_status end,
                v_care_state,
                case when v_care_state is not null then 'care:' || v_care_state end
              ], null)))
            or
            (b.subject_kind = 'project_stage'
              and v_project_id is not null
              and b.subject_id = v_project_id
              and v_project_stage is not null
              and b.subject_key = any(array[v_project_stage, 'stage:' || v_project_stage]))
          ))
        or
        (b.inheritance_layer in ('subject_override', 'temporary_exception')
          and (
            (b.subject_kind = p_subject_kind and b.subject_id = p_subject_id)
            or
            (p_subject_kind = 'crop_cycle'
              and b.subject_kind = 'growing_object'
              and v_object_id is not null
              and b.subject_id = v_object_id)
          ))
      )
  )
  select jsonb_build_object(
    'bindingId', c.binding_id,
    'bindingKey', c.binding_key,
    'inheritanceLayer', c.inheritance_layer,
    'bindingSubjectKind', c.binding_subject_kind,
    'bindingSubjectId', c.binding_subject_id,
    'bindingSubjectKey', c.binding_subject_key,
    'priority', c.priority,
    'layerRank', c.layer_rank,
    'matchedOn', c.matched_on,
    'ruleId', c.rule_id,
    'ruleKey', c.rule_key,
    'rhythmKey', c.rhythm_key,
    'version', c.version,
    'label', c.label,
    'applicability', c.applicability,
    'validityIntervalSeconds', c.validity_interval_seconds,
    'warningWindowSeconds', c.warning_window_seconds,
    'graceWindowSeconds', c.grace_window_seconds,
    'qualifyingTouches', c.qualifying_touches,
    'failureConsequence', c.failure_consequence,
    'playerRouting', c.player_routing
  )
  into v_winner
  from candidates c
  order by c.layer_rank desc, c.priority desc, c.version desc, c.binding_id
  limit 1;

  return jsonb_build_object(
    'contractVersion', 'effective_rhythm_rule_v1',
    'resolvedAt', v_as_of,
    'farmId', p_farm_id,
    'organizationId', v_organization_id,
    'subject', jsonb_build_object(
      'kind', p_subject_kind,
      'id', p_subject_id,
      'zoneId', v_zone_id,
      'objectId', v_object_id,
      'objectType', v_object_type,
      'objectMode', v_object_mode,
      'cropProfileId', v_crop_profile_id,
      'stageKey', coalesce(v_stage_key, v_project_stage)
    ),
    'rhythmKey', btrim(p_rhythm_key),
    'effectiveRule', v_winner,
    'explanation', jsonb_build_object(
      'candidateCount', v_candidate_count,
      'winnerLayer', v_winner ->> 'inheritanceLayer',
      'matchedOn', v_winner ->> 'matchedOn',
      'resolutionRule', 'nearest_active_explicit_rule_wins',
      'inheritanceOrder', jsonb_build_array(
        'farm_default',
        'object_class',
        'zone_modifier',
        'contents_stage',
        'subject_override',
        'temporary_exception'
      ),
      'noMatch', v_winner is null
    )
  );
end;
$$;

revoke all on function atlas.resolve_effective_rhythm_rule_v1(
  uuid, text, text, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function atlas.resolve_effective_rhythm_rule_v1(
  uuid, text, text, uuid, timestamptz
) to authenticated;
