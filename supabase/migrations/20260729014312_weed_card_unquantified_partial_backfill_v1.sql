alter table atlas.weed_sessions
  add column if not exists minutes_known boolean not null default true;

alter table atlas.weed_sessions drop constraint if exists weed_sessions_minutes_check;
alter table atlas.weed_sessions
  add constraint weed_sessions_minutes_check
  check (
    (minutes_known and minutes between 1 and 480)
    or (not minutes_known and minutes=0)
  );

with source_transition as (
  select
    tr.id transition_id,tr.task_id,tr.note,tr.created_at,
    tr.actor_user_id,tr.actor_membership_id,
    c.id card_id,p.id pass_id,p.current_condition
  from atlas.task_transitions tr
  join atlas.task_objects x on x.task_id=tr.task_id
  join atlas.weed_cards c on c.object_id=x.object_id
  join atlas.weed_passes p on p.weed_card_id=c.id and p.status='active'
  where tr.id='e7380852-9482-4b2f-8d46-2a7483cf88bb'
    and tr.transition='partial'
)
insert into atlas.weed_sessions(
  weed_card_id,weed_pass_id,task_id,work_date,minutes,minutes_known,
  condition_before,condition_after,note,actor_user_id,actor_membership_id,
  idempotency_key,metadata,recorded_at
)
select
  card_id,pass_id,task_id,timezone('America/Chicago',created_at)::date,0,false,
  current_condition,current_condition,note,actor_user_id,actor_membership_id,
  'backfill:task-transition:'||transition_id::text,
  jsonb_build_object(
    'source','legacy_partial_transition',
    'transition_id',transition_id,
    'minutes_unrecorded',true
  ),
  created_at
from source_transition
on conflict(idempotency_key) do nothing;

update atlas.weed_cards c
set last_session_at=s.last_session_at,
    metadata=c.metadata||jsonb_build_object('unquantified_partial_backfilled_at',now()),
    updated_at=now()
from (
  select weed_card_id,max(recorded_at) last_session_at
  from atlas.weed_sessions
  group by weed_card_id
) s
where c.id=s.weed_card_id;

update atlas.weed_passes p
set metadata=p.metadata||jsonb_build_object(
      'unquantified_session_count',(
        select count(*) from atlas.weed_sessions s
        where s.weed_pass_id=p.id and not s.minutes_known
      )
    ),
    updated_at=now()
where exists (
  select 1 from atlas.weed_sessions s
  where s.weed_pass_id=p.id and not s.minutes_known
);


do $$
declare
  v_def text;
  v_old text := '''minutes'', s.minutes,';
  v_new text := '''minutes'', s.minutes,
      ''minutesKnown'', s.minutes_known,';
begin
  select pg_get_functiondef(p.oid)
  into v_def
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='atlas' and p.proname='weed_card_task_focus_v1'
  limit 1;

  if position(v_old in v_def)=0 then
    raise exception 'Expected Weed Card session JSON was not found.';
  end if;
  execute replace(v_def,v_old,v_new);
end $$;
