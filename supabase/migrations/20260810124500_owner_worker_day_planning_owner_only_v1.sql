begin;

create or replace function atlas.owner_worker_day_plan_api_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas, public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1
    from atlas.farm_memberships fm
    where fm.farm_id = p_farm_id
      and fm.user_id = auth.uid()
      and fm.role = 'owner'
      and fm.status = 'active'
  ) then
    raise exception 'Owner access required';
  end if;

  return atlas.owner_worker_day_plan_v1(
    p_farm_id,
    p_membership_id,
    p_day,
    p_now
  );
end;
$$;

create or replace function atlas.owner_build_worker_day_schedule_api_v2(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date,
  p_candidate_ids uuid[],
  p_commit_token text,
  p_client_batch_id uuid,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas, public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1
    from atlas.farm_memberships fm
    where fm.farm_id = p_farm_id
      and fm.user_id = auth.uid()
      and fm.role = 'owner'
      and fm.status = 'active'
  ) then
    raise exception 'Owner access required to build day schedules';
  end if;

  return atlas.owner_build_worker_day_schedule_v2(
    p_farm_id,
    p_membership_id,
    p_day,
    p_candidate_ids,
    p_commit_token,
    p_client_batch_id,
    p_now
  );
end;
$$;

comment on function atlas.owner_worker_day_plan_api_v1(uuid, uuid, date, timestamptz)
  is 'Authenticated owner-only worker-day planning read wrapper.';

comment on function atlas.owner_build_worker_day_schedule_api_v2(uuid, uuid, date, uuid[], text, uuid, timestamptz)
  is 'Authenticated owner-only worker-day schedule commit wrapper.';

commit;
