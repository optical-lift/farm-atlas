create table if not exists atlas.member_unavailability (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  membership_id uuid not null references atlas.farm_memberships(id) on delete cascade,
  stable_key text not null,
  unavailable_start date not null,
  unavailable_end date not null,
  reason text,
  source text not null default 'owner_instruction',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint member_unavailability_date_order check (unavailable_end >= unavailable_start),
  constraint member_unavailability_stable_key_unique unique (farm_id, stable_key)
);

create index if not exists member_unavailability_lookup_idx
  on atlas.member_unavailability (farm_id, membership_id, unavailable_start, unavailable_end)
  where active = true;

alter table atlas.member_unavailability enable row level security;

insert into atlas.member_unavailability (
  farm_id, membership_id, stable_key, unavailable_start, unavailable_end,
  reason, source, active, updated_at
)
select
  f.id,
  fm.id,
  'anna_tennessee_return_20260803',
  date '2026-08-03',
  date '2026-08-03',
  'Anna is in Tennessee through Monday evening and resumes Elm Farm work Tuesday, August 4.',
  'owner_instruction_20260803',
  true,
  now()
from atlas.farms f
join atlas.farm_memberships fm
  on fm.farm_id = f.id
 and fm.worker_key = 'anna'
 and fm.active = true
where f.stable_key = 'elm_farm'
on conflict (farm_id, stable_key) do update
set membership_id = excluded.membership_id,
    unavailable_start = excluded.unavailable_start,
    unavailable_end = excluded.unavailable_end,
    reason = excluded.reason,
    source = excluded.source,
    active = true,
    updated_at = now();

create or replace function atlas.presented_work_rows_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_work_date date default null::date
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
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_work_date date := coalesce(p_work_date, (now() at time zone 'America/Chicago')::date);
  v_target_role text;
begin
  select fm.role
  into v_target_role
  from atlas.farm_memberships fm
  where fm.id = p_membership_id
    and fm.farm_id = p_farm_id
    and fm.active = true;

  if v_target_role is null then
    raise exception 'Target membership is not active on this farm.' using errcode = '42501';
  end if;

  if exists (
    select 1
    from atlas.member_unavailability unavailable
    where unavailable.farm_id = p_farm_id
      and unavailable.membership_id = p_membership_id
      and unavailable.active = true
      and v_work_date between unavailable.unavailable_start and unavailable.unavailable_end
  ) then
    return;
  end if;

  if extract(dow from v_work_date) = 0 and v_target_role = 'farm_hand' then
    return query
    with allowed as (
      select row.*
      from atlas.presented_work_rows_unfiltered_v1(p_farm_id, p_membership_id, v_work_date) row
      join atlas.tasks t on t.id = row.task_id
      where t.due_date = v_work_date
        and t.assigned_membership_id = p_membership_id
        and coalesce((t.metadata ->> 'allow_sunday')::boolean, false) is true
        and coalesce((t.metadata ->> 'owner_schedule_override')::boolean, false) is true
    )
    select
      allowed.task_id,
      'presented'::text,
      'owner_sunday_override'::text,
      allowed.lane_order,
      row_number() over (
        order by allowed.lane_order, allowed.selection_rank, allowed.task_id
      )::bigint,
      allowed.work_lane,
      allowed.commitment_kind,
      allowed.effort_units,
      allowed.budget_units,
      allowed.notification_planned,
      false,
      allowed.task_card
    from allowed
    order by 4, 5;

    return;
  end if;

  return query
  select row.*
  from atlas.presented_work_rows_unfiltered_v1(p_farm_id, p_membership_id, v_work_date) row;
end;
$function$;

-- A previous generic backfill labeled unrelated work as Germination collection members.
update atlas.tasks t
set metadata = coalesce(t.metadata, '{}'::jsonb)
      - 'collection_member_key'
      - 'germination_variety_key',
    updated_at = now()
where t.farm_id = (select id from atlas.farms where stable_key = 'elm_farm')
  and t.task_type <> 'germination_check'
  and (
    coalesce(t.metadata ->> 'collection_member_key', '') like 'germination:%'
    or t.metadata ? 'germination_variety_key'
  );

-- Real Anna germination checks must be real assigned cards, not system-internal shells.
with context as (
  select f.id as farm_id, fm.id as membership_id, fm.user_id
  from atlas.farms f
  join atlas.farm_memberships fm
    on fm.farm_id = f.id
   and fm.worker_key = 'anna'
   and fm.active = true
  where f.stable_key = 'elm_farm'
), repaired as (
  update atlas.tasks t
  set assigned_membership_id = context.membership_id,
      assigned_user_id = context.user_id,
      visibility_scope = 'assigned_worker',
      action_key = 'germination_check',
      metadata = coalesce(t.metadata, '{}'::jsonb) || jsonb_build_object(
        'assigned_to', 'Anna',
        'assignee_key', 'anna',
        'executor_worker_key', 'anna',
        'executor_membership_id', context.membership_id,
        'executor_label', 'Anna',
        'task_style', 'germination_check',
        'collection_member_key', 'germination:' || atlas.germination_variety_key_v1(t.metadata, t.title) || ':' || coalesce(t.due_date::text, 'open'),
        'germination_variety_key', atlas.germination_variety_key_v1(t.metadata, t.title),
        'germination_delivery_repaired_at', now(),
        'germination_delivery_repair_source', 'owner_instruction_20260803'
      ),
      updated_at = now()
  from context
  where t.farm_id = context.farm_id
    and t.status in ('open', 'blocked')
    and t.task_type = 'germination_check'
    and (
      lower(coalesce(t.metadata ->> 'assigned_to', '')) = 'anna'
      or lower(coalesce(t.metadata ->> 'assignee_key', '')) = 'anna'
      or lower(coalesce(t.metadata ->> 'executor_worker_key', '')) = 'anna'
      or lower(coalesce(t.metadata ->> 'anna_task', 'false')) in ('true','yes','1')
    )
  returning t.id, t.assigned_membership_id, t.assigned_user_id, t.visibility_scope, t.metadata
)
update atlas.planned_work_occurrences pwo
set task_payload = jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            coalesce(pwo.task_payload, '{}'::jsonb),
            '{assigned_membership_id}',
            to_jsonb(repaired.assigned_membership_id),
            true
          ),
          '{assigned_user_id}',
          to_jsonb(repaired.assigned_user_id),
          true
        ),
        '{visibility_scope}',
        to_jsonb(repaired.visibility_scope),
        true
      ),
      '{metadata}',
      coalesce(pwo.task_payload -> 'metadata', '{}'::jsonb) || repaired.metadata,
      true
    ),
    updated_at = now()
from repaired
where pwo.released_task_id = repaired.id;
