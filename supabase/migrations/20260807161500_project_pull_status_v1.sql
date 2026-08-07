-- Small read contract used by the Daily Hand selector card.
-- Atlas-only schema in the shared Noel/Atlas Supabase project.

create or replace function atlas.project_pull_status_for_member_v1(
  p_project_id uuid,
  p_membership_id uuid,
  p_day date default null
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_day date := coalesce(p_day,(now() at time zone 'America/Chicago')::date);
  v_project atlas.projects%rowtype;
  v_membership atlas.farm_memberships%rowtype;
  v_max_items integer;
  v_pull_minutes integer;
  v_used_items integer := 0;
  v_used_minutes integer := 0;
  v_available_items integer := 0;
begin
  select * into v_project
  from atlas.projects
  where id=p_project_id and status='active';
  if v_project.id is null then
    raise exception 'Active project not found.' using errcode='P0002';
  end if;

  select * into v_membership
  from atlas.farm_memberships
  where id=p_membership_id and farm_id=v_project.farm_id and active;
  if v_membership.id is null then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;

  if auth.uid() is not null
     and v_membership.user_id <> auth.uid()
     and not atlas.is_farm_owner(v_membership.farm_id) then
    raise exception 'Only the member or farm owner may inspect project pull status.' using errcode='42501';
  end if;

  v_max_items := greatest(coalesce(nullif((v_project.metadata->>'daily_pull_max_items')::integer,0),1),1);
  v_pull_minutes := greatest(coalesce(nullif((v_project.metadata->>'daily_pull_minutes')::integer,0),90),1);

  select count(*)::integer,coalesce(sum(item.expected_active_minutes),0)::integer
  into v_used_items,v_used_minutes
  from atlas.project_pull_selections selection
  join atlas.project_pull_items item on item.id=selection.project_item_id
  where selection.project_id=v_project.id
    and selection.membership_id=v_membership.id
    and selection.service_date=v_day
    and selection.state in ('selected','completed');

  select count(*)::integer
  into v_available_items
  from atlas.project_pull_items item
  where item.project_id=v_project.id
    and item.status='available'
    and (item.preferred_membership_id is null or item.preferred_membership_id=v_membership.id)
    and not exists (
      select 1
      from atlas.project_pull_item_dependencies dependency
      join atlas.project_pull_items prerequisite on prerequisite.id=dependency.prerequisite_item_id
      where dependency.project_item_id=item.id
        and prerequisite.status <> dependency.required_status
    );

  return jsonb_build_object(
    'contractVersion','project_pull_status_v1',
    'projectId',v_project.id,
    'projectTitle',v_project.title,
    'serviceDate',v_day,
    'enabled',coalesce((v_project.metadata->>'daily_pull_enabled')::boolean,false),
    'dailyPullMaxItems',v_max_items,
    'dailyPullMinutes',v_pull_minutes,
    'usedItems',v_used_items,
    'remainingItems',greatest(v_max_items-v_used_items,0),
    'usedPullMinutes',v_used_minutes,
    'remainingPullMinutes',greatest(v_pull_minutes-v_used_minutes,0),
    'availableItemCount',v_available_items,
    'completeForToday',v_used_items >= v_max_items
  );
end;
$function$;

revoke all on function atlas.project_pull_status_for_member_v1(uuid,uuid,date) from public;
grant execute on function atlas.project_pull_status_for_member_v1(uuid,uuid,date) to authenticated,service_role;

insert into atlas.authenticated_rpc_registry(
  signature,classification,confidence,review_status,authenticated_execute_expected,security_definer_expected,
  service_execute_expected,caller_count,policy_reference_count,evidence
) values (
  'atlas.project_pull_status_for_member_v1(uuid,uuid,date)',
  'app_endpoint','verified','active',true,true,true,0,0,
  jsonb_build_object('feature','project_pull_pool_v1','schema','atlas')
)
on conflict (signature) do update set
  classification=excluded.classification,
  confidence=excluded.confidence,
  review_status=excluded.review_status,
  authenticated_execute_expected=excluded.authenticated_execute_expected,
  security_definer_expected=excluded.security_definer_expected,
  service_execute_expected=excluded.service_execute_expected,
  evidence=coalesce(atlas.authenticated_rpc_registry.evidence,'{}'::jsonb)||excluded.evidence,
  reviewed_at=now();
