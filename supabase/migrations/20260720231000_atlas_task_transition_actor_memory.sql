alter table atlas.task_transitions
  add column if not exists actor_user_id uuid references auth.users(id) on delete set null,
  add column if not exists actor_membership_id uuid references atlas.farm_memberships(id) on delete set null,
  add column if not exists actor_role text;

alter table atlas.task_transitions
  drop constraint if exists task_transitions_actor_role_check;

alter table atlas.task_transitions
  add constraint task_transitions_actor_role_check
  check (actor_role is null or actor_role in ('owner', 'manager', 'farm_hand', 'system'));

create index if not exists task_transitions_actor_membership_created_idx
on atlas.task_transitions (actor_membership_id, created_at desc)
where actor_membership_id is not null;

create or replace function atlas.derive_task_transition_actor_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_payload_user text;
  v_payload_membership text;
  v_membership_user_id uuid;
  v_membership_farm_id uuid;
  v_membership_role text;
begin
  v_payload_user := nullif(new.payload->>'actor_user_id', '');
  v_payload_membership := nullif(new.payload->>'actor_membership_id', '');

  if new.actor_user_id is null
    and v_payload_user is not null
    and v_payload_user ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{3}-[0-9a-f]{12}$'
  then
    new.actor_user_id := v_payload_user::uuid;
  end if;

  if new.actor_membership_id is null
    and v_payload_membership is not null
    and v_payload_membership ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then
    new.actor_membership_id := v_payload_membership::uuid;
  end if;

  if new.actor_role is null then
    new.actor_role := nullif(new.payload->>'actor_role', '');
  end if;

  if new.actor_membership_id is not null then
    select fm.user_id, fm.farm_id, fm.role
    into v_membership_user_id, v_membership_farm_id, v_membership_role
    from atlas.farm_memberships fm
    where fm.id = new.actor_membership_id;

    if v_membership_user_id is null then
      raise exception 'Transition actor membership does not exist.' using errcode = '23503';
    end if;

    if v_membership_farm_id <> new.farm_id then
      raise exception 'Transition actor membership belongs to a different farm.' using errcode = '23514';
    end if;

    if new.actor_user_id is null then
      new.actor_user_id := v_membership_user_id;
    elsif new.actor_user_id <> v_membership_user_id then
      raise exception 'Transition actor user does not match the actor membership.' using errcode = '23514';
    end if;

    if new.actor_role is null then
      new.actor_role := v_membership_role;
    elsif new.actor_role <> v_membership_role then
      raise exception 'Transition actor role does not match the actor membership.' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function atlas.derive_task_transition_actor_v1() from public, anon, authenticated;

drop trigger if exists task_transitions_derive_actor on atlas.task_transitions;
create trigger task_transitions_derive_actor
before insert or update of payload, actor_user_id, actor_membership_id, actor_role, farm_id
on atlas.task_transitions
for each row
execute function atlas.derive_task_transition_actor_v1();

update atlas.task_transitions tt
set actor_membership_id = (tt.payload->>'actor_membership_id')::uuid,
    actor_user_id = case
      when nullif(tt.payload->>'actor_user_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then (tt.payload->>'actor_user_id')::uuid
      else null
    end,
    actor_role = nullif(tt.payload->>'actor_role', '')
where tt.actor_membership_id is null
  and nullif(tt.payload->>'actor_membership_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and exists (
    select 1
    from atlas.farm_memberships fm
    where fm.id = (tt.payload->>'actor_membership_id')::uuid
      and fm.farm_id = tt.farm_id
  );

create or replace function atlas.worker_recent_results_v1(
  p_farm_id uuid,
  p_target_membership_id uuid default null,
  p_limit integer default 20
)
returns table (
  transition_id uuid,
  task_id uuid,
  task_title text,
  task_type text,
  transition text,
  note text,
  reason text,
  occurred_at timestamptz,
  zone_id uuid,
  zone_key text,
  zone_label text,
  actor_membership_id uuid,
  actor_display_name text,
  actor_worker_key text
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_target_membership_id uuid;
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 50));
begin
  v_target_membership_id := atlas.resolve_worker_view_membership_v1(
    p_farm_id,
    p_target_membership_id
  );

  if v_target_membership_id is null then
    return;
  end if;

  return query
  select
    tt.id,
    tt.task_id,
    coalesce(nullif(tt.payload->>'task_title', ''), t.title, 'Task'),
    coalesce(t.task_type, tt.work_class, 'general'),
    tt.transition,
    tt.note,
    tt.reason,
    tt.created_at,
    z.id,
    z.stable_key,
    z.label,
    tt.actor_membership_id,
    coalesce(up.display_name, au.email, fm.worker_key, 'Farm Hand')::text,
    fm.worker_key
  from atlas.task_transitions tt
  left join atlas.tasks t on t.id = tt.task_id
  left join atlas.zones z on z.id = coalesce(t.zone_id, nullif(tt.payload->>'zone_id', '')::uuid)
  join atlas.farm_memberships fm on fm.id = tt.actor_membership_id
  join auth.users au on au.id = fm.user_id
  left join atlas.user_profiles up on up.user_id = fm.user_id
  where tt.farm_id = p_farm_id
    and tt.actor_membership_id = v_target_membership_id
  order by tt.created_at desc, tt.id desc
  limit v_limit;
end;
$function$;

revoke all on function atlas.worker_recent_results_v1(uuid, uuid, integer) from public, anon;
grant execute on function atlas.worker_recent_results_v1(uuid, uuid, integer) to authenticated;
