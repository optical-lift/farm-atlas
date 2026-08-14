begin;

create or replace function atlas.owner_operator_universal_home_v1(
  p_effective_membership_id uuid,
  p_organization_id uuid default null,
  p_preferred_farm_id uuid default null,
  p_due_through date default (current_date + 35),
  p_done_date date default current_date
)
returns jsonb
language sql
stable
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
  select atlas.owner_operator_universal_home_fast_v1(
    p_effective_membership_id,
    p_organization_id,
    p_preferred_farm_id,
    p_due_through,
    p_done_date
  );
$function$;

revoke all on function atlas.owner_operator_universal_home_v1(uuid,uuid,uuid,date,date) from public, anon;
grant execute on function atlas.owner_operator_universal_home_v1(uuid,uuid,uuid,date,date) to authenticated;

commit;
