alter table atlas.farm_membership_invites
  add column if not exists auth_user_id uuid references auth.users(id) on delete set null,
  add column if not exists sent_at timestamptz,
  add column if not exists accepted_at timestamptz,
  add column if not exists last_error text;

create index if not exists farm_membership_invites_auth_user_idx
on atlas.farm_membership_invites (auth_user_id)
where auth_user_id is not null;

create or replace function atlas.owner_get_membership_invite_v1(
  p_farm_id uuid,
  p_invite_id uuid
)
returns table (
  invite_id uuid,
  farm_id uuid,
  email text,
  display_name text,
  role text,
  worker_key text,
  status text,
  auth_user_id uuid
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
begin
  if not atlas.is_farm_owner(p_farm_id) then
    raise exception 'Owner membership required.' using errcode = '42501';
  end if;

  return query
  select
    fi.id,
    fi.farm_id,
    fi.email,
    fi.display_name,
    fi.role,
    fi.worker_key,
    fi.status,
    fi.auth_user_id
  from atlas.farm_membership_invites fi
  where fi.id = p_invite_id
    and fi.farm_id = p_farm_id
    and fi.status in ('draft', 'error');
end;
$function$;

revoke all on function atlas.owner_get_membership_invite_v1(uuid, uuid) from public, anon;
grant execute on function atlas.owner_get_membership_invite_v1(uuid, uuid) to authenticated;

create or replace function atlas.owner_mark_membership_invite_sent_v1(
  p_farm_id uuid,
  p_invite_id uuid,
  p_auth_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_invite_email text;
  v_auth_email text;
begin
  if not atlas.is_farm_owner(p_farm_id) then
    raise exception 'Owner membership required.' using errcode = '42501';
  end if;

  select fi.email
  into v_invite_email
  from atlas.farm_membership_invites fi
  where fi.id = p_invite_id
    and fi.farm_id = p_farm_id
    and fi.status in ('draft', 'error')
  for update;

  if v_invite_email is null then
    return false;
  end if;

  select lower(au.email)
  into v_auth_email
  from auth.users au
  where au.id = p_auth_user_id;

  if v_auth_email is null or v_auth_email <> lower(v_invite_email) then
    raise exception 'Invited Auth user does not match the invitation email.' using errcode = '23514';
  end if;

  update atlas.farm_membership_invites
  set status = 'sent',
      auth_user_id = p_auth_user_id,
      sent_at = now(),
      last_error = null,
      updated_at = now()
  where id = p_invite_id
    and farm_id = p_farm_id;

  return true;
end;
$function$;

revoke all on function atlas.owner_mark_membership_invite_sent_v1(uuid, uuid, uuid) from public, anon;
grant execute on function atlas.owner_mark_membership_invite_sent_v1(uuid, uuid, uuid) to authenticated;

create or replace function atlas.owner_mark_membership_invite_error_v1(
  p_farm_id uuid,
  p_invite_id uuid,
  p_error text
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
  set status = 'error',
      last_error = left(coalesce(p_error, 'Invitation send failed.'), 1000),
      updated_at = now()
  where id = p_invite_id
    and farm_id = p_farm_id
    and status in ('draft', 'error');

  return found;
end;
$function$;

revoke all on function atlas.owner_mark_membership_invite_error_v1(uuid, uuid, text) from public, anon;
grant execute on function atlas.owner_mark_membership_invite_error_v1(uuid, uuid, text) to authenticated;

create or replace function atlas.pending_membership_invite_for_current_user_v1(
  p_invite_id uuid
)
returns table (
  invite_id uuid,
  farm_id uuid,
  farm_name text,
  display_name text,
  role text,
  worker_key text,
  status text
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_email text;
begin
  if auth.uid() is null then
    return;
  end if;

  select lower(au.email)
  into v_email
  from auth.users au
  where au.id = auth.uid();

  return query
  select
    fi.id,
    fi.farm_id,
    f.name,
    fi.display_name,
    fi.role,
    fi.worker_key,
    fi.status
  from atlas.farm_membership_invites fi
  join atlas.farms f on f.id = fi.farm_id
  where fi.id = p_invite_id
    and fi.status = 'sent'
    and lower(fi.email) = v_email
    and (fi.auth_user_id is null or fi.auth_user_id = auth.uid());
end;
$function$;

revoke all on function atlas.pending_membership_invite_for_current_user_v1(uuid) from public, anon;
grant execute on function atlas.pending_membership_invite_for_current_user_v1(uuid) to authenticated;

create or replace function atlas.accept_membership_invite_v1(
  p_invite_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_invite atlas.farm_membership_invites%rowtype;
  v_membership_id uuid;
  v_assigned_task_count integer := 0;
  v_permissions jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select lower(au.email)
  into v_email
  from auth.users au
  where au.id = v_user_id;

  select fi.*
  into v_invite
  from atlas.farm_membership_invites fi
  where fi.id = p_invite_id
    and fi.status = 'sent'
  for update;

  if v_invite.id is null
    or lower(v_invite.email) <> v_email
    or (v_invite.auth_user_id is not null and v_invite.auth_user_id <> v_user_id)
  then
    raise exception 'This invitation is not available to the signed-in account.' using errcode = '42501';
  end if;

  insert into atlas.user_profiles (
    user_id,
    display_name,
    default_farm_id,
    active,
    metadata,
    updated_at
  ) values (
    v_user_id,
    v_invite.display_name,
    v_invite.farm_id,
    true,
    jsonb_build_object('accepted_invite_id', v_invite.id),
    now()
  )
  on conflict (user_id) do update
  set display_name = excluded.display_name,
      default_farm_id = coalesce(atlas.user_profiles.default_farm_id, excluded.default_farm_id),
      active = true,
      metadata = coalesce(atlas.user_profiles.metadata, '{}'::jsonb) || excluded.metadata,
      updated_at = now();

  v_permissions := case v_invite.role
    when 'manager' then jsonb_build_object(
      'coordinate_farm', true,
      'view_worker_progress', true
    )
    else jsonb_build_object(
      'submit_task_results', true
    )
  end;

  insert into atlas.farm_memberships (
    user_id,
    farm_id,
    role,
    worker_key,
    active,
    permissions,
    updated_at
  ) values (
    v_user_id,
    v_invite.farm_id,
    v_invite.role,
    v_invite.worker_key,
    true,
    v_permissions,
    now()
  )
  on conflict (user_id, farm_id) do update
  set role = excluded.role,
      worker_key = excluded.worker_key,
      active = true,
      permissions = excluded.permissions,
      updated_at = now()
  returning id into v_membership_id;

  if v_invite.role = 'farm_hand' and v_invite.worker_key is not null then
    update atlas.tasks t
    set assigned_membership_id = v_membership_id,
        updated_at = now()
    where t.farm_id = v_invite.farm_id
      and t.visibility_scope = 'assigned_worker'
      and t.assigned_membership_id is null
      and (
        lower(coalesce(t.metadata->>'assigned_to', '')) = lower(v_invite.worker_key)
        or lower(coalesce(t.metadata->>'assignee_key', '')) = lower(v_invite.worker_key)
        or lower(coalesce(t.metadata->>'work_route', '')) = lower(v_invite.worker_key)
        or (
          lower(v_invite.worker_key) = 'anna'
          and t.metadata->>'anna_task' = 'true'
        )
      );

    get diagnostics v_assigned_task_count = row_count;
  end if;

  update atlas.farm_membership_invites
  set status = 'accepted',
      auth_user_id = v_user_id,
      accepted_at = now(),
      last_error = null,
      updated_at = now()
  where id = v_invite.id;

  return jsonb_build_object(
    'membershipId', v_membership_id,
    'farmId', v_invite.farm_id,
    'role', v_invite.role,
    'workerKey', v_invite.worker_key,
    'assignedTaskCount', v_assigned_task_count
  );
end;
$function$;

revoke all on function atlas.accept_membership_invite_v1(uuid) from public, anon;
grant execute on function atlas.accept_membership_invite_v1(uuid) to authenticated;
