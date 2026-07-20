create table if not exists atlas.farm_membership_invites (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  email text not null,
  display_name text not null,
  role text not null,
  worker_key text,
  status text not null default 'draft',
  invited_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint farm_membership_invites_role_check
    check (role in ('manager', 'farm_hand')),
  constraint farm_membership_invites_status_check
    check (status in ('draft', 'sent', 'accepted', 'revoked', 'error')),
  constraint farm_membership_invites_worker_key_check
    check (
      (role = 'manager')
      or (role = 'farm_hand' and worker_key is not null and length(btrim(worker_key)) > 0)
    ),
  constraint farm_membership_invites_email_check
    check (email = lower(btrim(email)) and position('@' in email) > 1),
  constraint farm_membership_invites_display_name_check
    check (length(btrim(display_name)) > 0)
);

alter table atlas.farm_membership_invites enable row level security;
revoke all on table atlas.farm_membership_invites from public, anon, authenticated;

create unique index if not exists farm_membership_invites_active_email_idx
on atlas.farm_membership_invites (farm_id, lower(email))
where status in ('draft', 'sent');

create unique index if not exists farm_membership_invites_active_worker_key_idx
on atlas.farm_membership_invites (farm_id, lower(worker_key))
where worker_key is not null and status in ('draft', 'sent');

create index if not exists farm_membership_invites_farm_status_idx
on atlas.farm_membership_invites (farm_id, status, created_at desc);

create or replace function atlas.owner_list_farm_members_v1(p_farm_id uuid)
returns table (
  record_kind text,
  record_id uuid,
  user_id uuid,
  email text,
  display_name text,
  role text,
  worker_key text,
  active boolean,
  status text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
begin
  if not atlas.is_farm_owner(p_farm_id) then
    raise exception 'Owner membership required.' using errcode = '42501';
  end if;

  return query
  select
    'membership'::text,
    fm.id,
    fm.user_id,
    au.email::text,
    coalesce(up.display_name, au.email, 'Atlas user')::text,
    fm.role,
    fm.worker_key,
    fm.active,
    case when fm.active then 'active' else 'inactive' end::text,
    fm.created_at
  from atlas.farm_memberships fm
  join auth.users au on au.id = fm.user_id
  left join atlas.user_profiles up on up.user_id = fm.user_id
  where fm.farm_id = p_farm_id

  union all

  select
    'invite'::text,
    fi.id,
    null::uuid,
    fi.email,
    fi.display_name,
    fi.role,
    fi.worker_key,
    false,
    fi.status,
    fi.created_at
  from atlas.farm_membership_invites fi
  where fi.farm_id = p_farm_id
    and fi.status <> 'revoked'

  order by 10 desc, 5;
end;
$function$;

revoke all on function atlas.owner_list_farm_members_v1(uuid) from public, anon;
grant execute on function atlas.owner_list_farm_members_v1(uuid) to authenticated;

create or replace function atlas.owner_prepare_membership_invite_v1(
  p_farm_id uuid,
  p_email text,
  p_display_name text,
  p_role text,
  p_worker_key text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_display_name text := btrim(coalesce(p_display_name, ''));
  v_role text := lower(btrim(coalesce(p_role, '')));
  v_worker_key text := nullif(lower(btrim(coalesce(p_worker_key, ''))), '');
  v_existing_user_id uuid;
  v_existing_membership_id uuid;
  v_invite_id uuid;
begin
  if not atlas.is_farm_owner(p_farm_id) then
    raise exception 'Owner membership required.' using errcode = '42501';
  end if;

  if v_email = '' or position('@' in v_email) <= 1 then
    raise exception 'A valid email is required.' using errcode = '22023';
  end if;

  if v_display_name = '' then
    raise exception 'A display name is required.' using errcode = '22023';
  end if;

  if v_role not in ('manager', 'farm_hand') then
    raise exception 'Role must be manager or farm_hand.' using errcode = '22023';
  end if;

  if v_role = 'farm_hand' and v_worker_key is null then
    raise exception 'A Farm Hand worker key is required.' using errcode = '22023';
  end if;

  select au.id
  into v_existing_user_id
  from auth.users au
  where lower(au.email) = v_email
  limit 1;

  if v_existing_user_id is not null then
    select fm.id
    into v_existing_membership_id
    from atlas.farm_memberships fm
    where fm.farm_id = p_farm_id
      and fm.user_id = v_existing_user_id
    limit 1;

    if v_existing_membership_id is not null then
      raise exception 'This account already has a farm membership.' using errcode = '23505';
    end if;
  end if;

  select fi.id
  into v_invite_id
  from atlas.farm_membership_invites fi
  where fi.farm_id = p_farm_id
    and lower(fi.email) = v_email
    and fi.status in ('draft', 'sent')
  limit 1;

  if v_invite_id is null then
    insert into atlas.farm_membership_invites (
      farm_id,
      email,
      display_name,
      role,
      worker_key,
      status,
      invited_by
    ) values (
      p_farm_id,
      v_email,
      v_display_name,
      v_role,
      v_worker_key,
      'draft',
      auth.uid()
    )
    returning id into v_invite_id;
  else
    update atlas.farm_membership_invites
    set display_name = v_display_name,
        role = v_role,
        worker_key = v_worker_key,
        status = 'draft',
        invited_by = auth.uid(),
        updated_at = now()
    where id = v_invite_id;
  end if;

  return v_invite_id;
end;
$function$;

revoke all on function atlas.owner_prepare_membership_invite_v1(uuid, text, text, text, text) from public, anon;
grant execute on function atlas.owner_prepare_membership_invite_v1(uuid, text, text, text, text) to authenticated;

create or replace function atlas.owner_revoke_membership_invite_v1(
  p_farm_id uuid,
  p_invite_id uuid
)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
begin
  if not atlas.is_farm_owner(p_farm_id) then
    raise exception 'Owner membership required.' using errcode = '42501';
  end if;

  update atlas.farm_membership_invites
  set status = 'revoked',
      updated_at = now()
  where id = p_invite_id
    and farm_id = p_farm_id
    and status in ('draft', 'error');

  return found;
end;
$function$;

revoke all on function atlas.owner_revoke_membership_invite_v1(uuid, uuid) from public, anon;
grant execute on function atlas.owner_revoke_membership_invite_v1(uuid, uuid) to authenticated;
