-- Build 5 follow-up: keep the Living Day Owner-decisions lane bounded to the
-- decisions that currently govern the four approved Elm pilot goals. Historical
-- Owner tasks remain canonical and readable elsewhere; they do not flood Today.

alter function atlas.living_day_v1(uuid, date)
  rename to living_day_base_v1;

revoke all on function atlas.living_day_base_v1(uuid, date) from public, anon, authenticated;

create or replace function atlas.living_day_v1(
  p_farm_id uuid,
  p_day date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_body jsonb;
  v_owner_decisions jsonb := '[]'::jsonb;
begin
  v_body := atlas.living_day_base_v1(p_farm_id, p_day);

  if atlas.is_farm_owner(p_farm_id) then
    select coalesce(jsonb_agg(jsonb_build_object(
      'entryKey', 'owner-decision:' || task.id::text,
      'entryKind', 'owner_decision',
      'taskId', task.id,
      'title', task.title,
      'detail', coalesce(
        nullif(btrim(task.blocker_text), ''),
        nullif(btrim(task.note), ''),
        'Owner decision or action remains open.'
      ),
      'status', task.status,
      'dueDate', task.due_date,
      'excludedFromDenominator', true
    ) order by
      case task.metadata ->> 'task_key'
        when 'owner_20260726_mark_spray_eb1_6' then 1
        when 'entry_billboard_pollenless_2026_s1_parent' then 2
        else 3
      end,
      task.created_at), '[]'::jsonb)
    into v_owner_decisions
    from atlas.tasks task
    where task.farm_id = p_farm_id
      and task.status in ('open', 'blocked')
      and task.parent_task_id is null
      and task.metadata ->> 'task_key' in (
        'owner_20260726_mark_spray_eb1_6',
        'entry_billboard_pollenless_2026_s1_parent'
      )
      and atlas.can_read_task_in_journal_v1(task.id);
  end if;

  return jsonb_set(v_body, '{ownerDecisions}', v_owner_decisions, true);
end;
$$;

comment on function atlas.living_day_v1(uuid, date) is
  'Living Day v1 with the Owner-decisions lane bounded to decisions governing the approved Elm FR/EB pilot goals.';

revoke all on function atlas.living_day_v1(uuid, date) from public, anon;
grant execute on function atlas.living_day_v1(uuid, date) to authenticated;
