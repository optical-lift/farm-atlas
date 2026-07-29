create table if not exists atlas.weed_cards (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  object_id uuid not null references atlas.growing_objects(id) on delete cascade,
  maintenance_object_id uuid references atlas.maintenance_objects(id) on delete set null,
  card_key text not null unique,
  current_condition text not null default 'medium_pressure' check (current_condition in ('heavy','medium_pressure','row_readable','mostly_clear','clear')),
  target_condition text not null default 'clear' check (target_condition in ('row_readable','mostly_clear','clear')),
  next_review_on date,
  last_session_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (object_id)
);

create table if not exists atlas.weed_passes (
  id uuid primary key default gen_random_uuid(),
  weed_card_id uuid not null references atlas.weed_cards(id) on delete cascade,
  status text not null default 'active' check (status in ('active','closed')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  starting_condition text not null check (starting_condition in ('heavy','medium_pressure','row_readable','mostly_clear','clear')),
  current_condition text not null check (current_condition in ('heavy','medium_pressure','row_readable','mostly_clear','clear')),
  target_condition text not null default 'clear' check (target_condition in ('row_readable','mostly_clear','clear')),
  total_minutes integer not null default 0 check (total_minutes >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists weed_passes_one_active_per_card_uidx
  on atlas.weed_passes (weed_card_id)
  where status = 'active';

create table if not exists atlas.weed_sessions (
  id uuid primary key default gen_random_uuid(),
  weed_card_id uuid not null references atlas.weed_cards(id) on delete cascade,
  weed_pass_id uuid not null references atlas.weed_passes(id) on delete cascade,
  task_id uuid references atlas.tasks(id) on delete set null,
  next_task_id uuid references atlas.tasks(id) on delete set null,
  work_date date not null,
  minutes integer not null check (minutes between 1 and 480),
  condition_before text not null check (condition_before in ('heavy','medium_pressure','row_readable','mostly_clear','clear')),
  condition_after text not null check (condition_after in ('heavy','medium_pressure','row_readable','mostly_clear','clear')),
  note text,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_membership_id uuid references atlas.farm_memberships(id) on delete set null,
  idempotency_key text not null unique,
  metadata jsonb not null default '{}'::jsonb,
  recorded_at timestamptz not null default now()
);

create index if not exists weed_sessions_pass_date_idx
  on atlas.weed_sessions (weed_pass_id, work_date desc, recorded_at desc);

create index if not exists tasks_weed_card_schedule_idx
  on atlas.tasks ((metadata ->> 'weed_card_id'), due_date, status)
  where metadata ? 'weed_card_id';

alter table atlas.weed_cards enable row level security;
alter table atlas.weed_passes enable row level security;
alter table atlas.weed_sessions enable row level security;
revoke all on atlas.weed_cards, atlas.weed_passes, atlas.weed_sessions from anon, authenticated;

create or replace function atlas.weed_condition_rank_v1(p_condition text)
returns integer
language sql
immutable
strict
set search_path = pg_catalog, atlas
as $$
  select case p_condition
    when 'heavy' then 0
    when 'medium_pressure' then 1
    when 'row_readable' then 2
    when 'mostly_clear' then 3
    when 'clear' then 4
    else -1
  end;
$$;

create or replace function atlas.weed_card_task_focus_v1(p_task_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_task atlas.tasks%rowtype;
  v_card atlas.weed_cards%rowtype;
  v_pass atlas.weed_passes%rowtype;
  v_object atlas.growing_objects%rowtype;
  v_zone_label text;
  v_role text;
  v_membership_id uuid;
  v_sessions jsonb;
begin
  select t.* into v_task from atlas.tasks t where t.id = p_task_id;
  if v_task.id is null then
    raise exception 'Task not found.' using errcode = 'P0002';
  end if;

  v_role := atlas.current_farm_role(v_task.farm_id);
  v_membership_id := atlas.current_membership_id(v_task.farm_id);
  if not atlas.is_farm_owner(v_task.farm_id)
     and not (v_role in ('farm_hand','manager') and v_membership_id is not null and v_task.assigned_membership_id = v_membership_id)
  then
    raise exception 'This Weed Card is not available to the signed-in farm member.' using errcode = '42501';
  end if;

  select c.* into v_card
  from atlas.weed_cards c
  join atlas.task_objects x on x.object_id = c.object_id
  where x.task_id = p_task_id
  limit 1;
  if v_card.id is null then return null; end if;

  select p.* into v_pass
  from atlas.weed_passes p
  where p.weed_card_id = v_card.id and p.status = 'active'
  limit 1;

  select go.* into v_object from atlas.growing_objects go where go.id = v_card.object_id;
  select z.label into v_zone_label from atlas.zones z where z.id = v_object.zone_id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id,
      'workDate', s.work_date,
      'minutes', s.minutes,
      'conditionBefore', s.condition_before,
      'conditionAfter', s.condition_after,
      'note', s.note,
      'recordedAt', s.recorded_at
    ) order by s.recorded_at desc), '[]'::jsonb)
  into v_sessions
  from (
    select ws.* from atlas.weed_sessions ws
    where ws.weed_card_id = v_card.id
    order by ws.recorded_at desc
    limit 12
  ) s;

  return jsonb_build_object(
    'taskId', v_task.id,
    'taskStatus', v_task.status,
    'taskDueDate', v_task.due_date,
    'cardId', v_card.id,
    'passId', v_pass.id,
    'passStatus', coalesce(v_pass.status, 'closed'),
    'objectId', v_object.id,
    'objectKey', v_object.stable_key,
    'objectLabel', v_object.label,
    'zoneLabel', coalesce(v_zone_label, 'Elm Farm'),
    'cropLabel', coalesce(nullif(v_task.metadata ->> 'main_crop_label',''), nullif(v_task.metadata ->> 'crop_label',''), 'Bed'),
    'condition', coalesce(v_pass.current_condition, v_card.current_condition),
    'targetCondition', coalesce(v_pass.target_condition, v_card.target_condition),
    'totalMinutes', coalesce(v_pass.total_minutes, 0),
    'sessionCount', jsonb_array_length(v_sessions),
    'nextReviewOn', v_card.next_review_on,
    'sessions', v_sessions
  );
end;
$$;

create or replace function atlas.record_weed_card_session_v1(
  p_task_id uuid,
  p_minutes integer,
  p_condition_after text,
  p_work_date date,
  p_note text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_task atlas.tasks%rowtype;
  v_card atlas.weed_cards%rowtype;
  v_pass atlas.weed_passes%rowtype;
  v_object atlas.growing_objects%rowtype;
  v_role text;
  v_membership_id uuid;
  v_local_date date := timezone('America/Chicago', now())::date;
  v_session_id uuid;
  v_existing atlas.weed_sessions%rowtype;
  v_next_task_id uuid;
  v_next_date date;
  v_transition jsonb;
  v_metadata jsonb;
  v_condition_label text;
  v_pressure text;
  v_return_days integer;
begin
  if p_task_id is null or p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'Task and idempotency key are required.' using errcode = '22023';
  end if;
  if p_minutes is null or p_minutes < 1 or p_minutes > 480 then
    raise exception 'Minutes must be between 1 and 480.' using errcode = '22023';
  end if;
  if atlas.weed_condition_rank_v1(p_condition_after) < 0 then
    raise exception 'Unsupported weed condition.' using errcode = '22023';
  end if;
  if p_work_date is null or p_work_date < v_local_date - 1 or p_work_date > v_local_date + 1 then
    raise exception 'Work date is outside the accepted logging window.' using errcode = '22023';
  end if;

  select * into v_existing from atlas.weed_sessions where idempotency_key = p_idempotency_key;
  if v_existing.id is not null then
    return jsonb_build_object(
      'sessionId', v_existing.id,
      'taskId', v_existing.task_id,
      'nextTaskId', v_existing.next_task_id,
      'conditionAfter', v_existing.condition_after,
      'minutes', v_existing.minutes,
      'deduplicated', true
    );
  end if;

  select t.* into v_task from atlas.tasks t where t.id = p_task_id for update;
  if v_task.id is null then raise exception 'Task not found.' using errcode = 'P0002'; end if;
  if v_task.status <> 'open' then raise exception 'This daily Weed Card task is no longer open.' using errcode = '22023'; end if;

  v_role := atlas.current_farm_role(v_task.farm_id);
  v_membership_id := atlas.current_membership_id(v_task.farm_id);
  if not atlas.is_farm_owner(v_task.farm_id)
     and not (v_role in ('farm_hand','manager') and v_membership_id is not null and v_task.assigned_membership_id = v_membership_id)
  then
    raise exception 'This Weed Card is not assigned to the signed-in farm member.' using errcode = '42501';
  end if;

  select c.* into v_card
  from atlas.weed_cards c
  join atlas.task_objects x on x.object_id = c.object_id
  where x.task_id = p_task_id
  limit 1
  for update of c;
  if v_card.id is null then raise exception 'No Weed Card is linked to this task.' using errcode = 'P0002'; end if;

  select p.* into v_pass
  from atlas.weed_passes p
  where p.weed_card_id = v_card.id and p.status = 'active'
  for update;
  if v_pass.id is null then raise exception 'This Weed Card has no active clearing pass.' using errcode = '22023'; end if;

  if atlas.weed_condition_rank_v1(p_condition_after) < atlas.weed_condition_rank_v1(v_pass.current_condition) then
    raise exception 'A work session cannot move the bed backward. Open a new observation instead.' using errcode = '22023';
  end if;

  select go.* into v_object from atlas.growing_objects go where go.id = v_card.object_id;

  insert into atlas.weed_sessions (
    weed_card_id, weed_pass_id, task_id, work_date, minutes,
    condition_before, condition_after, note, actor_user_id,
    actor_membership_id, idempotency_key, metadata
  ) values (
    v_card.id, v_pass.id, v_task.id, p_work_date, p_minutes,
    v_pass.current_condition, p_condition_after, nullif(btrim(coalesce(p_note,'')),''),
    auth.uid(), v_membership_id, p_idempotency_key,
    jsonb_build_object('source','weed_card_task_focus_v1')
  ) returning id into v_session_id;

  update atlas.weed_passes
  set current_condition = p_condition_after,
      total_minutes = total_minutes + p_minutes,
      status = case when p_condition_after = 'clear' then 'closed' else status end,
      closed_at = case when p_condition_after = 'clear' then now() else closed_at end,
      metadata = metadata || jsonb_build_object('last_session_id',v_session_id,'last_work_date',p_work_date),
      updated_at = now()
  where id = v_pass.id;

  select coalesce(mo.normal_return_interval_days, 21)
  into v_return_days
  from atlas.maintenance_objects mo
  where mo.id = v_card.maintenance_object_id;
  v_return_days := coalesce(v_return_days, 21);

  update atlas.weed_cards
  set current_condition = p_condition_after,
      last_session_at = now(),
      next_review_on = case when p_condition_after = 'clear' then p_work_date + v_return_days else null end,
      metadata = metadata || jsonb_build_object('last_session_id',v_session_id,'last_work_date',p_work_date),
      updated_at = now()
  where id = v_card.id;

  v_pressure := case p_condition_after
    when 'heavy' then 'high'
    when 'medium_pressure' then 'medium'
    when 'row_readable' then 'low'
    when 'mostly_clear' then 'low'
    when 'clear' then 'maintained'
  end;

  update atlas.object_state
  set last_touched_at = greatest(coalesce(last_touched_at,p_work_date),p_work_date),
      last_weeded_at = case when p_condition_after = 'clear' then greatest(coalesce(last_weeded_at,p_work_date),p_work_date) else last_weeded_at end,
      weed_pressure = v_pressure,
      metadata = metadata || jsonb_build_object(
        'weed_card_id',v_card.id,
        'weed_card_condition',p_condition_after,
        'weed_card_total_minutes',(select total_minutes from atlas.weed_passes where id=v_pass.id),
        'weed_card_last_session_id',v_session_id,
        'weed_card_last_work_date',p_work_date
      ),
      updated_at = now()
  where object_id = v_card.object_id;

  update atlas.maintenance_objects
  set condition = case p_condition_after
        when 'heavy' then 'heavy'
        when 'medium_pressure' then 'moderate'
        when 'row_readable' then 'light'
        when 'mostly_clear' then 'light'
        when 'clear' then 'clear'
      end,
      last_completed_at = case when p_condition_after = 'clear' then now() else last_completed_at end,
      next_eligible_date = case when p_condition_after = 'clear' then p_work_date + normal_return_interval_days else next_eligible_date end,
      active = false,
      metadata = metadata || jsonb_build_object(
        'weed_card_managed',true,
        'weed_card_id',v_card.id,
        'weed_card_condition',p_condition_after,
        'weed_card_last_session_id',v_session_id,
        'weed_card_total_minutes',(select total_minutes from atlas.weed_passes where id=v_pass.id)
      ),
      updated_at = now()
  where id = v_card.maintenance_object_id;

  v_condition_label := case p_condition_after
    when 'heavy' then 'Heavy pressure'
    when 'medium_pressure' then 'Medium pressure'
    when 'row_readable' then 'Row readable'
    when 'mostly_clear' then 'Mostly clear'
    when 'clear' then 'Clear'
  end;

  if atlas.is_farm_owner(v_task.farm_id) then
    v_transition := atlas.owner_record_task_transition_v1(
      v_task.id, 'done', p_idempotency_key || ':task', p_work_date,
      concat(p_minutes,' minutes · ',v_condition_label), 'Weed Card session logged',
      'weed', 'weed_session',
      jsonb_build_object(
        'weed_card_id',v_card.id,'weed_pass_id',v_pass.id,'weed_session_id',v_session_id,
        'minutes',p_minutes,'condition_before',v_pass.current_condition,'condition_after',p_condition_after,
        'target_reached',p_condition_after='clear','actor_user_id',auth.uid(),'actor_membership_id',v_membership_id
      ), null
    );
  else
    v_transition := atlas.worker_record_task_transition_v1(
      v_task.id, 'done', p_idempotency_key || ':task',
      concat(p_minutes,' minutes · ',v_condition_label), 'Weed Card session logged',
      jsonb_build_object(
        'weed_card_id',v_card.id,'weed_pass_id',v_pass.id,'weed_session_id',v_session_id,
        'minutes',p_minutes,'condition_before',v_pass.current_condition,'condition_after',p_condition_after,
        'target_reached',p_condition_after='clear'
      ), p_work_date, 'weed', 'weed_session', null
    );
  end if;

  if p_condition_after <> 'clear' then
    v_next_date := p_work_date + 1;
    select t.id into v_next_task_id
    from atlas.tasks t
    where t.farm_id = v_task.farm_id
      and t.status in ('open','blocked')
      and t.due_date = v_next_date
      and t.metadata ->> 'weed_card_id' = v_card.id::text
    limit 1;

    if v_next_task_id is null then
      v_metadata := jsonb_build_object(
        'anna_task', coalesce(v_task.metadata -> 'anna_task','true'::jsonb),
        'owner_task', false,
        'assigned_to', coalesce(nullif(v_task.metadata ->> 'assigned_to',''),'Anna'),
        'assignee_key', coalesce(nullif(v_task.metadata ->> 'assignee_key',''),'anna'),
        'work_route','weed',
        'work_rhythm','Weeding',
        'display_action','Weed',
        'display_title',v_task.title,
        'display_subject',v_object.label,
        'display_detail',concat('Continue clearing · ',coalesce(nullif(v_task.metadata ->> 'main_crop_label',''),'bed')),
        'main_crop_label',coalesce(nullif(v_task.metadata ->> 'main_crop_label',''),'Bed'),
        'collection_zone',coalesce(nullif(v_task.metadata ->> 'collection_zone',''),'Field Rows'),
        'collection_label',v_object.label,
        'maintenance_type','weed',
        'target_object_id',v_object.id,
        'weed_card_id',v_card.id,
        'weed_pass_id',v_pass.id,
        'weed_card_session_task',true,
        'task_key',concat('weed_card_',replace(v_card.id::text,'-',''),'_',v_next_date::text),
        'day_order',coalesce(v_task.metadata -> 'day_order','500'::jsonb),
        'work_order',coalesce(v_task.metadata -> 'work_order','2'::jsonb),
        'day_work_order',coalesce(v_task.metadata -> 'day_work_order','2'::jsonb),
        'run_sheet_order',coalesce(v_task.metadata -> 'run_sheet_order','2'::jsonb),
        'released_at',now(),
        'released_by','weed_card_session_v1',
        'release_reason','weed_card_continuation'
      );

      insert into atlas.tasks (
        farm_id, zone_id, title, task_type, status, priority, due_date,
        generated_from, generated_from_id, note, metadata, action_key, work_class,
        task_series_key, engine_instance_key, visibility_scope, assigned_membership_id,
        released_at, release_reason, organization_id, task_scope, assigned_user_id,
        created_by_user_id, origin_kind
      ) values (
        v_task.farm_id, v_task.zone_id, v_task.title, 'maintenance', 'open', v_task.priority, v_next_date,
        'weed_card', v_card.id, null, v_metadata, 'weed', coalesce(v_task.work_class,'standard'),
        'weed_card:' || v_card.id::text, 'weed_card:' || v_card.id::text || ':' || v_next_date::text,
        v_task.visibility_scope, v_task.assigned_membership_id,
        now(), 'weed_card_continuation', v_task.organization_id, v_task.task_scope,
        v_task.assigned_user_id, auth.uid(), 'generated'
      ) returning id into v_next_task_id;

      insert into atlas.task_objects (task_id, object_id, role)
      values (v_next_task_id, v_card.object_id, 'target')
      on conflict do nothing;
    end if;
  end if;

  update atlas.weed_sessions set next_task_id = v_next_task_id where id = v_session_id;

  return jsonb_build_object(
    'sessionId',v_session_id,
    'taskId',v_task.id,
    'nextTaskId',v_next_task_id,
    'cardId',v_card.id,
    'passId',v_pass.id,
    'minutes',p_minutes,
    'conditionAfter',p_condition_after,
    'passClosed',p_condition_after='clear',
    'nextReviewOn',case when p_condition_after='clear' then p_work_date + v_return_days else null end,
    'transition',v_transition,
    'deduplicated',false
  );
end;
$$;

revoke all on function atlas.weed_card_task_focus_v1(uuid) from public;
revoke all on function atlas.record_weed_card_session_v1(uuid,integer,text,date,text,text) from public;
grant execute on function atlas.weed_card_task_focus_v1(uuid) to authenticated, service_role;
grant execute on function atlas.record_weed_card_session_v1(uuid,integer,text,date,text,text) to authenticated, service_role;

with pilot as (
  select
    go.id as object_id,
    go.farm_id,
    go.stable_key,
    mo.id as maintenance_object_id,
    case lower(coalesce(mo.condition, os.weed_pressure, 'moderate'))
      when 'heavy' then 'heavy'
      when 'high' then 'heavy'
      when 'medium' then 'medium_pressure'
      when 'moderate' then 'medium_pressure'
      when 'low' then 'row_readable'
      when 'light' then 'row_readable'
      when 'maintained' then 'clear'
      when 'clear' then 'clear'
      else 'medium_pressure'
    end as starting_condition
  from atlas.growing_objects go
  join atlas.maintenance_objects mo on mo.object_id = go.id and mo.maintenance_type = 'weed'
  left join atlas.object_state os on os.object_id = go.id
  where go.stable_key in ('fr_4','fr_5','fr_6')
)
insert into atlas.weed_cards (farm_id,object_id,maintenance_object_id,card_key,current_condition,target_condition,metadata)
select farm_id,object_id,maintenance_object_id,'weed:' || stable_key,starting_condition,'clear',jsonb_build_object('pilot','fr4_fr6_incremental_v1')
from pilot
on conflict (object_id) do update set
  maintenance_object_id = excluded.maintenance_object_id,
  metadata = atlas.weed_cards.metadata || excluded.metadata,
  updated_at = now();

insert into atlas.weed_passes (weed_card_id,status,opened_at,starting_condition,current_condition,target_condition,metadata)
select c.id,'active',coalesce((mo.metadata ->> 'partial_recorded_at')::timestamptz,now()),c.current_condition,c.current_condition,c.target_condition,jsonb_build_object('pilot','fr4_fr6_incremental_v1')
from atlas.weed_cards c
join atlas.growing_objects go on go.id=c.object_id and go.stable_key in ('fr_4','fr_5','fr_6')
left join atlas.maintenance_objects mo on mo.id=c.maintenance_object_id
where not exists (select 1 from atlas.weed_passes p where p.weed_card_id=c.id and p.status='active');

with seed_rows as (
  select c.id card_id,p.id pass_id,
    nullif(mo.metadata ->> 'last_source_task_id','')::uuid task_id,
    greatest(1, least(480, (mo.metadata ->> 'last_actual_minutes')::integer)) minutes,
    timezone('America/Chicago',(mo.metadata ->> 'partial_recorded_at')::timestamptz)::date work_date,
    c.current_condition condition,
    coalesce(nullif(mo.metadata ->> 'last_completion_note',''),'Partly done') note,
    t.assigned_membership_id,
    'seed:maintenance_partial:' || c.id::text || ':' || (mo.metadata ->> 'partial_recorded_at') as idem
  from atlas.weed_cards c
  join atlas.growing_objects go on go.id=c.object_id and go.stable_key in ('fr_4','fr_5','fr_6')
  join atlas.weed_passes p on p.weed_card_id=c.id and p.status='active'
  join atlas.maintenance_objects mo on mo.id=c.maintenance_object_id
  left join atlas.tasks t on t.id=nullif(mo.metadata ->> 'last_source_task_id','')::uuid
  where mo.metadata ? 'last_actual_minutes' and mo.metadata ? 'partial_recorded_at'
)
insert into atlas.weed_sessions (weed_card_id,weed_pass_id,task_id,work_date,minutes,condition_before,condition_after,note,actor_membership_id,idempotency_key,metadata)
select card_id,pass_id,task_id,work_date,minutes,condition,condition,note,assigned_membership_id,idem,jsonb_build_object('source','documented_maintenance_partial_backfill')
from seed_rows
on conflict (idempotency_key) do nothing;

update atlas.weed_passes p
set total_minutes = s.total_minutes,
    metadata = p.metadata || jsonb_build_object('backfilled_session_count',s.session_count),
    updated_at=now()
from (
  select weed_pass_id,sum(minutes)::integer total_minutes,count(*)::integer session_count
  from atlas.weed_sessions group by weed_pass_id
) s
where p.id=s.weed_pass_id;

update atlas.weed_cards c
set last_session_at=s.last_session_at, updated_at=now()
from (
  select weed_card_id,max(recorded_at) last_session_at from atlas.weed_sessions group by weed_card_id
) s
where c.id=s.weed_card_id;

with linked as (
  select distinct on (c.id) t.id task_id,c.id card_id,p.id pass_id
  from atlas.weed_cards c
  join atlas.growing_objects go on go.id=c.object_id and go.stable_key in ('fr_4','fr_5','fr_6')
  join atlas.task_objects x on x.object_id=c.object_id
  join atlas.tasks t on t.id=x.task_id and t.status in ('open','blocked') and coalesce(t.action_key,'') in ('weed','weeding')
  join atlas.weed_passes p on p.weed_card_id=c.id and p.status='active'
  order by c.id,t.due_date,t.created_at desc
)
update atlas.tasks t
set metadata = t.metadata || jsonb_build_object(
      'weed_card_id',l.card_id,
      'weed_pass_id',l.pass_id,
      'weed_card_session_task',true,
      'release_gate_installed',true
    ),
    updated_at=now()
from linked l
where t.id=l.task_id;

update atlas.maintenance_objects mo
set active=false,
    metadata=mo.metadata || jsonb_build_object('weed_card_managed',true,'weed_card_pilot','fr4_fr6_incremental_v1'),
    updated_at=now()
from atlas.weed_cards c
join atlas.growing_objects go on go.id=c.object_id and go.stable_key in ('fr_4','fr_5','fr_6')
where mo.id=c.maintenance_object_id;
