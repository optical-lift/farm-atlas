create or replace function atlas.home_day_for_membership_v1(
  p_membership_id uuid,
  p_day date default null::date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_farm_id uuid;
  v_day date := coalesce(p_day, (now() at time zone 'America/Chicago')::date);
  v_journal jsonb;
  v_open integer := 0;
  v_done integer := 0;
begin
  select membership.farm_id
  into v_farm_id
  from atlas.farm_memberships membership
  where membership.id = p_membership_id
    and membership.active = true;

  if v_farm_id is null then
    raise exception 'Active farm membership required.' using errcode = '42501';
  end if;

  v_journal := atlas.journal_day_for_membership_v1(
    v_farm_id,
    p_membership_id,
    v_day
  );

  v_open := coalesce((v_journal #>> '{summary,open}')::integer, 0);
  v_done := coalesce((v_journal #>> '{summary,done}')::integer, 0);

  return jsonb_build_object(
    'contractVersion', 'living_day_v1',
    'farmId', v_farm_id,
    'date', v_day,
    'journal', v_journal,
    'carriedRhythms', '[]'::jsonb,
    'ownerDecisions', '[]'::jsonb,
    'goals', '[]'::jsonb,
    'unlockedToday', coalesce(v_journal -> 'unlocks', '[]'::jsonb),
    'completionSummary', jsonb_build_object(
      'readyToShow', v_open = 0,
      'plannedOpen', v_open,
      'plannedDone', v_done,
      'completed', v_done,
      'partial', 0,
      'migrated', 0,
      'blocked', 0,
      'restored', 0,
      'advanced', 0,
      'unlocked', 0
    ),
    'rules', jsonb_build_object(
      'denominator', 'bounded_day_plan_only',
      'carriedExcluded', true,
      'goalsExcluded', true,
      'unlockedTodayExcluded', true,
      'timeMayExpireStewardshipButNotClaimPhysicalCondition', true
    )
  );
end;
$function$;
