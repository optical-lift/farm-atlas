create extension if not exists pg_net with schema extensions;

create table if not exists atlas.web_push_settings (
  singleton boolean primary key default true check (singleton),
  vapid_subject text not null,
  vapid_public_key text not null,
  vapid_private_key text not null,
  dispatch_token text not null,
  dispatcher_url text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists atlas.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  membership_id uuid references atlas.farm_memberships(id) on delete set null,
  endpoint text not null unique,
  endpoint_hash text not null,
  expiration_time timestamptz,
  p256dh text not null,
  auth_key text not null,
  device_label text,
  user_agent text,
  time_zone text not null default 'America/Chicago',
  status text not null default 'active' check (status in ('active','revoked','stale','error')),
  last_seen_at timestamptz not null default now(),
  last_success_at timestamptz,
  last_failure_at timestamptz,
  failure_count integer not null default 0,
  revoked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_farm_active
  on atlas.push_subscriptions(user_id, farm_id, status);
create index if not exists push_subscriptions_endpoint_hash
  on atlas.push_subscriptions(endpoint_hash);

create table if not exists atlas.notification_preferences (
  user_id uuid not null references auth.users(id) on delete cascade,
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  enabled boolean not null default true,
  categories jsonb not null default '{
    "rhythm_warning": true,
    "rhythm_due": true,
    "rhythm_failure": true,
    "unlock": true,
    "owner_decision": true,
    "other_player_result": false
  }'::jsonb,
  quiet_start time,
  quiet_end time,
  time_zone text not null default 'America/Chicago',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, farm_id),
  check ((quiet_start is null and quiet_end is null) or (quiet_start is not null and quiet_end is not null))
);

create table if not exists atlas.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  journal_event_id uuid references atlas.journal_event_index(id) on delete cascade,
  category text not null check (category in (
    'rhythm_warning','rhythm_due','rhythm_failure','unlock',
    'owner_decision','other_player_result','system_test'
  )),
  title text not null,
  body text not null,
  deep_link text not null default '/bell',
  badge_count integer not null default 0,
  importance text not null default 'normal',
  dedupe_key text not null unique,
  not_before timestamptz not null default now(),
  status text not null default 'pending' check (status in (
    'pending','processing','sent','partial','failed','cancelled'
  )),
  attempt_count integer not null default 0,
  processing_started_at timestamptz,
  sent_at timestamptz,
  last_error text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists notification_outbox_ready
  on atlas.notification_outbox(status, not_before, created_at);
create index if not exists notification_outbox_user_farm
  on atlas.notification_outbox(user_id, farm_id, created_at desc);
create index if not exists notification_outbox_journal_event
  on atlas.notification_outbox(journal_event_id);

create table if not exists atlas.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  outbox_id uuid not null references atlas.notification_outbox(id) on delete cascade,
  subscription_id uuid not null references atlas.push_subscriptions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in (
    'pending','processing','sent','failed','stale','cancelled'
  )),
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  last_attempt_at timestamptz,
  response_status integer,
  response_body text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (outbox_id, subscription_id)
);

create index if not exists notification_deliveries_ready
  on atlas.notification_deliveries(status, next_attempt_at, lease_until);
create index if not exists notification_deliveries_user
  on atlas.notification_deliveries(user_id, created_at desc);

alter table atlas.web_push_settings enable row level security;
alter table atlas.push_subscriptions enable row level security;
alter table atlas.notification_preferences enable row level security;
alter table atlas.notification_outbox enable row level security;
alter table atlas.notification_deliveries enable row level security;

create policy push_subscriptions_own_read
  on atlas.push_subscriptions for select to authenticated
  using (user_id = auth.uid());

create policy notification_preferences_own_read
  on atlas.notification_preferences for select to authenticated
  using (user_id = auth.uid());

create policy notification_outbox_own_read
  on atlas.notification_outbox for select to authenticated
  using (user_id = auth.uid());

create policy notification_deliveries_own_read
  on atlas.notification_deliveries for select to authenticated
  using (user_id = auth.uid());

-- VAPID and dispatcher secrets are provisioned directly in each Supabase environment.

create or replace function atlas.web_push_default_categories_v1()
returns jsonb
language sql
immutable
set search_path = pg_catalog, atlas
as $$
  select '{
    "rhythm_warning": true,
    "rhythm_due": true,
    "rhythm_failure": true,
    "unlock": true,
    "owner_decision": true,
    "other_player_result": false
  }'::jsonb;
$$;

create or replace function atlas.web_push_setup_v1(p_farm_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_membership_id uuid;
  v_public_key text;
  v_preferences atlas.notification_preferences%rowtype;
  v_subscriptions jsonb;
begin
  if v_user_id is null then
    raise exception 'Authenticated user required.' using errcode = '42501';
  end if;

  select fm.id into v_membership_id
  from atlas.farm_memberships fm
  where fm.farm_id = p_farm_id
    and fm.user_id = v_user_id
    and fm.active
  order by fm.created_at
  limit 1;
  if v_membership_id is null then
    raise exception 'An active farm membership is required.' using errcode = '42501';
  end if;

  select vapid_public_key into v_public_key
  from atlas.web_push_settings
  where singleton;

  select * into v_preferences
  from atlas.notification_preferences
  where user_id = v_user_id and farm_id = p_farm_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', subscription.id,
    'endpointHash', subscription.endpoint_hash,
    'deviceLabel', subscription.device_label,
    'status', subscription.status,
    'lastSeenAt', subscription.last_seen_at,
    'lastSuccessAt', subscription.last_success_at
  ) order by subscription.created_at desc), '[]'::jsonb)
  into v_subscriptions
  from atlas.push_subscriptions subscription
  where subscription.user_id = v_user_id
    and subscription.farm_id = p_farm_id
    and subscription.status = 'active';

  return jsonb_build_object(
    'contractVersion', 'atlas_web_push_v1',
    'farmId', p_farm_id,
    'vapidPublicKey', v_public_key,
    'subscriptions', v_subscriptions,
    'preferences', jsonb_build_object(
      'enabled', coalesce(v_preferences.enabled, true),
      'categories', coalesce(v_preferences.categories, atlas.web_push_default_categories_v1()),
      'quietStart', v_preferences.quiet_start,
      'quietEnd', v_preferences.quiet_end,
      'timeZone', coalesce(v_preferences.time_zone, 'America/Chicago')
    )
  );
end;
$$;

create or replace function atlas.notification_next_available_at_v1(
  p_user_id uuid,
  p_farm_id uuid,
  p_now timestamptz default now()
)
returns timestamptz
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_preferences atlas.notification_preferences%rowtype;
  v_zone text;
  v_local timestamp;
  v_local_time time;
  v_end_local timestamp;
begin
  select * into v_preferences
  from atlas.notification_preferences
  where user_id = p_user_id and farm_id = p_farm_id;

  if v_preferences.user_id is null
    or not v_preferences.enabled
    or v_preferences.quiet_start is null
    or v_preferences.quiet_end is null
  then
    return p_now;
  end if;

  v_zone := coalesce(nullif(v_preferences.time_zone,''), 'America/Chicago');
  if not exists (select 1 from pg_timezone_names where name = v_zone) then
    v_zone := 'America/Chicago';
  end if;

  v_local := p_now at time zone v_zone;
  v_local_time := v_local::time;

  if v_preferences.quiet_start < v_preferences.quiet_end then
    if v_local_time >= v_preferences.quiet_start and v_local_time < v_preferences.quiet_end then
      v_end_local := date_trunc('day', v_local) + v_preferences.quiet_end;
      return v_end_local at time zone v_zone;
    end if;
  else
    if v_local_time >= v_preferences.quiet_start then
      v_end_local := date_trunc('day', v_local) + interval '1 day' + v_preferences.quiet_end;
      return v_end_local at time zone v_zone;
    elsif v_local_time < v_preferences.quiet_end then
      v_end_local := date_trunc('day', v_local) + v_preferences.quiet_end;
      return v_end_local at time zone v_zone;
    end if;
  end if;

  return p_now;
end;
$$;

create or replace function atlas.notification_category_for_event_v1(p_event_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_event atlas.journal_event_index%rowtype;
begin
  select * into v_event from atlas.journal_event_index where id = p_event_id;
  if v_event.id is null then return null; end if;

  return case
    when v_event.event_kind = 'rhythm_warning' then 'rhythm_warning'
    when v_event.event_kind = 'rhythm_due' then 'rhythm_due'
    when v_event.event_kind = 'rhythm_failure' then 'rhythm_failure'
    when v_event.event_kind = 'unlock' then 'unlock'
    when v_event.event_kind = 'owner_decision' then 'owner_decision'
    when v_event.event_kind in ('task_result','maintenance_result')
      and (
        v_event.importance in ('attention','critical')
        or coalesce((v_event.payload ->> 'pushWorthy')::boolean, false)
      ) then 'other_player_result'
    else null
  end;
exception when invalid_text_representation then
  return null;
end;
$$;

create or replace function atlas.notification_can_user_read_event_v1(
  p_event_id uuid,
  p_user_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_event atlas.journal_event_index%rowtype;
  v_role text;
begin
  select * into v_event from atlas.journal_event_index where id = p_event_id;
  if v_event.id is null then return false; end if;

  select fm.role into v_role
  from atlas.farm_memberships fm
  where fm.farm_id = v_event.farm_id
    and fm.user_id = p_user_id
    and fm.active
  order by case fm.role when 'owner' then 0 when 'manager' then 1 else 2 end, fm.created_at
  limit 1;
  if v_role is null then return false; end if;

  return case v_event.visibility_scope
    when 'owner' then v_role = 'owner'
    when 'management' then v_role in ('owner','manager')
    when 'assigned_worker' then v_role in ('owner','manager') or v_event.assigned_user_id = p_user_id
    when 'project_shared' then v_role in ('owner','manager') or (
      v_event.project_id is not null and exists (
        select 1 from atlas.project_contributors contributor
        where contributor.project_id = v_event.project_id
          and contributor.user_id = p_user_id
          and contributor.active
      )
    )
    when 'system_internal' then v_role = 'owner'
    else true
  end;
end;
$$;

create or replace function atlas.bell_badge_count_for_user_v1(
  p_farm_id uuid,
  p_user_id uuid
)
returns integer
language sql
stable
security definer
set search_path = pg_catalog, atlas
as $$
  select count(*)::integer
  from atlas.journal_event_index event
  left join atlas.bell_event_receipts receipt
    on receipt.journal_event_id = event.id
   and receipt.user_id = p_user_id
  where event.farm_id = p_farm_id
    and atlas.bell_event_is_worthy_v1(event.id)
    and atlas.notification_can_user_read_event_v1(event.id, p_user_id)
    and receipt.acknowledged_at is null
    and atlas.bell_event_requires_action_v1(event.id, p_user_id);
$$;

create or replace function atlas.kick_web_push_dispatch_v1(p_source text default 'database')
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, atlas, net
as $$
declare
  v_settings atlas.web_push_settings%rowtype;
  v_request_id bigint;
begin
  select * into v_settings from atlas.web_push_settings where singleton;
  if v_settings.singleton is null then return null; end if;

  select net.http_post(
    url := v_settings.dispatcher_url,
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-atlas-dispatch-token',v_settings.dispatch_token
    ),
    body := jsonb_build_object('source',coalesce(p_source,'database'),'limit',25)
  ) into v_request_id;
  return v_request_id;
exception when others then
  return null;
end;
$$;

create or replace function atlas.enqueue_direct_push_v1(
  p_farm_id uuid,
  p_user_id uuid,
  p_category text,
  p_title text,
  p_body text,
  p_deep_link text,
  p_dedupe_key text,
  p_importance text default 'normal',
  p_not_before timestamptz default now(),
  p_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_outbox_id uuid;
begin
  insert into atlas.notification_outbox (
    farm_id,user_id,category,title,body,deep_link,badge_count,importance,
    dedupe_key,not_before,payload
  ) values (
    p_farm_id,p_user_id,p_category,left(p_title,140),left(p_body,500),
    coalesce(nullif(p_deep_link,''),'/bell'),
    atlas.bell_badge_count_for_user_v1(p_farm_id,p_user_id),
    coalesce(nullif(p_importance,''),'normal'),
    p_dedupe_key,coalesce(p_not_before,now()),coalesce(p_payload,'{}'::jsonb)
  )
  on conflict (dedupe_key) do nothing
  returning id into v_outbox_id;

  if v_outbox_id is null then return null; end if;

  insert into atlas.notification_deliveries (outbox_id,subscription_id,user_id)
  select v_outbox_id, subscription.id, p_user_id
  from atlas.push_subscriptions subscription
  where subscription.farm_id = p_farm_id
    and subscription.user_id = p_user_id
    and subscription.status = 'active'
  on conflict do nothing;

  if not exists (
    select 1 from atlas.notification_deliveries where outbox_id = v_outbox_id
  ) then
    update atlas.notification_outbox
    set status = 'cancelled', last_error = 'No active device subscription.', updated_at = now()
    where id = v_outbox_id;
    return v_outbox_id;
  end if;

  perform atlas.kick_web_push_dispatch_v1('direct');
  return v_outbox_id;
end;
$$;

create or replace function atlas.enqueue_journal_event_notifications_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_category text;
  v_title text;
  v_body text;
  v_deep_link text;
  v_user record;
  v_preferences atlas.notification_preferences%rowtype;
  v_enabled boolean;
  v_not_before timestamptz;
  v_outbox_id uuid;
  v_inserted integer := 0;
begin
  v_category := atlas.notification_category_for_event_v1(new.id);
  if v_category is null then return new; end if;

  v_title := case v_category
    when 'rhythm_warning' then 'Atlas · Coming due'
    when 'rhythm_due' then 'Atlas · Rhythm due'
    when 'rhythm_failure' then 'Atlas · Rhythm missed'
    when 'unlock' then 'Atlas · Move unlocked'
    when 'owner_decision' then 'Atlas · Owner decision'
    when 'other_player_result' then 'Atlas · Farm changed'
    else 'Atlas'
  end;
  v_body := left(coalesce(nullif(new.detail,''), nullif(new.title,''), 'A farm change is waiting in Atlas.'), 500);
  v_deep_link := atlas.bell_event_deep_link_v1(new.id);

  for v_user in
    select distinct fm.user_id, fm.role
    from atlas.farm_memberships fm
    where fm.farm_id = new.farm_id
      and fm.active
      and fm.user_id is not null
      and exists (
        select 1 from atlas.push_subscriptions subscription
        where subscription.farm_id = new.farm_id
          and subscription.user_id = fm.user_id
          and subscription.status = 'active'
      )
      and (
        (new.assigned_user_id is not null and fm.user_id = new.assigned_user_id)
        or (new.assigned_user_id is null and fm.role in ('owner','manager'))
      )
      and atlas.notification_can_user_read_event_v1(new.id, fm.user_id)
  loop
    if v_category in ('unlock','owner_decision','other_player_result')
      and new.actor_user_id is not null
      and v_user.user_id = new.actor_user_id
    then
      continue;
    end if;

    select * into v_preferences
    from atlas.notification_preferences
    where user_id = v_user.user_id and farm_id = new.farm_id;

    v_enabled := coalesce(v_preferences.enabled, true)
      and coalesce(
        (coalesce(v_preferences.categories, atlas.web_push_default_categories_v1()) ->> v_category)::boolean,
        v_category <> 'other_player_result'
      );
    if not v_enabled then continue; end if;

    v_not_before := atlas.notification_next_available_at_v1(v_user.user_id,new.farm_id,now());
    v_outbox_id := atlas.enqueue_direct_push_v1(
      new.farm_id,
      v_user.user_id,
      v_category,
      v_title,
      v_body,
      v_deep_link,
      'journal:' || new.id::text || ':user:' || v_user.user_id::text || ':' || v_category,
      new.importance,
      v_not_before,
      jsonb_build_object(
        'journalEventId',new.id,
        'eventKind',new.event_kind,
        'category',v_category,
        'journalDate',new.journal_date
      )
    );
    if v_outbox_id is not null then v_inserted := v_inserted + 1; end if;
  end loop;

  if v_inserted > 0 then
    perform atlas.kick_web_push_dispatch_v1('journal_event');
  end if;
  return new;
end;
$$;

drop trigger if exists journal_event_web_push_v1 on atlas.journal_event_index;
create trigger journal_event_web_push_v1
after insert on atlas.journal_event_index
for each row execute function atlas.enqueue_journal_event_notifications_v1();

create or replace function atlas.register_push_subscription_v1(
  p_farm_id uuid,
  p_endpoint text,
  p_expiration_time timestamptz,
  p_p256dh text,
  p_auth_key text,
  p_device_label text default null,
  p_user_agent text default null,
  p_time_zone text default 'America/Chicago',
  p_send_test boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas, auth, extensions
as $$
declare
  v_user_id uuid := auth.uid();
  v_membership_id uuid;
  v_subscription atlas.push_subscriptions%rowtype;
  v_zone text := coalesce(nullif(btrim(p_time_zone),''),'America/Chicago');
  v_test_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authenticated user required.' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_endpoint,'')),'') is null
    or nullif(btrim(coalesce(p_p256dh,'')),'') is null
    or nullif(btrim(coalesce(p_auth_key,'')),'') is null
  then
    raise exception 'A complete Web Push subscription is required.' using errcode = '22023';
  end if;
  if length(p_endpoint) > 4096 or length(p_p256dh) > 512 or length(p_auth_key) > 512 then
    raise exception 'The Web Push subscription is too large.' using errcode = '22023';
  end if;
  if not exists (select 1 from pg_timezone_names where name = v_zone) then
    v_zone := 'America/Chicago';
  end if;

  select fm.id into v_membership_id
  from atlas.farm_memberships fm
  where fm.farm_id = p_farm_id
    and fm.user_id = v_user_id
    and fm.active
  order by fm.created_at
  limit 1;
  if v_membership_id is null then
    raise exception 'An active farm membership is required.' using errcode = '42501';
  end if;

  insert into atlas.push_subscriptions (
    farm_id,user_id,membership_id,endpoint,endpoint_hash,expiration_time,
    p256dh,auth_key,device_label,user_agent,time_zone,status,last_seen_at,
    failure_count,revoked_at,updated_at
  ) values (
    p_farm_id,v_user_id,v_membership_id,btrim(p_endpoint),
    encode(digest(btrim(p_endpoint),'sha256'),'hex'),
    p_expiration_time,btrim(p_p256dh),btrim(p_auth_key),
    nullif(btrim(coalesce(p_device_label,'')),''),
    nullif(left(p_user_agent,1000),''),
    v_zone,'active',now(),0,null,now()
  )
  on conflict (endpoint) do update
  set farm_id = excluded.farm_id,
      user_id = excluded.user_id,
      membership_id = excluded.membership_id,
      expiration_time = excluded.expiration_time,
      p256dh = excluded.p256dh,
      auth_key = excluded.auth_key,
      device_label = excluded.device_label,
      user_agent = excluded.user_agent,
      time_zone = excluded.time_zone,
      status = 'active',
      last_seen_at = now(),
      failure_count = 0,
      revoked_at = null,
      updated_at = now()
  returning * into v_subscription;

  insert into atlas.notification_preferences (user_id,farm_id,time_zone)
  values (v_user_id,p_farm_id,v_zone)
  on conflict (user_id,farm_id) do update
  set time_zone = excluded.time_zone, updated_at = now();

  if p_send_test then
    v_test_id := atlas.enqueue_direct_push_v1(
      p_farm_id,
      v_user_id,
      'system_test',
      'Atlas is connected',
      'Farm Alerts will arrive here when the Bell records a change that needs you.',
      '/bell',
      'push-setup:' || v_subscription.id::text || ':' || floor(extract(epoch from now()) / 300)::bigint::text,
      'normal',
      now(),
      jsonb_build_object('subscriptionId',v_subscription.id,'test',true)
    );
  end if;

  return jsonb_build_object(
    'subscriptionId',v_subscription.id,
    'endpointHash',v_subscription.endpoint_hash,
    'status',v_subscription.status,
    'testOutboxId',v_test_id,
    'message','This device is connected to Atlas Farm Alerts.'
  );
end;
$$;

create or replace function atlas.revoke_push_subscription_v1(
  p_farm_id uuid,
  p_endpoint text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_count integer;
begin
  if v_user_id is null then
    raise exception 'Authenticated user required.' using errcode = '42501';
  end if;

  update atlas.push_subscriptions
  set status = 'revoked', revoked_at = now(), updated_at = now()
  where farm_id = p_farm_id
    and user_id = v_user_id
    and endpoint = p_endpoint
    and status <> 'revoked';
  get diagnostics v_count = row_count;

  update atlas.notification_deliveries delivery
  set status = 'cancelled', updated_at = now()
  where delivery.subscription_id in (
    select id from atlas.push_subscriptions
    where farm_id = p_farm_id and user_id = v_user_id and endpoint = p_endpoint
  )
  and delivery.status in ('pending','processing');

  return jsonb_build_object('revoked',v_count > 0,'message','Farm Alerts are disconnected from this device.');
end;
$$;

create or replace function atlas.update_notification_preferences_v1(
  p_farm_id uuid,
  p_enabled boolean,
  p_categories jsonb,
  p_quiet_start time,
  p_quiet_end time,
  p_time_zone text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_zone text := coalesce(nullif(btrim(p_time_zone),''),'America/Chicago');
  v_categories jsonb := atlas.web_push_default_categories_v1();
  v_key text;
begin
  if v_user_id is null then
    raise exception 'Authenticated user required.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from atlas.farm_memberships
    where farm_id = p_farm_id and user_id = v_user_id and active
  ) then
    raise exception 'An active farm membership is required.' using errcode = '42501';
  end if;
  if (p_quiet_start is null) <> (p_quiet_end is null) then
    raise exception 'Quiet hours require both a start and end time.' using errcode = '22023';
  end if;
  if not exists (select 1 from pg_timezone_names where name = v_zone) then
    v_zone := 'America/Chicago';
  end if;

  if jsonb_typeof(p_categories) = 'object' then
    foreach v_key in array array[
      'rhythm_warning','rhythm_due','rhythm_failure',
      'unlock','owner_decision','other_player_result'
    ] loop
      if jsonb_typeof(p_categories -> v_key) = 'boolean' then
        v_categories := jsonb_set(v_categories,array[v_key],p_categories -> v_key,true);
      end if;
    end loop;
  end if;

  insert into atlas.notification_preferences (
    user_id,farm_id,enabled,categories,quiet_start,quiet_end,time_zone,updated_at
  ) values (
    v_user_id,p_farm_id,coalesce(p_enabled,true),v_categories,
    p_quiet_start,p_quiet_end,v_zone,now()
  )
  on conflict (user_id,farm_id) do update
  set enabled = excluded.enabled,
      categories = excluded.categories,
      quiet_start = excluded.quiet_start,
      quiet_end = excluded.quiet_end,
      time_zone = excluded.time_zone,
      updated_at = now();

  return jsonb_build_object(
    'enabled',coalesce(p_enabled,true),
    'categories',v_categories,
    'quietStart',p_quiet_start,
    'quietEnd',p_quiet_end,
    'timeZone',v_zone
  );
end;
$$;

create or replace function atlas.send_push_test_v1(p_farm_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_outbox_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authenticated user required.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from atlas.farm_memberships
    where farm_id = p_farm_id and user_id = v_user_id and active
  ) then
    raise exception 'An active farm membership is required.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from atlas.push_subscriptions
    where farm_id = p_farm_id and user_id = v_user_id and status = 'active'
  ) then
    raise exception 'Connect this device before sending a test alert.' using errcode = '22023';
  end if;

  v_outbox_id := atlas.enqueue_direct_push_v1(
    p_farm_id,v_user_id,'system_test','Atlas test alert',
    'Farm Alerts are reaching this device. Tap to open the Bell.',
    '/bell',
    'push-test:' || v_user_id::text || ':' || floor(extract(epoch from now()) / 60)::bigint::text,
    'normal',now(),jsonb_build_object('test',true)
  );
  return jsonb_build_object('outboxId',v_outbox_id,'message','Test alert queued for this device.');
end;
$$;

create or replace function atlas.web_push_dispatch_config_v1(p_dispatch_token text)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, atlas
as $$
  select case when settings.dispatch_token = p_dispatch_token then jsonb_build_object(
    'vapidSubject',settings.vapid_subject,
    'vapidPublicKey',settings.vapid_public_key,
    'vapidPrivateKey',settings.vapid_private_key
  ) else null end
  from atlas.web_push_settings settings
  where settings.singleton;
$$;

create or replace function atlas.claim_notification_delivery_batch_v1(
  p_limit integer default 25,
  p_lease_seconds integer default 120
)
returns table (
  delivery_id uuid,
  outbox_id uuid,
  subscription_id uuid,
  endpoint text,
  p256dh text,
  auth_key text,
  payload jsonb,
  urgency text,
  ttl_seconds integer,
  topic text
)
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
begin
  return query
  with ready as (
    select delivery.id
    from atlas.notification_deliveries delivery
    join atlas.notification_outbox outbox on outbox.id = delivery.outbox_id
    join atlas.push_subscriptions subscription on subscription.id = delivery.subscription_id
    where delivery.status in ('pending','processing')
      and delivery.next_attempt_at <= now()
      and (delivery.lease_until is null or delivery.lease_until < now())
      and outbox.status in ('pending','processing')
      and outbox.not_before <= now()
      and subscription.status = 'active'
    order by outbox.importance desc, outbox.created_at, delivery.created_at
    for update of delivery skip locked
    limit least(greatest(coalesce(p_limit,25),1),100)
  ),
  claimed as (
    update atlas.notification_deliveries delivery
    set status = 'processing',
        lease_until = now() + make_interval(secs => least(greatest(coalesce(p_lease_seconds,120),30),600)),
        last_attempt_at = now(),
        attempt_count = delivery.attempt_count + 1,
        updated_at = now()
    from ready
    where delivery.id = ready.id
    returning delivery.*
  ),
  touched as (
    update atlas.notification_outbox outbox
    set status = 'processing',
        processing_started_at = coalesce(outbox.processing_started_at,now()),
        attempt_count = outbox.attempt_count + 1,
        updated_at = now()
    where outbox.id in (select distinct claimed.outbox_id from claimed)
    returning outbox.id
  )
  select
    claimed.id,
    outbox.id,
    subscription.id,
    subscription.endpoint,
    subscription.p256dh,
    subscription.auth_key,
    jsonb_build_object(
      'title',outbox.title,
      'body',outbox.body,
      'deepLink',outbox.deep_link,
      'badgeCount',outbox.badge_count,
      'tag',left(outbox.dedupe_key,64),
      'dedupeKey',outbox.dedupe_key,
      'eventId',outbox.journal_event_id,
      'outboxId',outbox.id,
      'category',outbox.category,
      'importance',outbox.importance
    ) || coalesce(outbox.payload,'{}'::jsonb),
    case when outbox.importance in ('attention','critical') or outbox.category in ('rhythm_due','rhythm_failure','owner_decision')
      then 'high' else 'normal' end,
    case when outbox.category = 'rhythm_warning' then 259200 else 86400 end,
    left(encode(digest(outbox.dedupe_key,'sha256'),'hex'),32)
  from claimed
  join atlas.notification_outbox outbox on outbox.id = claimed.outbox_id
  join atlas.push_subscriptions subscription on subscription.id = claimed.subscription_id;
end;
$$;

create or replace function atlas.record_notification_delivery_result_v1(
  p_delivery_id uuid,
  p_success boolean,
  p_status_code integer,
  p_response_body text,
  p_stale boolean default false,
  p_retryable boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_delivery atlas.notification_deliveries%rowtype;
  v_outbox_id uuid;
  v_subscription_id uuid;
  v_attempts integer;
  v_outbox_status text;
begin
  select * into v_delivery
  from atlas.notification_deliveries
  where id = p_delivery_id
  for update;
  if v_delivery.id is null then
    raise exception 'Notification delivery not found.' using errcode = 'P0002';
  end if;

  v_outbox_id := v_delivery.outbox_id;
  v_subscription_id := v_delivery.subscription_id;
  v_attempts := v_delivery.attempt_count;

  update atlas.notification_deliveries
  set status = case
        when p_success then 'sent'
        when p_stale then 'stale'
        when p_retryable and v_attempts < 5 then 'pending'
        else 'failed'
      end,
      next_attempt_at = case
        when not p_success and not p_stale and p_retryable and v_attempts < 5
          then now() + make_interval(secs => least(3600, 30 * power(2,greatest(v_attempts - 1,0))::integer))
        else next_attempt_at
      end,
      lease_until = null,
      response_status = p_status_code,
      response_body = left(coalesce(p_response_body,''),2000),
      sent_at = case when p_success then now() else sent_at end,
      updated_at = now()
  where id = p_delivery_id;

  if p_success then
    update atlas.push_subscriptions
    set last_success_at = now(), failure_count = 0, status = 'active', updated_at = now()
    where id = v_subscription_id;
  else
    update atlas.push_subscriptions
    set last_failure_at = now(),
        failure_count = failure_count + 1,
        status = case when p_stale then 'stale' else status end,
        updated_at = now()
    where id = v_subscription_id;
  end if;

  if exists (
    select 1 from atlas.notification_deliveries
    where outbox_id = v_outbox_id and status in ('pending','processing')
  ) then
    v_outbox_status := 'processing';
  elsif exists (
    select 1 from atlas.notification_deliveries
    where outbox_id = v_outbox_id and status = 'sent'
  ) and exists (
    select 1 from atlas.notification_deliveries
    where outbox_id = v_outbox_id and status in ('failed','stale','cancelled')
  ) then
    v_outbox_status := 'partial';
  elsif exists (
    select 1 from atlas.notification_deliveries
    where outbox_id = v_outbox_id and status = 'sent'
  ) then
    v_outbox_status := 'sent';
  else
    v_outbox_status := 'failed';
  end if;

  update atlas.notification_outbox
  set status = v_outbox_status,
      sent_at = case when v_outbox_status in ('sent','partial') then now() else sent_at end,
      last_error = case when p_success then last_error else left(coalesce(p_response_body,'Push delivery failed.'),2000) end,
      updated_at = now()
  where id = v_outbox_id;

  return jsonb_build_object(
    'deliveryId',p_delivery_id,
    'status',v_outbox_status,
    'retryScheduled',not p_success and not p_stale and p_retryable and v_attempts < 5
  );
end;
$$;

revoke all on table atlas.web_push_settings from public, anon, authenticated;
revoke all on table atlas.push_subscriptions from public, anon, authenticated;
revoke all on table atlas.notification_preferences from public, anon, authenticated;
revoke all on table atlas.notification_outbox from public, anon, authenticated;
revoke all on table atlas.notification_deliveries from public, anon, authenticated;

grant select on atlas.push_subscriptions, atlas.notification_preferences,
  atlas.notification_outbox, atlas.notification_deliveries to authenticated;
grant all on atlas.web_push_settings, atlas.push_subscriptions, atlas.notification_preferences,
  atlas.notification_outbox, atlas.notification_deliveries to service_role;

revoke all on function atlas.web_push_setup_v1(uuid) from public, anon, authenticated;
revoke all on function atlas.register_push_subscription_v1(uuid,text,timestamptz,text,text,text,text,text,boolean) from public, anon, authenticated;
revoke all on function atlas.revoke_push_subscription_v1(uuid,text) from public, anon, authenticated;
revoke all on function atlas.update_notification_preferences_v1(uuid,boolean,jsonb,time,time,text) from public, anon, authenticated;
revoke all on function atlas.send_push_test_v1(uuid) from public, anon, authenticated;
grant execute on function atlas.web_push_setup_v1(uuid) to authenticated, service_role;
grant execute on function atlas.register_push_subscription_v1(uuid,text,timestamptz,text,text,text,text,text,boolean) to authenticated, service_role;
grant execute on function atlas.revoke_push_subscription_v1(uuid,text) to authenticated, service_role;
grant execute on function atlas.update_notification_preferences_v1(uuid,boolean,jsonb,time,time,text) to authenticated, service_role;
grant execute on function atlas.send_push_test_v1(uuid) to authenticated, service_role;

revoke all on function atlas.web_push_dispatch_config_v1(text) from public, anon, authenticated;
revoke all on function atlas.claim_notification_delivery_batch_v1(integer,integer) from public, anon, authenticated;
revoke all on function atlas.record_notification_delivery_result_v1(uuid,boolean,integer,text,boolean,boolean) from public, anon, authenticated;
grant execute on function atlas.web_push_dispatch_config_v1(text) to service_role;
grant execute on function atlas.claim_notification_delivery_batch_v1(integer,integer) to service_role;
grant execute on function atlas.record_notification_delivery_result_v1(uuid,boolean,integer,text,boolean,boolean) to service_role;

revoke all on function atlas.web_push_default_categories_v1() from public, anon;
revoke all on function atlas.enqueue_journal_event_notifications_v1() from public, anon, authenticated;
revoke all on function atlas.notification_next_available_at_v1(uuid,uuid,timestamptz) from public, anon, authenticated;
revoke all on function atlas.notification_category_for_event_v1(uuid) from public, anon, authenticated;
revoke all on function atlas.notification_can_user_read_event_v1(uuid,uuid) from public, anon, authenticated;
revoke all on function atlas.bell_badge_count_for_user_v1(uuid,uuid) from public, anon, authenticated;
revoke all on function atlas.kick_web_push_dispatch_v1(text) from public, anon, authenticated;
revoke all on function atlas.enqueue_direct_push_v1(uuid,uuid,text,text,text,text,text,text,timestamptz,jsonb) from public, anon, authenticated;
grant execute on function atlas.web_push_default_categories_v1() to authenticated, service_role;
grant execute on function atlas.notification_next_available_at_v1(uuid,uuid,timestamptz) to service_role;
grant execute on function atlas.notification_category_for_event_v1(uuid) to service_role;
grant execute on function atlas.notification_can_user_read_event_v1(uuid,uuid) to service_role;
grant execute on function atlas.bell_badge_count_for_user_v1(uuid,uuid) to service_role;
grant execute on function atlas.kick_web_push_dispatch_v1(text) to service_role;
grant execute on function atlas.enqueue_direct_push_v1(uuid,uuid,text,text,text,text,text,text,timestamptz,jsonb) to service_role;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'atlas-web-push-dispatch-v1') then
    perform cron.schedule(
      'atlas-web-push-dispatch-v1',
      '* * * * *',
      'select atlas.kick_web_push_dispatch_v1(''cron'');'
    );
  end if;
end;
$$;
