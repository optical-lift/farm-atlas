-- Re-runnable integration proof for Atlas authorization boundaries.
-- This file makes no persistent changes: every fixture lookup and RPC call runs
-- inside one transaction that is rolled back at the end.

begin;

create temporary table atlas_role_boundary_results (
  test_name text primary key,
  passed boolean not null,
  detail text
) on commit drop;

do $$
declare
  elm_farm uuid;
  other_farm uuid;
  organization_id uuid;
  owner_user uuid;
  manager_user uuid;
  worker_user uuid;
  worker_membership uuid;
  expected_owner_farm_count integer;
  expected_worker_farm_count integer;
  home jsonb;
  can_act_value boolean;
begin
  select f.id, f.organization_id
  into elm_farm, organization_id
  from atlas.farms f
  where f.name = 'Elm Farm'
     or f.stable_key = 'elm_farm'
  order by case when f.name = 'Elm Farm' then 0 else 1 end
  limit 1;

  if elm_farm is null then
    raise exception 'Elm Farm fixture is required for Atlas role-boundary tests.';
  end if;

  select fm.user_id
  into owner_user
  from atlas.farm_memberships fm
  where fm.farm_id = elm_farm
    and fm.role = 'owner'
    and fm.active
  order by fm.created_at
  limit 1;

  select fm.user_id
  into manager_user
  from atlas.farm_memberships fm
  where fm.farm_id = elm_farm
    and fm.role = 'manager'
    and fm.active
  order by fm.created_at
  limit 1;

  select fm.user_id, fm.id
  into worker_user, worker_membership
  from atlas.farm_memberships fm
  where fm.farm_id = elm_farm
    and fm.role = 'farm_hand'
    and fm.active
  order by fm.created_at
  limit 1;

  select f.id
  into other_farm
  from atlas.farms f
  where f.status = 'active'
    and f.id <> elm_farm
    and not exists (
      select 1
      from atlas.farm_memberships fm
      where fm.user_id = worker_user
        and fm.farm_id = f.id
        and fm.active
    )
  order by f.created_at
  limit 1;

  if owner_user is null or manager_user is null or worker_user is null
     or worker_membership is null or other_farm is null then
    raise exception 'Owner, manager, farm-hand, and wrong-farm fixtures are required.';
  end if;

  select count(*)::integer
  into expected_owner_farm_count
  from atlas.farm_memberships fm
  join atlas.farms f on f.id = fm.farm_id
  where fm.user_id = owner_user
    and fm.active
    and f.status = 'active';

  select count(*)::integer
  into expected_worker_farm_count
  from atlas.farm_memberships fm
  join atlas.farms f on f.id = fm.farm_id
  where fm.user_id = worker_user
    and fm.active
    and f.status = 'active';

  perform set_config('request.jwt.claim.role', 'authenticated', true);

  perform set_config('request.jwt.claim.sub', owner_user::text, true);
  begin
    perform 1 from atlas.owner_list_farm_members_v1(elm_farm) limit 1;
    insert into atlas_role_boundary_results
    values ('owner_can_list_members', true, 'owner entrypoint succeeded');
  exception when others then
    insert into atlas_role_boundary_results
    values ('owner_can_list_members', false, sqlstate || ': ' || sqlerrm);
  end;

  begin
    perform atlas.owner_operator_context_v1(worker_membership);
    insert into atlas_role_boundary_results
    values ('owner_can_operate_as_worker', true, 'operator context succeeded');
  exception when others then
    insert into atlas_role_boundary_results
    values ('owner_can_operate_as_worker', false, sqlstate || ': ' || sqlerrm);
  end;

  begin
    home := atlas.universal_home_v1(
      organization_id,
      elm_farm,
      current_date + 35,
      current_date
    );
    insert into atlas_role_boundary_results
    values (
      'owner_universal_home_scope',
      jsonb_array_length(home->'farms') = expected_owner_farm_count
        and coalesce((home->'viewer'->>'hasOrganizationScope')::boolean, false),
      'farms=' || jsonb_array_length(home->'farms')
        || ', expected=' || expected_owner_farm_count
        || ', organization=' || coalesce(home->'viewer'->>'hasOrganizationScope', 'null')
    );
  exception when others then
    insert into atlas_role_boundary_results
    values ('owner_universal_home_scope', false, sqlstate || ': ' || sqlerrm);
  end;

  perform set_config('request.jwt.claim.sub', manager_user::text, true);
  begin
    perform 1 from atlas.owner_list_farm_members_v1(elm_farm) limit 1;
    insert into atlas_role_boundary_results
    values (
      'manager_cannot_list_members',
      false,
      'owner-only entrypoint unexpectedly succeeded'
    );
  exception when sqlstate '42501' then
    insert into atlas_role_boundary_results
    values ('manager_cannot_list_members', true, sqlerrm);
  when others then
    insert into atlas_role_boundary_results
    values ('manager_cannot_list_members', false, sqlstate || ': ' || sqlerrm);
  end;

  begin
    select coalesce(bool_or(can_act), false)
    into can_act_value
    from atlas.worker_task_hand_v1(elm_farm, current_date, worker_membership);

    insert into atlas_role_boundary_results
    values (
      'manager_worker_hand_is_read_only',
      not can_act_value,
      'can_act=' || can_act_value
    );
  exception when others then
    insert into atlas_role_boundary_results
    values ('manager_worker_hand_is_read_only', false, sqlstate || ': ' || sqlerrm);
  end;

  perform set_config('request.jwt.claim.sub', worker_user::text, true);
  begin
    perform atlas.farm_snapshot_for_member_v1(elm_farm);
    insert into atlas_role_boundary_results
    values ('worker_can_read_elm_snapshot', true, 'member snapshot succeeded');
  exception when others then
    insert into atlas_role_boundary_results
    values ('worker_can_read_elm_snapshot', false, sqlstate || ': ' || sqlerrm);
  end;

  begin
    perform atlas.farm_snapshot_for_member_v1(other_farm);
    insert into atlas_role_boundary_results
    values (
      'worker_cannot_read_other_farm',
      false,
      'wrong-farm snapshot unexpectedly succeeded'
    );
  exception when sqlstate '42501' then
    insert into atlas_role_boundary_results
    values ('worker_cannot_read_other_farm', true, sqlerrm);
  when others then
    insert into atlas_role_boundary_results
    values ('worker_cannot_read_other_farm', false, sqlstate || ': ' || sqlerrm);
  end;

  begin
    perform 1
    from atlas.worker_task_hand_v1(elm_farm, current_date, worker_membership)
    limit 1;
    insert into atlas_role_boundary_results
    values ('worker_can_open_own_hand', true, 'worker hand succeeded');
  exception when others then
    insert into atlas_role_boundary_results
    values ('worker_can_open_own_hand', false, sqlstate || ': ' || sqlerrm);
  end;

  begin
    perform 1
    from atlas.worker_task_hand_v1(other_farm, current_date, null)
    limit 1;
    insert into atlas_role_boundary_results
    values (
      'worker_cannot_open_other_farm_hand',
      false,
      'wrong-farm hand unexpectedly succeeded'
    );
  exception when sqlstate '42501' then
    insert into atlas_role_boundary_results
    values ('worker_cannot_open_other_farm_hand', true, sqlerrm);
  when others then
    insert into atlas_role_boundary_results
    values ('worker_cannot_open_other_farm_hand', false, sqlstate || ': ' || sqlerrm);
  end;

  begin
    perform atlas.owner_operator_context_v1(worker_membership);
    insert into atlas_role_boundary_results
    values (
      'worker_cannot_enter_operator_mode',
      false,
      'owner operator context unexpectedly succeeded'
    );
  exception when sqlstate '42501' then
    insert into atlas_role_boundary_results
    values ('worker_cannot_enter_operator_mode', true, sqlerrm);
  when others then
    insert into atlas_role_boundary_results
    values ('worker_cannot_enter_operator_mode', false, sqlstate || ': ' || sqlerrm);
  end;

  begin
    home := atlas.universal_home_v1(
      organization_id,
      elm_farm,
      current_date + 35,
      current_date
    );
    insert into atlas_role_boundary_results
    values (
      'worker_universal_home_scope',
      jsonb_array_length(home->'farms') = expected_worker_farm_count
        and not coalesce((home->'viewer'->>'hasOrganizationScope')::boolean, false),
      'farms=' || jsonb_array_length(home->'farms')
        || ', expected=' || expected_worker_farm_count
        || ', organization=' || coalesce(home->'viewer'->>'hasOrganizationScope', 'null')
    );
  exception when others then
    insert into atlas_role_boundary_results
    values ('worker_universal_home_scope', false, sqlstate || ': ' || sqlerrm);
  end;
end
$$;

do $$
declare
  failed_tests text;
begin
  select string_agg(test_name || ': ' || coalesce(detail, ''), E'\n' order by test_name)
  into failed_tests
  from atlas_role_boundary_results
  where not passed;

  if failed_tests is not null then
    raise exception 'Atlas role-boundary tests failed:%', E'\n' || failed_tests;
  end if;
end
$$;

select *
from atlas_role_boundary_results
order by test_name;

rollback;
