-- P3/P4 follow-through: consequential truth acquisition inherits the source
-- requirement's urgency even when a legacy carrier still contains discretionary metadata.

create or replace function atlas.derive_work_lane_v1(
  p_task_type text,
  p_action_key text,
  p_release_reason text,
  p_gate_type text,
  p_metadata jsonb default '{}'::jsonb
)
returns text
language plpgsql
immutable
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_explicit text := lower(coalesce(p_metadata ->> 'work_lane',''));
  v_task_type text := lower(coalesce(p_task_type,''));
  v_action text := lower(coalesce(p_action_key,''));
  v_reason text := lower(coalesce(p_release_reason,''));
  v_gate text := lower(coalesce(p_gate_type,''));
  v_hard_date boolean :=
    lower(coalesce(p_metadata ->> 'must_happen_that_day','false')) = 'true'
    or lower(coalesce(p_metadata ->> 'hard_date','false')) = 'true'
    or lower(coalesce(p_metadata ->> 'date_commitment','')) = 'hard_date'
    or lower(coalesce(p_metadata ->> 'calendar_commitment_kind','')) = 'owner_hard_date';
  v_inherited_truth_urgency boolean :=
    lower(coalesce(p_metadata->>'inherited_urgency','false'))='true'
    and (
      lower(coalesce(p_metadata->>'task_style','')) like 'truth_acquisition%'
      or nullif(p_metadata->>'state_consequence_instance_id','') is not null
    );
begin
  if v_inherited_truth_urgency then return 'required'; end if;
  if v_explicit in ('required','process_continuation','rhythm') then return v_explicit; end if;
  if v_hard_date then return 'required'; end if;
  if v_explicit = 'discretionary' then return v_explicit; end if;
  if v_reason like '%dependency%' or v_reason like '%continuation%'
     or v_gate in ('predecessor','event','state','composite')
     or lower(coalesce(p_metadata ->> 'created_from','')) = 'triggered_task_sequence'
     or v_task_type in ('germination_check','transplant_readiness','hardening_off') then return 'process_continuation'; end if;
  if lower(coalesce(p_metadata ->> 'persistent_weed_card','false')) = 'true'
     or lower(coalesce(p_metadata ->> 'canonical_maintenance_delivery','false')) = 'true'
     or v_action in ('weed','mow','water','feed','animal_care','grow_room_check')
     or v_task_type in ('chore','kid_chore','children_chore','animal_care','mowing','grounds_mowing','grow_room_check') then return 'rhythm'; end if;
  if v_action in ('deliver','delivery','safety')
     or v_task_type in ('delivery','event_setup','event_breakdown','safety') then return 'required'; end if;
  return 'discretionary';
end;
$function$;

create or replace function atlas.derive_commitment_kind_v1(
  p_work_lane text,
  p_gate_type text,
  p_metadata jsonb default '{}'::jsonb
)
returns text
language plpgsql
immutable
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_explicit text := lower(coalesce(p_metadata ->> 'date_commitment', p_metadata ->> 'commitment_kind',''));
  v_lane text := lower(coalesce(p_work_lane,''));
  v_gate text := lower(coalesce(p_gate_type,''));
  v_inherited_truth_urgency boolean :=
    lower(coalesce(p_metadata->>'inherited_urgency','false'))='true'
    and (
      lower(coalesce(p_metadata->>'task_style','')) like 'truth_acquisition%'
      or nullif(p_metadata->>'state_consequence_instance_id','') is not null
    );
begin
  -- The source requirement persists until the missing truth is supplied. When the
  -- exact biological onset is bounded/unknown, do not fabricate a hard-date contract.
  if v_inherited_truth_urgency then return 'persistent'; end if;
  if v_explicit in ('hard_date','floating','dependency','persistent') then return v_explicit; end if;
  if v_lane = 'process_continuation' or v_gate in ('predecessor','event','state','composite') then return 'dependency'; end if;
  if v_lane = 'rhythm' then return 'persistent'; end if;
  if v_lane = 'required' then return 'hard_date'; end if;
  return 'floating';
end;
$function$;

-- Re-run reservoir derivation for currently open truth-acquisition carriers.
update atlas.tasks t
set metadata=coalesce(t.metadata,'{}'::jsonb)||jsonb_build_object(
      'work_lane','required',
      'commitment_kind','persistent',
      'date_commitment','persistent'
    ),
    updated_at=now()
where t.status in ('open','blocked')
  and lower(coalesce(t.metadata->>'inherited_urgency','false'))='true'
  and (
    lower(coalesce(t.metadata->>'task_style','')) like 'truth_acquisition%'
    or nullif(t.metadata->>'state_consequence_instance_id','') is not null
  );

comment on function atlas.derive_work_lane_v1(text,text,text,text,jsonb) is
'Canonical reservoir lane derivation. Consequential truth-acquisition work linked to an active source requirement is required and cannot be demoted by stale discretionary carrier metadata.';
comment on function atlas.derive_commitment_kind_v1(text,text,jsonb) is
'Canonical commitment derivation. Requirement-linked truth acquisition is persistent until the missing truth is supplied; bounded biological timing is not fabricated into an exact hard date.';