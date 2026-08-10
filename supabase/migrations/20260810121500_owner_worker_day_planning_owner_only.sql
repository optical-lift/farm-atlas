begin;

create or replace function atlas.owner_worker_day_plan_api_v1(
  p_farm_id uuid,
  p_worker_user_id uuid,
  p_work_date date,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas, auth
as $$
declare
  v_owner_allowed boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select exists (
    select 1
    from atlas.farm_memberships fm
    where fm.farm_id = p_farm_id
      and fm.user_id = auth.uid()
      and fm.role = 'owner'
      and fm.status = 'active'
  )
  into v_owner_allowed;

  if not v_owner_allowed then
    raise exception 'Only an active owner can read worker day plans';
  end if;

  return atlas.owner_worker_day_plan_v1(
    p_farm_id,
    p_worker_user_id,
    p_work_date,
    p_now
  );
end;
$$;

revoke all on function atlas.owner_worker_day_plan_api_v1(uuid, uuid, date, timestamptz) from public;
grant execute on function atlas.owner_worker_day_plan_api_v1(uuid, uuid, date, timestamptz) to authenticated;
grant execute on function atlas.owner_worker_day_plan_api_v1(uuid, uuid, date, timestamptz) to service_role;

create or replace function atlas.owner_build_worker_day_schedule_api_v2(
  p_farm_id uuid,
  p_worker_user_id uuid,
  p_work_date date,
  p_candidate_ids uuid[],
  p_commit_token text,
  p_client_batch_id uuid,
  p_time_zone text default 'America/New_York',
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas, auth
as $$
declare
  v_owner_allowed boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select exists (
    select 1
    from atlas.farm_memberships fm
    where fm.farm_id = p_farm_id
      and fm.user_id = auth.uid()
      and fm.role = 'owner'
      and fm.status = 'active'
  )
  into v_owner_allowed;

  if not v_owner_allowed then
    raise exception 'Only an active owner can commit worker day schedules';
  end if;

  return atlas.owner_build_worker_day_schedule_v2(
    p_farm_id,
    p_worker_user_id,
    p_work_date,
    p_candidate_ids,
    p_commit_token,
    p_client_batch_id,
    p_time_zone,
    p_now
  );
end;
$$;

revoke all on function atlas.owner_build_worker_day_schedule_api_v2(uuid, uuid, date, uuid[], text, uuid, text, timestamptz) from public;
grant execute on function atlas.owner_build_worker_day_schedule_api_v2(uuid, uuid, date, uuid[], text, uuid, text, timestamptz) to authenticated;
grant execute on function atlas.owner_build_worker_day_schedule_api_v2(uuid, uuid, date, uuid[], text, uuid, text, timestamptz) to service_role;

comment on function atlas.owner_worker_day_plan_api_v1(uuid, uuid, date, timestamptz)
  is 'Authenticated owner-only worker-day planning read wrapper.';
comment on function atlas.owner_build_worker_day_schedule_api_v2(uuid, uuid, date, uuid[], text, uuid, text, timestamptz)
  is 'Authenticated owner-only worker-day schedule commit wrapper.';

commit;
