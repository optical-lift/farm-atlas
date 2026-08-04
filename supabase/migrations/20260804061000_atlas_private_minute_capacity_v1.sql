-- Replace arbitrary unit budgeting with an owner-private minute, physical-load,
-- obligation, and recovery ledger. Worker-facing task cards remain task-only.

begin;

create table if not exists atlas.task_capacity_rules (
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  rule_key text not null,
  match_action_key text,
  match_task_type text,
  expected_active_minutes integer not null check (expected_active_minutes between 1 and 720),
  physical_load text not null check (physical_load in ('light','moderate','heavy')),
  default_obligation_class text not null check (default_obligation_class in (
    'hard_window','process_continuation','routine_production','recovery_work','optional_improvement'
  )),
  micro_round_key text,
  priority integer not null default 100,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (farm_id, rule_key)
);

create table if not exists atlas.task_capacity_profiles (
  task_id uuid primary key references atlas.tasks(id) on delete cascade,
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  expected_active_minutes integer not null check (expected_active_minutes between 1 and 720),
  physical_load text not null check (physical_load in ('light','moderate','heavy')),
  base_obligation_class text not null check (base_obligation_class in (
    'hard_window','process_continuation','routine_production','recovery_work','optional_improvement'
  )),
  micro_round_key text,
  estimate_source text not null,
  estimate_confidence text not null check (estimate_confidence in ('owner_confirmed','explicit','rule','fallback')),
  recovery_origin_due_date date,
  recovery_started_on date,
  owner_locked boolean not null default false,
  owner_note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists atlas.member_capacity_settings (
  membership_id uuid primary key references atlas.farm_memberships(id) on delete cascade,
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  regular_target_minutes integer not null check (regular_target_minutes between 30 and 720),
  recovery_target_minutes integer not null check (recovery_target_minutes between 0 and 360),
  maximum_planned_minutes integer not null check (maximum_planned_minutes between 30 and 900),
  heavy_minutes_soft_cap integer not null check (heavy_minutes_soft_cap between 0 and 720),
  active boolean not null default true,
  owner_note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (maximum_planned_minutes >= regular_target_minutes)
);

create index if not exists task_capacity_profiles_farm_idx
  on atlas.task_capacity_profiles(farm_id, base_obligation_class, physical_load);
create index if not exists task_capacity_rules_match_idx
  on atlas.task_capacity_rules(farm_id, active, match_action_key, match_task_type, priority);
create index if not exists member_capacity_settings_farm_idx
  on atlas.member_capacity_settings(farm_id, active);

alter table atlas.task_capacity_rules enable row level security;
alter table atlas.task_capacity_profiles enable row level security;
alter table atlas.member_capacity_settings enable row level security;

revoke all on atlas.task_capacity_rules from public, anon, authenticated;
revoke all on atlas.task_capacity_profiles from public, anon, authenticated;
revoke all on atlas.member_capacity_settings from public, anon, authenticated;

grant select, insert, update, delete on atlas.task_capacity_rules to authenticated;
grant select, insert, update, delete on atlas.task_capacity_profiles to authenticated;
grant select, insert, update, delete on atlas.member_capacity_settings to authenticated;
grant all on atlas.task_capacity_rules to service_role;
grant all on atlas.task_capacity_profiles to service_role;
grant all on atlas.member_capacity_settings to service_role;

drop policy if exists task_capacity_rules_owner_only on atlas.task_capacity_rules;
create policy task_capacity_rules_owner_only
on atlas.task_capacity_rules for all to authenticated
using (atlas.current_farm_role(farm_id) = 'owner')
with check (atlas.current_farm_role(farm_id) = 'owner');

drop policy if exists task_capacity_profiles_owner_only on atlas.task_capacity_profiles;
create policy task_capacity_profiles_owner_only
on atlas.task_capacity_profiles for all to authenticated
using (atlas.current_farm_role(farm_id) = 'owner')
with check (atlas.current_farm_role(farm_id) = 'owner');

drop policy if exists member_capacity_settings_owner_only on atlas.member_capacity_settings;
create policy member_capacity_settings_owner_only
on atlas.member_capacity_settings for all to authenticated
using (atlas.current_farm_role(farm_id) = 'owner')
with check (atlas.current_farm_role(farm_id) = 'owner');

insert into atlas.task_capacity_rules (
  farm_id, rule_key, match_action_key, match_task_type, expected_active_minutes,
  physical_load, default_obligation_class, micro_round_key, priority, metadata
)
select farm.id, rule.rule_key, rule.match_action_key, rule.match_task_type,
       rule.expected_active_minutes, rule.physical_load, rule.default_obligation_class,
       rule.micro_round_key, rule.priority,
       jsonb_build_object('seededBy','atlas_private_minute_capacity_v1')
from atlas.farms farm
cross join (values
  ('germination_check', 'germination_check', 'germination_check', 2, 'light', 'process_continuation', 'grow_room_observation', 1),
  ('germination_verify', 'verify', 'germination_check', 2, 'light', 'process_continuation', 'grow_room_observation', 1),
  ('propagation_readiness', 'check', 'propagation_readiness', 3, 'light', 'process_continuation', 'grow_room_observation', 2),
  ('transplant_readiness', null, 'transplant_readiness', 5, 'light', 'process_continuation', 'grow_room_observation', 3),
  ('departure_check', null, 'departure_check', 3, 'light', 'routine_production', 'departure_round', 4),
  ('checklist_step', null, 'checklist_step', 5, 'light', 'routine_production', 'brief_chore_round', 5),
  ('move_to_lights', 'move_to_lights', null, 5, 'light', 'process_continuation', 'grow_room_observation', 6),
  ('animal_chore', null, 'animal_care', 10, 'light', 'routine_production', 'animal_care_round', 7),
  ('general_chore', null, 'chore', 10, 'light', 'routine_production', 'animal_care_round', 8),
  ('grow_room_check', null, 'grow_room_check', 20, 'moderate', 'process_continuation', 'grow_room_round', 10),
  ('grow_room_care', null, 'grow_room_care', 20, 'moderate', 'routine_production', 'grow_room_round', 11),
  ('soil_blocking', null, 'soil_blocking', 40, 'moderate', 'process_continuation', 'soil_blocking_round', 20),
  ('sowing', null, 'sowing', 45, 'moderate', 'routine_production', null, 21),
  ('succession_sowing', null, 'succession_sowing', 45, 'moderate', 'routine_production', null, 22),
  ('transplanting', null, 'transplanting', 45, 'moderate', 'routine_production', null, 23),
  ('pot_up', null, 'pot_up', 45, 'moderate', 'process_continuation', 'pot_up_round', 24),
  ('weeding', 'weed', null, 60, 'heavy', 'routine_production', null, 30),
  ('mowing', 'mow', null, 60, 'heavy', 'routine_production', null, 31),
  ('bed_prep', null, 'bed_prep', 120, 'heavy', 'routine_production', null, 32),
  ('bed_turnover', null, 'bed_turnover', 120, 'heavy', 'routine_production', null, 33),
  ('bed_reset', null, 'bed_reset', 120, 'heavy', 'process_continuation', null, 34),
  ('venue_cleaning', null, 'venue_cleaning', 90, 'moderate', 'optional_improvement', null, 40),
  ('venue_maintenance', null, 'venue_maintenance', 60, 'moderate', 'optional_improvement', null, 41),
  ('venue_painting', null, 'venue_painting', 90, 'moderate', 'optional_improvement', null, 42),
  ('venue_finish', null, 'venue_finish', 90, 'moderate', 'optional_improvement', null, 43),
  ('network', null, 'network', 90, 'light', 'routine_production', null, 44),
  ('support', null, 'support', 60, 'moderate', 'routine_production', null, 45),
  ('harvest', null, 'harvest', 60, 'moderate', 'process_continuation', null, 46),
  ('garden_cleanup', null, 'garden_cleanup', 60, 'heavy', 'routine_production', null, 47),
  ('default', null, null, 30, 'moderate', 'optional_improvement', null, 999)
) as rule(
  rule_key, match_action_key, match_task_type, expected_active_minutes,
  physical_load, default_obligation_class, micro_round_key, priority
)
on conflict (farm_id, rule_key) do update
set match_action_key = excluded.match_action_key,
    match_task_type = excluded.match_task_type,
    expected_active_minutes = excluded.expected_active_minutes,
    physical_load = excluded.physical_load,
    default_obligation_class = excluded.default_obligation_class,
    micro_round_key = excluded.micro_round_key,
    priority = excluded.priority,
    active = true,
    metadata = atlas.task_capacity_rules.metadata || excluded.metadata,
    updated_at = now();

insert into atlas.member_capacity_settings (
  membership_id, farm_id, regular_target_minutes, recovery_target_minutes,
  maximum_planned_minutes, heavy_minutes_soft_cap, metadata
)
select membership.id, membership.farm_id,
       case membership.role when 'farm_hand' then 300 when 'manager' then 360 else 480 end,
       case membership.role when 'farm_hand' then 90 when 'manager' then 60 else 0 end,
       case membership.role when 'farm_hand' then 420 when 'manager' then 480 else 600 end,
       case membership.role when 'farm_hand' then 210 when 'manager' then 240 else 300 end,
       jsonb_build_object('seededBy','atlas_private_minute_capacity_v1','role',membership.role)
from atlas.farm_memberships membership
where membership.active
on conflict (membership_id) do nothing;

create or replace function atlas.task_capacity_default_v1(p_task atlas.tasks)
returns table(
  expected_active_minutes integer,
  physical_load text,
  base_obligation_class text,
  micro_round_key text,
  estimate_source text,
  estimate_confidence text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_rule atlas.task_capacity_rules%rowtype;
  v_explicit text;
  v_minutes integer;
  v_base text;
begin
  select rule.* into v_rule
  from atlas.task_capacity_rules rule
  where rule.farm_id = p_task.farm_id
    and rule.active
    and (rule.match_action_key is null or rule.match_action_key = coalesce(p_task.action_key, ''))
    and (rule.match_task_type is null or rule.match_task_type = coalesce(p_task.task_type, ''))
  order by
    ((rule.match_action_key is not null)::integer + (rule.match_task_type is not null)::integer) desc,
    rule.priority,
    rule.rule_key
  limit 1;

  v_explicit := coalesce(
    nullif(p_task.metadata ->> 'estimated_minutes', ''),
    nullif(p_task.metadata ->> 'duration_minutes', '')
  );

  if v_explicit ~ '^[0-9]+([.][0-9]+)?$' then
    v_minutes := greatest(1, least(720, round(v_explicit::numeric)::integer));
  else
    v_minutes := coalesce(v_rule.expected_active_minutes, 30);
  end if;

  v_base := coalesce(v_rule.default_obligation_class, 'optional_improvement');
  if p_task.commitment_kind = 'hard_date' then
    v_base := 'hard_window';
  elsif p_task.work_lane = 'process_continuation' then
    v_base := 'process_continuation';
  elsif p_task.work_lane in ('required','rhythm') and v_base = 'optional_improvement' then
    v_base := 'routine_production';
  end if;

  return query select
    v_minutes,
    coalesce(v_rule.physical_load, 'moderate'),
    v_base,
    v_rule.micro_round_key,
    case when v_explicit ~ '^[0-9]+([.][0-9]+)?$'
      then 'task_metadata'
      else 'rule:' || coalesce(v_rule.rule_key, 'fallback')
    end,
    case when v_explicit ~ '^[0-9]+([.][0-9]+)?$' then 'explicit'
         when v_rule.rule_key is not null and v_rule.rule_key <> 'default' then 'rule'
         else 'fallback'
    end;
end;
$function$;

create or replace function atlas.task_capacity_plan_v1(
  p_task atlas.tasks,
  p_work_date date default null
)
returns table(
  expected_active_minutes integer,
  physical_load text,
  base_obligation_class text,
  effective_obligation_class text,
  micro_round_key text,
  estimate_source text,
  estimate_confidence text,
  recovery_origin_due_date date
)
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_work_date date := coalesce(p_work_date, (now() at time zone 'America/Chicago')::date);
  v_profile atlas.task_capacity_profiles%rowtype;
  v_default record;
  v_effective text;
begin
  select profile.* into v_profile
  from atlas.task_capacity_profiles profile
  where profile.task_id = p_task.id;

  if v_profile.task_id is null then
    select * into v_default from atlas.task_capacity_default_v1(p_task);
    expected_active_minutes := v_default.expected_active_minutes;
    physical_load := v_default.physical_load;
    base_obligation_class := v_default.base_obligation_class;
    micro_round_key := v_default.micro_round_key;
    estimate_source := v_default.estimate_source;
    estimate_confidence := v_default.estimate_confidence;
    recovery_origin_due_date := null;
  else
    expected_active_minutes := v_profile.expected_active_minutes;
    physical_load := v_profile.physical_load;
    base_obligation_class := v_profile.base_obligation_class;
    micro_round_key := v_profile.micro_round_key;
    estimate_source := v_profile.estimate_source;
    estimate_confidence := v_profile.estimate_confidence;
    recovery_origin_due_date := v_profile.recovery_origin_due_date;
  end if;

  v_effective := base_obligation_class;
  if p_task.status in ('open','blocked')
     and p_task.due_date is not null
     and p_task.due_date < v_work_date then
    v_effective := 'recovery_work';
    recovery_origin_due_date := coalesce(recovery_origin_due_date, p_task.due_date);
  elsif p_task.commitment_kind = 'hard_date'
        and p_task.due_date is not distinct from v_work_date then
    v_effective := 'hard_window';
  end if;

  effective_obligation_class := v_effective;
  return next;
end;
$function$;

revoke all on function atlas.task_capacity_default_v1(atlas.tasks) from public, anon, authenticated;
revoke all on function atlas.task_capacity_plan_v1(atlas.tasks, date) from public, anon, authenticated;
grant execute on function atlas.task_capacity_default_v1(atlas.tasks) to service_role;
grant execute on function atlas.task_capacity_plan_v1(atlas.tasks, date) to service_role;

insert into atlas.task_capacity_profiles (
  task_id, farm_id, expected_active_minutes, physical_load, base_obligation_class,
  micro_round_key, estimate_source, estimate_confidence,
  recovery_origin_due_date, recovery_started_on, metadata
)
select task.id, task.farm_id,
       capacity.expected_active_minutes, capacity.physical_load, capacity.base_obligation_class,
       capacity.micro_round_key, capacity.estimate_source, capacity.estimate_confidence,
       case when task.status in ('open','blocked') and task.due_date < (now() at time zone 'America/Chicago')::date
         then task.due_date else null end,
       case when task.status in ('open','blocked') and task.due_date < (now() at time zone 'America/Chicago')::date
         then task.due_date + 1 else null end,
       jsonb_build_object('seededBy','atlas_private_minute_capacity_v1')
from atlas.tasks task
cross join lateral atlas.task_capacity_default_v1(task) capacity
where task.farm_id is not null
on conflict (task_id) do nothing;

create or replace function atlas.refresh_task_capacity_profile_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_default record;
  v_today date := (now() at time zone 'America/Chicago')::date;
begin
  if new.farm_id is null then return new; end if;

  select * into v_default from atlas.task_capacity_default_v1(new);

  insert into atlas.task_capacity_profiles (
    task_id, farm_id, expected_active_minutes, physical_load, base_obligation_class,
    micro_round_key, estimate_source, estimate_confidence,
    recovery_origin_due_date, recovery_started_on, metadata
  ) values (
    new.id, new.farm_id, v_default.expected_active_minutes, v_default.physical_load,
    v_default.base_obligation_class, v_default.micro_round_key,
    v_default.estimate_source, v_default.estimate_confidence,
    case when new.status in ('open','blocked') and new.due_date < v_today then new.due_date end,
    case when new.status in ('open','blocked') and new.due_date < v_today then new.due_date + 1 end,
    jsonb_build_object('generatedBy','refresh_task_capacity_profile_v1')
  )
  on conflict (task_id) do update
  set farm_id = excluded.farm_id,
      expected_active_minutes = case when atlas.task_capacity_profiles.owner_locked
        then atlas.task_capacity_profiles.expected_active_minutes else excluded.expected_active_minutes end,
      physical_load = case when atlas.task_capacity_profiles.owner_locked
        then atlas.task_capacity_profiles.physical_load else excluded.physical_load end,
      base_obligation_class = case when atlas.task_capacity_profiles.owner_locked
        then atlas.task_capacity_profiles.base_obligation_class else excluded.base_obligation_class end,
      micro_round_key = case when atlas.task_capacity_profiles.owner_locked
        then atlas.task_capacity_profiles.micro_round_key else excluded.micro_round_key end,
      estimate_source = case when atlas.task_capacity_profiles.owner_locked
        then atlas.task_capacity_profiles.estimate_source else excluded.estimate_source end,
      estimate_confidence = case when atlas.task_capacity_profiles.owner_locked
        then atlas.task_capacity_profiles.estimate_confidence else excluded.estimate_confidence end,
      recovery_origin_due_date = coalesce(
        atlas.task_capacity_profiles.recovery_origin_due_date,
        excluded.recovery_origin_due_date
      ),
      recovery_started_on = coalesce(
        atlas.task_capacity_profiles.recovery_started_on,
        excluded.recovery_started_on
      ),
      metadata = atlas.task_capacity_profiles.metadata || jsonb_build_object('refreshedAt',now()),
      updated_at = now();

  return new;
end;
$function$;

drop trigger if exists tasks_refresh_capacity_profile_v1 on atlas.tasks;
create trigger tasks_refresh_capacity_profile_v1
after insert or update of farm_id, action_key, task_type, metadata, work_lane,
  commitment_kind, due_date, status
on atlas.tasks
for each row execute function atlas.refresh_task_capacity_profile_v1();

create or replace function atlas.presented_work_rows_unfiltered_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_work_date date default null
)
returns table(
  task_id uuid,
  presentation_state text,
  presentation_reason text,
  lane_order integer,
  selection_rank bigint,
  work_lane text,
  commitment_kind text,
  effort_units numeric,
  budget_units numeric,
  notification_planned boolean,
  overload boolean,
  task_card jsonb
)
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas, auth
as $function$
declare
  v_work_date date := coalesce(p_work_date, (now() at time zone 'America/Chicago')::date);
  v_target_user_id uuid;
  v_target_role text;
  v_target_worker_key text;
  v_regular_target integer;
  v_recovery_target integer;
  v_maximum_planned integer;
begin
  select fm.user_id, fm.role, nullif(lower(btrim(fm.worker_key)), '')
  into v_target_user_id, v_target_role, v_target_worker_key
  from atlas.farm_memberships fm
  where fm.id = p_membership_id
    and fm.farm_id = p_farm_id
    and fm.active = true;

  if v_target_user_id is null then
    raise exception 'Target membership is not active on this farm.' using errcode = '42501';
  end if;

  if auth.uid() is not null
    and v_target_user_id is distinct from auth.uid()
    and not atlas.is_farm_manager_or_owner(p_farm_id) then
    raise exception 'Only farm management may read another member''s presented work.' using errcode = '42501';
  end if;

  select
    coalesce(setting.regular_target_minutes,
      case v_target_role when 'owner' then 480 when 'manager' then 360 else 300 end),
    coalesce(setting.recovery_target_minutes,
      case v_target_role when 'owner' then 0 when 'manager' then 60 else 90 end),
    coalesce(setting.maximum_planned_minutes,
      case v_target_role when 'owner' then 600 when 'manager' then 480 else 420 end)
  into v_regular_target, v_recovery_target, v_maximum_planned
  from (select 1) seed
  left join atlas.member_capacity_settings setting
    on setting.farm_id = p_farm_id
   and setting.membership_id = p_membership_id
   and setting.active;

  return query
  with candidate_tasks as materialized (
    select t.*
    from atlas.tasks t
    where t.farm_id = p_farm_id
      and t.task_scope = 'farm_operation'
      and t.status in ('open', 'blocked')
      and t.parent_task_id is null
      and t.metadata ->> 'parent_task_id' is null
      and coalesce((t.metadata ->> 'is_child_task')::boolean, false) = false
      and (
        t.assigned_membership_id = p_membership_id
        or t.assigned_user_id = v_target_user_id
        or t.metadata ->> 'executor_membership_id' = p_membership_id::text
        or (
          jsonb_typeof(t.metadata -> 'shared_with_membership_ids') = 'array'
          and (t.metadata -> 'shared_with_membership_ids') ? p_membership_id::text
        )
        or (
          v_target_worker_key is not null
          and lower(coalesce(
            nullif(t.metadata ->> 'executor_worker_key', ''),
            nullif(t.metadata ->> 'assignee_key', ''),
            nullif(t.metadata ->> 'assigned_to', ''),
            nullif(t.metadata ->> 'work_route', '')
          )) = v_target_worker_key
        )
        or (t.visibility_scope = 'farm_shared' and t.assigned_membership_id is null)
        or (
          v_target_role = 'owner'
          and (
            lower(coalesce(t.metadata ->> 'owner_task', 'false')) = 'true'
            or lower(coalesce(t.metadata ->> 'assigned_to', '')) = 'owner'
            or t.visibility_scope = 'owner'
          )
        )
      )
  ), assigned as (
    select
      t.*,
      card_lookup.card as card,
      capacity.expected_active_minutes,
      capacity.physical_load,
      capacity.effective_obligation_class,
      exists (
        select 1
        from atlas.task_notification_plans notification
        where notification.task_id = t.id and notification.active = true
      ) as has_notification,
      row_number() over (
        partition by case
          when t.work_lane = 'rhythm' then coalesce(
            nullif(t.metadata ->> 'rhythm_state_id', ''),
            case when nullif(t.metadata ->> 'rhythm_key', '') is not null then concat_ws('|',
              t.metadata ->> 'rhythm_key', coalesce(t.zone_id::text, ''),
              coalesce(nullif(t.metadata ->> 'object_key', ''), ''),
              coalesce(nullif(regexp_replace(t.metadata ->> 'collection_member_key', ':[0-9]{4}-[0-9]{2}-[0-9]{2}$', ''), ''), '')
            ) end,
            case when nullif(t.metadata ->> 'collection_member_key', '') is not null then concat_ws('|',
              regexp_replace(t.metadata ->> 'collection_member_key', ':[0-9]{4}-[0-9]{2}-[0-9]{2}$', ''),
              coalesce(t.zone_id::text, '')
            ) end,
            nullif(t.task_series_key, ''),
            concat_ws('|', lower(regexp_replace(t.title, '\s+[—-].*$', '')), coalesce(t.zone_id::text, '')),
            t.id::text
          )
          else t.id::text
        end
        order by
          case when t.due_date is null or t.due_date <= v_work_date then 0 else 1 end,
          t.due_date desc nulls last, t.created_at desc, t.id
      ) as rhythm_rank
    from candidate_tasks t
    cross join lateral (
      select card from atlas.v_task_cards card where card.task_id = t.id limit 1
    ) card_lookup
    cross join lateral atlas.task_capacity_plan_v1(t, v_work_date) capacity
  ), ready as (
    select
      a.*,
      case a.effective_obligation_class
        when 'hard_window' then 1
        when 'process_continuation' then 2
        when 'routine_production' then 3
        when 'recovery_work' then 4
        else 5
      end as resolved_lane_order,
      case a.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 when 'low' then 3 else 4 end as priority_order,
      coalesce((a.metadata ->> 'day_order')::integer, 999999) as day_order,
      lower(coalesce(a.metadata ->> 'reservoirDecisionState', '')) = 'owner_review' as owner_review,
      (a.due_date is null or a.due_date <= v_work_date) as due_now,
      a.effective_obligation_class = 'recovery_work' as is_recovery,
      a.effective_obligation_class = 'hard_window' as is_hard_window
    from assigned a
  ), hard_total as (
    select coalesce(sum(r.expected_active_minutes),0)::integer as minutes
    from ready r
    where r.status='open' and r.due_now and not r.owner_review
      and not r.is_recovery and r.is_hard_window
      and (r.work_lane <> 'rhythm' or r.rhythm_rank=1)
  ), regular_ranked as (
    select r.id,
      sum(r.expected_active_minutes) over (
        order by
          case r.effective_obligation_class when 'process_continuation' then 0 when 'routine_production' then 1 else 2 end,
          case when r.due_date=v_work_date then 0 when r.due_date is null then 1 else 2 end,
          r.priority_order, r.day_order, r.created_at, r.id
        rows between unbounded preceding and current row
      )::integer as cumulative_minutes
    from ready r
    where r.status='open' and r.due_now and not r.owner_review
      and not r.is_recovery and not r.is_hard_window
      and (r.work_lane <> 'rhythm' or r.rhythm_rank=1)
  ), regular_selected as (
    select coalesce(sum(r.expected_active_minutes),0)::integer as minutes
    from ready r
    join regular_ranked ranked on ranked.id=r.id
    cross join hard_total hard
    where ranked.cumulative_minutes <= greatest(v_regular_target-hard.minutes,0)
  ), recovery_capacity as (
    select greatest(0, least(
      greatest(v_maximum_planned-hard.minutes-regular.minutes,0),
      v_recovery_target + greatest(v_regular_target-hard.minutes-regular.minutes,0)
    ))::integer as minutes,
    hard.minutes as hard_minutes,
    regular.minutes as regular_minutes
    from hard_total hard cross join regular_selected regular
  ), recovery_ranked as (
    select r.id,
      sum(r.expected_active_minutes) over (
        order by r.priority_order, r.due_date, r.day_order, r.created_at, r.id
        rows between unbounded preceding and current row
      )::integer as cumulative_minutes
    from ready r
    where r.status='open' and r.due_now and not r.owner_review
      and r.is_recovery
      and (r.work_lane <> 'rhythm' or r.rhythm_rank=1)
  ), resolved as (
    select r.*,
      regular_ranked.cumulative_minutes as cumulative_regular_minutes,
      recovery_ranked.cumulative_minutes as cumulative_recovery_minutes,
      capacity.minutes as recovery_room,
      capacity.hard_minutes,
      capacity.regular_minutes,
      greatest(v_regular_target-capacity.hard_minutes,0)::integer as regular_room,
      case
        when r.owner_review and v_target_role='owner' then 'attention'
        when r.owner_review then 'held'
        when r.status='blocked' and r.due_now then 'attention'
        when not r.due_now then 'held'
        when r.work_lane='rhythm' and r.rhythm_rank>1 then 'held'
        when r.is_hard_window then 'presented'
        when r.is_recovery and coalesce(recovery_ranked.cumulative_minutes,0) <= capacity.minutes then 'presented'
        when not r.is_recovery and coalesce(regular_ranked.cumulative_minutes,0) <= greatest(v_regular_target-capacity.hard_minutes,0) then 'presented'
        else 'held'
      end as resolved_state,
      case
        when r.owner_review then 'owner_review'
        when r.status='blocked' then 'blocked'
        when not r.due_now then 'future'
        when r.work_lane='rhythm' and r.rhythm_rank>1 then 'superseded_rhythm_serving'
        when r.is_hard_window then 'hard_window_selected'
        when r.is_recovery and coalesce(recovery_ranked.cumulative_minutes,0) <= capacity.minutes then 'within_recovery_minutes'
        when r.is_recovery then 'held_beyond_recovery_minutes'
        when coalesce(regular_ranked.cumulative_minutes,0) <= greatest(v_regular_target-capacity.hard_minutes,0) then 'within_regular_minutes'
        else 'held_beyond_regular_minutes'
      end as resolved_reason
    from ready r
    cross join recovery_capacity capacity
    left join regular_ranked on regular_ranked.id=r.id
    left join recovery_ranked on recovery_ranked.id=r.id
  )
  select
    r.id,
    r.resolved_state,
    r.resolved_reason,
    r.resolved_lane_order,
    row_number() over (
      order by
        case r.resolved_state when 'attention' then 0 when 'presented' then 1 else 2 end,
        r.resolved_lane_order,
        case when r.due_date is not null and r.due_date < v_work_date then 0
             when r.due_date=v_work_date then 1 else 2 end,
        r.due_date nulls last, r.priority_order, r.day_order, r.created_at, r.id
    )::bigint,
    r.work_lane,
    r.commitment_kind,
    r.effort_units,
    0::numeric,
    r.has_notification,
    r.resolved_state='presented' and r.is_hard_window
      and r.hard_minutes > v_maximum_planned,
    to_jsonb(r.card) || jsonb_build_object(
      'assigned_membership_id',r.assigned_membership_id,
      'assigned_user_id',r.assigned_user_id,
      'visibility_scope',r.visibility_scope,
      'work_lane',r.work_lane,
      'commitment_kind',r.commitment_kind,
      'release_reason',r.release_reason,
      'origin_kind',r.origin_kind
    )
  from resolved r
  order by 4,5;
end;
$function$;

create or replace function atlas.presented_work_rows_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_work_date date default null
)
returns table(
  task_id uuid, presentation_state text, presentation_reason text,
  lane_order integer, selection_rank bigint, work_lane text,
  commitment_kind text, effort_units numeric, budget_units numeric,
  notification_planned boolean, overload boolean, task_card jsonb
)
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas, auth
as $function$
declare
  v_work_date date := coalesce(p_work_date, (now() at time zone 'America/Chicago')::date);
  v_target_role text;
begin
  select fm.role into v_target_role
  from atlas.farm_memberships fm
  where fm.id=p_membership_id and fm.farm_id=p_farm_id and fm.active=true;

  if v_target_role is null then
    raise exception 'Target membership is not active on this farm.' using errcode='42501';
  end if;

  if exists (
    select 1 from atlas.member_unavailability unavailable
    where unavailable.farm_id=p_farm_id
      and unavailable.membership_id=p_membership_id
      and unavailable.active=true
      and v_work_date between unavailable.unavailable_start and unavailable.unavailable_end
  ) then return; end if;

  if extract(dow from v_work_date)=0 and v_target_role='farm_hand' then
    return query
    with allowed as (
      select row.*
      from atlas.presented_work_rows_unfiltered_v1(p_farm_id,p_membership_id,v_work_date) row
      join atlas.tasks t on t.id=row.task_id
      where t.due_date=v_work_date
        and t.assigned_membership_id=p_membership_id
        and coalesce((t.metadata->>'allow_sunday')::boolean,false) is true
        and coalesce((t.metadata->>'owner_schedule_override')::boolean,false) is true
    )
    select allowed.task_id,'presented'::text,'owner_sunday_override'::text,
      allowed.lane_order,
      row_number() over(order by allowed.lane_order,allowed.selection_rank,allowed.task_id)::bigint,
      allowed.work_lane,allowed.commitment_kind,allowed.effort_units,allowed.budget_units,
      allowed.notification_planned,false,allowed.task_card
    from allowed order by 4,5;
    return;
  end if;

  return query select row.*
  from atlas.presented_work_rows_unfiltered_v1(p_farm_id,p_membership_id,v_work_date) row;
end;
$function$;

-- The row resolver is an internal composition helper. Worker accounts receive
-- only task cards through governed readers, never capacity arithmetic.
revoke all on function atlas.presented_work_rows_unfiltered_v1(uuid,uuid,date) from public, anon, authenticated;
revoke all on function atlas.presented_work_rows_v1(uuid,uuid,date) from public, anon, authenticated;
grant execute on function atlas.presented_work_rows_unfiltered_v1(uuid,uuid,date) to service_role;
grant execute on function atlas.presented_work_rows_v1(uuid,uuid,date) to service_role;

create or replace function atlas.presented_work_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_work_date date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas, auth
as $function$
declare
  v_work_date date := coalesce(p_work_date,(now() at time zone 'America/Chicago')::date);
  v_presented jsonb := '[]'::jsonb;
  v_attention jsonb := '[]'::jsonb;
  v_held jsonb := '[]'::jsonb;
  v_notification_gaps integer := 0;
  v_presented_count integer := 0;
  v_attention_count integer := 0;
  v_held_count integer := 0;
  v_display_name text;
  v_role text;
  v_worker_key text;
begin
  select coalesce(nullif(btrim(profile.display_name),''),nullif(btrim(fm.worker_key),''),initcap(replace(fm.role,'_',' '))),
         fm.role,fm.worker_key
  into v_display_name,v_role,v_worker_key
  from atlas.farm_memberships fm
  left join atlas.user_profiles profile on profile.user_id=fm.user_id
  where fm.id=p_membership_id and fm.farm_id=p_farm_id and fm.active=true;

  select
    coalesce(jsonb_agg(jsonb_build_object('task',row.task_card,'notificationPlanned',row.notification_planned)
      order by row.selection_rank) filter(where row.presentation_state='presented'),'[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object('task',row.task_card,'notificationPlanned',row.notification_planned)
      order by row.selection_rank) filter(where row.presentation_state='attention'),'[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object('task',row.task_card)
      order by row.selection_rank) filter(where row.presentation_state='held'),'[]'::jsonb),
    count(*) filter(where row.presentation_state='presented' and row.commitment_kind='hard_date' and not row.notification_planned)::integer,
    count(*) filter(where row.presentation_state='presented')::integer,
    count(*) filter(where row.presentation_state='attention')::integer,
    count(*) filter(where row.presentation_state='held')::integer
  into v_presented,v_attention,v_held,v_notification_gaps,v_presented_count,v_attention_count,v_held_count
  from atlas.presented_work_rows_v1(p_farm_id,p_membership_id,v_work_date) row;

  return jsonb_build_object(
    'contractVersion','presented_work_v1',
    'farmId',p_farm_id,'membershipId',p_membership_id,'workDate',v_work_date,
    'member',jsonb_build_object('displayName',v_display_name,'role',v_role,'workerKey',v_worker_key),
    'presented',v_presented,'attention',v_attention,'held',v_held,
    'summary',jsonb_build_object(
      'presentedCount',v_presented_count,
      'attentionCount',v_attention_count,
      'heldCount',v_held_count,
      'hardDateMissingNotificationCount',v_notification_gaps
    )
  );
end;
$function$;

create or replace function atlas.worker_task_hand_v1(
  p_farm_id uuid,
  p_for_date date default current_date,
  p_target_membership_id uuid default null
)
returns table(
  task_id uuid,title text,task_type text,status text,priority text,due_date date,
  instruction text,blocker_text text,zone_id uuid,zone_key text,zone_label text,
  assigned_membership_id uuid,visibility_scope text,task_lane text,
  total_steps bigint,completed_steps bigint,can_act boolean
)
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas, auth
as $function$
declare
  v_role text;
  v_current_membership_id uuid;
  v_target_membership_id uuid;
  v_can_act boolean;
begin
  v_role := atlas.current_farm_role(p_farm_id);
  if v_role is null then raise exception 'Active farm membership required.' using errcode='42501'; end if;

  v_current_membership_id := atlas.current_membership_id(p_farm_id);
  v_target_membership_id := atlas.resolve_worker_view_membership_v1(p_farm_id,p_target_membership_id);
  if v_target_membership_id is null then return; end if;
  v_can_act := v_role='farm_hand' and v_current_membership_id=v_target_membership_id;

  return query
  with selected as (
    select row.* from atlas.presented_work_rows_v1(p_farm_id,v_target_membership_id,p_for_date) row
    where row.presentation_state in ('attention','presented')
  )
  select t.id,t.title,t.task_type,t.status,t.priority,t.due_date,
    coalesce(nullif(btrim(t.note),''),nullif(btrim(t.unlock_text),'')),
    nullif(btrim(t.blocker_text),''),t.zone_id,z.stable_key,z.label,
    t.assigned_membership_id,t.visibility_scope,t.work_lane,
    (select count(*) from atlas.tasks child where child.farm_id=t.farm_id
      and (child.parent_task_id=t.id or child.metadata->>'parent_task_id'=t.id::text) and child.status<>'archived'),
    (select count(*) from atlas.tasks child where child.farm_id=t.farm_id
      and (child.parent_task_id=t.id or child.metadata->>'parent_task_id'=t.id::text) and child.status='done'),
    v_can_act and t.visibility_scope='assigned_worker'
  from selected
  join atlas.tasks t on t.id=selected.task_id
  left join atlas.zones z on z.id=t.zone_id
  order by selected.lane_order,selected.selection_rank;
end;
$function$;

create or replace function atlas.owner_capacity_plan_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_work_date date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas, auth
as $function$
declare
  v_work_date date := coalesce(p_work_date,(now() at time zone 'America/Chicago')::date);
  v_role text;
  v_member_role text;
  v_worker_key text;
  v_settings atlas.member_capacity_settings%rowtype;
  v_items jsonb := '[]'::jsonb;
  v_regular_minutes integer := 0;
  v_recovery_minutes integer := 0;
  v_heavy_minutes integer := 0;
  v_presented_count integer := 0;
  v_held_count integer := 0;
begin
  v_role := atlas.current_farm_role(p_farm_id);
  if v_role <> 'owner' then
    raise exception 'Owner farm membership required.' using errcode='42501';
  end if;

  select membership.role,membership.worker_key
  into v_member_role,v_worker_key
  from atlas.farm_memberships membership
  where membership.id=p_membership_id and membership.farm_id=p_farm_id and membership.active;
  if v_member_role is null then raise exception 'Target membership is not active on this farm.' using errcode='P0002'; end if;

  select * into v_settings from atlas.member_capacity_settings
  where membership_id=p_membership_id and farm_id=p_farm_id and active;

  select
    coalesce(jsonb_agg(jsonb_build_object(
      'taskId',task.id,'title',task.title,'dueDate',task.due_date,
      'presentationState',presented.presentation_state,
      'presentationReason',presented.presentation_reason,
      'expectedActiveMinutes',capacity.expected_active_minutes,
      'physicalLoad',capacity.physical_load,
      'baseObligationClass',capacity.base_obligation_class,
      'effectiveObligationClass',capacity.effective_obligation_class,
      'microRoundKey',capacity.micro_round_key,
      'estimateSource',capacity.estimate_source,
      'estimateConfidence',capacity.estimate_confidence,
      'recoveryOriginDueDate',capacity.recovery_origin_due_date
    ) order by presented.lane_order,presented.selection_rank),'[]'::jsonb),
    coalesce(sum(capacity.expected_active_minutes) filter(
      where presented.presentation_state='presented' and capacity.effective_obligation_class<>'recovery_work'),0)::integer,
    coalesce(sum(capacity.expected_active_minutes) filter(
      where presented.presentation_state='presented' and capacity.effective_obligation_class='recovery_work'),0)::integer,
    coalesce(sum(capacity.expected_active_minutes) filter(
      where presented.presentation_state='presented' and capacity.physical_load='heavy'),0)::integer,
    count(*) filter(where presented.presentation_state='presented')::integer,
    count(*) filter(where presented.presentation_state='held')::integer
  into v_items,v_regular_minutes,v_recovery_minutes,v_heavy_minutes,v_presented_count,v_held_count
  from atlas.presented_work_rows_v1(p_farm_id,p_membership_id,v_work_date) presented
  join atlas.tasks task on task.id=presented.task_id
  cross join lateral atlas.task_capacity_plan_v1(task,v_work_date) capacity;

  return jsonb_build_object(
    'contractVersion','owner_capacity_plan_v1',
    'farmId',p_farm_id,'membershipId',p_membership_id,'workDate',v_work_date,
    'member',jsonb_build_object('role',v_member_role,'workerKey',v_worker_key),
    'settings',jsonb_build_object(
      'regularTargetMinutes',coalesce(v_settings.regular_target_minutes,case v_member_role when 'farm_hand' then 300 when 'manager' then 360 else 480 end),
      'recoveryTargetMinutes',coalesce(v_settings.recovery_target_minutes,case v_member_role when 'farm_hand' then 90 when 'manager' then 60 else 0 end),
      'maximumPlannedMinutes',coalesce(v_settings.maximum_planned_minutes,case v_member_role when 'farm_hand' then 420 when 'manager' then 480 else 600 end),
      'heavyMinutesSoftCap',coalesce(v_settings.heavy_minutes_soft_cap,case v_member_role when 'farm_hand' then 210 when 'manager' then 240 else 300 end)
    ),
    'summary',jsonb_build_object(
      'selectedRegularMinutes',v_regular_minutes,
      'selectedRecoveryMinutes',v_recovery_minutes,
      'selectedTotalMinutes',v_regular_minutes+v_recovery_minutes,
      'selectedHeavyMinutes',v_heavy_minutes,
      'presentedCount',v_presented_count,
      'heldCount',v_held_count
    ),
    'items',v_items
  );
end;
$function$;

revoke all on function atlas.owner_capacity_plan_v1(uuid,uuid,date) from public, anon;
grant execute on function atlas.owner_capacity_plan_v1(uuid,uuid,date) to authenticated, service_role;

update atlas.authenticated_rpc_registry
set authenticated_execute_expected=false,
    service_execute_expected=true,
    classification='policy_or_composition_helper',
    confidence='verified',review_status='active',
    evidence=coalesce(evidence,'{}'::jsonb) || jsonb_build_object(
      'source','atlas_private_minute_capacity_v1',
      'authorization','internal service composition only',
      'privacy','capacity arithmetic is not callable by worker accounts',
      'reviewed_date','2026-08-04'
    ),
    reviewed_at=now()
where signature='atlas.presented_work_rows_v1(uuid, uuid, date)';

insert into atlas.authenticated_rpc_registry (
  signature,classification,confidence,review_status,
  authenticated_execute_expected,security_definer_expected,service_execute_expected,
  caller_count,policy_reference_count,evidence,registered_at,reviewed_at
) values (
  'atlas.owner_capacity_plan_v1(uuid, uuid, date)',
  'owner_admin_endpoint','verified','active',true,true,true,0,0,
  jsonb_build_object(
    'source','atlas_private_minute_capacity_v1',
    'authorization','owner role check inside security-definer function',
    'surface','future owner-only capacity tab',
    'worker_visibility','none',
    'reviewed_date','2026-08-04'
  ),now(),now()
)
on conflict (signature) do update
set classification=excluded.classification,
    confidence=excluded.confidence,
    review_status=excluded.review_status,
    authenticated_execute_expected=excluded.authenticated_execute_expected,
    security_definer_expected=excluded.security_definer_expected,
    service_execute_expected=excluded.service_execute_expected,
    evidence=atlas.authenticated_rpc_registry.evidence || excluded.evidence,
    reviewed_at=now();

comment on table atlas.task_capacity_profiles is
  'Owner-private capacity facts for task duration, physical load, obligation class, micro-round grouping, and recovery provenance. Never projected into worker task cards.';
comment on table atlas.member_capacity_settings is
  'Owner-private regular and recovery minute targets. Recovery capacity is additive and cannot suppress the regular work ledger.';
comment on function atlas.owner_capacity_plan_v1(uuid,uuid,date) is
  'Owner-only future-tab reader for minute capacity, physical load, obligation class, and recovery debt. No worker-facing route calls this function.';

commit;