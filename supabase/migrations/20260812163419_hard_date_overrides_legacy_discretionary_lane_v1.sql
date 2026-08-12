begin;

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
set search_path = pg_catalog, atlas
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
begin
  -- Rhythm and dependency lanes describe the kind of work and may also carry a
  -- hard calendar commitment. Required is already the hard-window lane.
  if v_explicit in ('required','process_continuation','rhythm') then return v_explicit; end if;

  -- A legacy explicit discretionary marker must never demote an explicitly
  -- hard-dated task. This is the acceptance correction for old Owner-authored
  -- tasks whose calendar commitment survived while their reservoir lane did not.
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

-- Re-run the decorator for the small legacy Owner-hard-date set. Updating
-- metadata invokes the existing reservoir trigger, which now preserves the
-- hard-date commitment as the required lane instead of re-demoting it.
update atlas.tasks task
set metadata = coalesce(task.metadata, '{}'::jsonb) || jsonb_build_object(
      'legacy_owner_hard_date_lane_reconciled', true
    ),
    updated_at = now()
where task.due_date is not null
  and task.metadata ->> 'calendar_commitment_kind' = 'owner_hard_date';

update atlas.planned_work_occurrences occurrence
set work_lane = 'required',
    commitment_kind = 'hard_date',
    task_payload = coalesce(occurrence.task_payload, '{}'::jsonb) || jsonb_build_object(
      'work_lane', 'required',
      'commitment_kind', 'hard_date',
      'metadata', coalesce(occurrence.task_payload -> 'metadata', '{}'::jsonb) || jsonb_build_object(
        'work_lane', 'required',
        'date_commitment', 'hard_date',
        'commitment_kind', 'hard_date',
        'legacy_owner_hard_date_lane_reconciled', true
      )
    ),
    metadata = coalesce(occurrence.metadata, '{}'::jsonb) || jsonb_build_object(
      'legacyOwnerHardDateLaneReconciled', true
    ),
    updated_at = now()
where occurrence.id in (
  select task.planned_occurrence_id
  from atlas.tasks task
  where task.planned_occurrence_id is not null
    and task.metadata ->> 'calendar_commitment_kind' = 'owner_hard_date'
);

commit;
