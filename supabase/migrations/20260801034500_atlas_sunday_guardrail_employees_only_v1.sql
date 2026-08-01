begin;

create or replace function atlas.enforce_no_sunday_task_due_date()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_original_due date;
  v_assigned_role text;
begin
  if new.due_date is null or extract(dow from new.due_date) <> 0 then
    return new;
  end if;

  if coalesce((new.metadata ->> 'allow_sunday')::boolean, false) is true then
    return new;
  end if;

  if new.assigned_membership_id is not null then
    select membership.role
    into v_assigned_role
    from atlas.farm_memberships membership
    where membership.id = new.assigned_membership_id
      and membership.farm_id = new.farm_id;
  elsif new.assigned_user_id is not null then
    select membership.role
    into v_assigned_role
    from atlas.farm_memberships membership
    where membership.user_id = new.assigned_user_id
      and membership.farm_id = new.farm_id
      and membership.active
    order by case membership.role
      when 'owner' then 1
      when 'manager' then 2
      when 'farm_hand' then 3
      else 4
    end
    limit 1;
  end if;

  v_assigned_role := coalesce(
    v_assigned_role,
    nullif(new.metadata ->> 'executor_role', ''),
    case lower(coalesce(new.metadata ->> 'assignee_key', ''))
      when 'owner' then 'owner'
      when 'marshall' then 'manager'
      when 'anna' then 'farm_hand'
      else null
    end
  );

  if v_assigned_role is distinct from 'farm_hand' then
    new.metadata := (
      coalesce(new.metadata, '{}'::jsonb)
      - 'sunday_guardrail_applied'
      - 'sunday_guardrail_original_due_date'
      - 'sunday_guardrail_shifted_to'
      - 'sunday_guardrail_applied_at'
      - 'sunday_guardrail_reason'
    ) || jsonb_build_object(
      'sunday_guardrail_exempt_role', coalesce(v_assigned_role, 'unassigned'),
      'sunday_guardrail_exempt_at', now(),
      'sunday_guardrail_exempt_reason', 'Sunday guardrail applies only to employee-assigned work'
    );
    return new;
  end if;

  v_original_due := new.due_date;
  new.due_date := new.due_date + 1;
  new.metadata := coalesce(new.metadata, '{}'::jsonb)
    || jsonb_build_object(
      'sunday_guardrail_applied', true,
      'sunday_guardrail_original_due_date', v_original_due::text,
      'sunday_guardrail_shifted_to', new.due_date::text,
      'sunday_guardrail_applied_at', now(),
      'sunday_guardrail_reason', 'Elm Farm employee work does not schedule regular Sunday work'
    );

  return new;
end;
$function$;

comment on function atlas.enforce_no_sunday_task_due_date() is
  'Keeps regular farm-hand work off Sunday unless allow_sunday is explicit. Owner and manager tasks may be scheduled on Sunday without an override.';

revoke all on function atlas.enforce_no_sunday_task_due_date() from public, anon, authenticated;
grant execute on function atlas.enforce_no_sunday_task_due_date() to service_role;

do $postcondition$
declare
  v_definition text;
begin
  select pg_get_functiondef(routine.oid)
  into v_definition
  from pg_proc routine
  join pg_namespace namespace on namespace.oid = routine.pronamespace
  where namespace.nspname = 'atlas'
    and routine.proname = 'enforce_no_sunday_task_due_date'
    and pg_get_function_identity_arguments(routine.oid) = '';

  if v_definition not like '%v_assigned_role is distinct from ''farm_hand''%'
    or v_definition not like '%Sunday guardrail applies only to employee-assigned work%'
    or v_definition not like '%set search_path TO ''pg_catalog'', ''atlas''%'
  then
    raise exception 'Employee-only Sunday guardrail postcondition failed.';
  end if;
end;
$postcondition$;

commit;
