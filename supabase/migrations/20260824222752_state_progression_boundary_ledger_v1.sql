create table atlas.requirement_boundary_events (
  id uuid primary key default gen_random_uuid(),
  subject_kind text not null check (btrim(subject_kind) <> ''),
  subject_id uuid not null,
  requirement_set_key text not null check (btrim(requirement_set_key) <> ''),
  boundary_key text not null check (btrim(boundary_key) <> ''),
  boundary_kind text not null check (boundary_kind in ('closed','reopened')),
  from_state text not null check (from_state in ('open','satisfied')),
  to_state text not null check (to_state in ('open','satisfied')),
  from_evaluation jsonb not null check (jsonb_typeof(from_evaluation) = 'object'),
  to_evaluation jsonb not null check (jsonb_typeof(to_evaluation) = 'object'),
  evaluated_at timestamptz not null,
  source_kind text not null check (btrim(source_kind) <> ''),
  source_id uuid,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  recorded_at timestamptz not null default now(),
  constraint requirement_boundary_events_state_change_ck check (from_state <> to_state),
  constraint requirement_boundary_events_kind_state_ck check (
    (boundary_kind='closed' and from_state='open' and to_state='satisfied') or
    (boundary_kind='reopened' and from_state='satisfied' and to_state='open')
  ),
  constraint requirement_boundary_events_identity_uq unique (subject_kind, subject_id, requirement_set_key, boundary_key)
);

comment on table atlas.requirement_boundary_events is 'Append-only State Progression boundary ledger. Records evaluated requirement-set closure/reopening only; executes no effects.';

create index requirement_boundary_events_subject_set_idx
  on atlas.requirement_boundary_events(subject_kind, subject_id, requirement_set_key, evaluated_at desc);

alter table atlas.requirement_boundary_events enable row level security;
revoke all on atlas.requirement_boundary_events from public, anon, authenticated;
revoke insert, update, delete on atlas.requirement_boundary_events from service_role;
grant select on atlas.requirement_boundary_events to service_role;

create or replace function atlas.prevent_requirement_boundary_event_mutation_v1()
returns trigger
language plpgsql
set search_path to 'pg_catalog','atlas'
as $function$
begin
  raise exception 'Requirement boundary history is append-only; record a new boundary instead.' using errcode='55000';
end;
$function$;

revoke all on function atlas.prevent_requirement_boundary_event_mutation_v1() from public,anon,authenticated;

create trigger requirement_boundary_events_append_only_v1
before update or delete on atlas.requirement_boundary_events
for each row execute function atlas.prevent_requirement_boundary_event_mutation_v1();

create or replace function atlas.record_requirement_boundary_v1(
  p_subject_kind text,
  p_subject_id uuid,
  p_requirement_set_key text,
  p_boundary_key text,
  p_from_evaluation jsonb,
  p_to_evaluation jsonb,
  p_evaluated_at timestamptz,
  p_source_kind text,
  p_source_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_from_state text;
  v_to_state text;
  v_from_satisfied boolean;
  v_to_satisfied boolean;
  v_boundary_kind text;
  v_id uuid;
  v_existing atlas.requirement_boundary_events%rowtype;
begin
  if nullif(btrim(coalesce(p_subject_kind,'')),'') is null then
    raise exception 'subject_kind is required.' using errcode='22023';
  end if;
  if p_subject_id is null then
    raise exception 'subject_id is required.' using errcode='22023';
  end if;
  if nullif(btrim(coalesce(p_requirement_set_key,'')),'') is null then
    raise exception 'requirement_set_key is required.' using errcode='22023';
  end if;
  if nullif(btrim(coalesce(p_boundary_key,'')),'') is null then
    raise exception 'boundary_key is required.' using errcode='22023';
  end if;
  if p_evaluated_at is null then
    raise exception 'evaluated_at is required.' using errcode='22023';
  end if;
  if nullif(btrim(coalesce(p_source_kind,'')),'') is null then
    raise exception 'source_kind is required.' using errcode='22023';
  end if;
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'metadata must be a JSON object.' using errcode='22023';
  end if;
  if p_from_evaluation is null or jsonb_typeof(p_from_evaluation) <> 'object'
     or p_to_evaluation is null or jsonb_typeof(p_to_evaluation) <> 'object' then
    raise exception 'Boundary recording requires before and after evaluation objects.' using errcode='22023';
  end if;

  v_from_state := p_from_evaluation->>'state';
  v_to_state := p_to_evaluation->>'state';

  if v_from_state not in ('open','satisfied') or v_to_state not in ('open','satisfied') then
    raise exception 'Boundary evaluations must use state open or satisfied.' using errcode='22023';
  end if;
  if jsonb_typeof(p_from_evaluation->'satisfied') <> 'boolean'
     or jsonb_typeof(p_to_evaluation->'satisfied') <> 'boolean' then
    raise exception 'Boundary evaluations require boolean satisfied.' using errcode='22023';
  end if;

  v_from_satisfied := (p_from_evaluation->>'satisfied')::boolean;
  v_to_satisfied := (p_to_evaluation->>'satisfied')::boolean;

  if v_from_satisfied <> (v_from_state='satisfied')
     or v_to_satisfied <> (v_to_state='satisfied') then
    raise exception 'Boundary evaluation state and satisfied flag disagree.' using errcode='22023';
  end if;

  if v_from_state = v_to_state then
    return null;
  end if;

  v_boundary_kind := case
    when v_from_state='open' and v_to_state='satisfied' then 'closed'
    when v_from_state='satisfied' and v_to_state='open' then 'reopened'
    else null
  end;

  if v_boundary_kind is null then
    raise exception 'Unsupported requirement boundary transition % -> %.', v_from_state, v_to_state using errcode='22023';
  end if;

  insert into atlas.requirement_boundary_events(
    subject_kind, subject_id, requirement_set_key, boundary_key, boundary_kind,
    from_state, to_state, from_evaluation, to_evaluation, evaluated_at,
    source_kind, source_id, metadata
  ) values (
    btrim(p_subject_kind), p_subject_id, btrim(p_requirement_set_key), btrim(p_boundary_key), v_boundary_kind,
    v_from_state, v_to_state, p_from_evaluation, p_to_evaluation, p_evaluated_at,
    btrim(p_source_kind), p_source_id, p_metadata
  )
  on conflict (subject_kind, subject_id, requirement_set_key, boundary_key) do nothing
  returning id into v_id;

  if v_id is not null then
    return v_id;
  end if;

  select * into v_existing
  from atlas.requirement_boundary_events
  where subject_kind=btrim(p_subject_kind)
    and subject_id=p_subject_id
    and requirement_set_key=btrim(p_requirement_set_key)
    and boundary_key=btrim(p_boundary_key);

  if v_existing.id is null then
    raise exception 'Boundary idempotency lookup failed.' using errcode='55000';
  end if;

  if v_existing.boundary_kind <> v_boundary_kind
     or v_existing.from_state <> v_from_state
     or v_existing.to_state <> v_to_state
     or v_existing.from_evaluation <> p_from_evaluation
     or v_existing.to_evaluation <> p_to_evaluation
     or v_existing.evaluated_at <> p_evaluated_at
     or v_existing.source_kind <> btrim(p_source_kind)
     or v_existing.source_id is distinct from p_source_id
     or v_existing.metadata <> p_metadata then
    raise exception 'Boundary key already exists with different truth.' using errcode='23505';
  end if;

  return v_existing.id;
end;
$function$;

revoke all on function atlas.record_requirement_boundary_v1(text,uuid,text,text,jsonb,jsonb,timestamptz,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function atlas.record_requirement_boundary_v1(text,uuid,text,text,jsonb,jsonb,timestamptz,text,uuid,jsonb) to service_role;
