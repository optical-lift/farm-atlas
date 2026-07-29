create or replace function atlas.finish_partial_weed_card_day_v1(
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
  v_pass jsonb;
  v_day jsonb;
begin
  if p_task_id is null or nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'Task and idempotency key are required.' using errcode = '22023';
  end if;

  if p_condition_after = 'clear' then
    raise exception 'Use the Clear action when the bed is clear.' using errcode = '22023';
  end if;

  v_pass := atlas.record_weed_card_pass_v1(
    p_task_id,
    p_minutes,
    p_condition_after,
    p_work_date,
    p_note,
    p_idempotency_key || ':pass'
  );

  v_day := atlas.finish_weed_card_day_v1(
    p_task_id,
    p_work_date,
    p_idempotency_key || ':day'
  );

  return v_pass
    || v_day
    || jsonb_build_object(
      'sessionId', v_pass ->> 'sessionId',
      'taskId', p_task_id,
      'cardId', v_pass ->> 'cardId',
      'passId', v_pass ->> 'passId',
      'minutes', coalesce((v_pass ->> 'minutes')::integer, 0),
      'minutesKnown', coalesce((v_pass ->> 'minutesKnown')::boolean, false),
      'conditionAfter', p_condition_after,
      'passClosed', false,
      'taskClosed', true,
      'nextTaskId', v_day ->> 'nextTaskId',
      'deduplicated', coalesce((v_pass ->> 'deduplicated')::boolean, false)
        and coalesce((v_day ->> 'deduplicated')::boolean, false)
    );
end;
$$;

revoke all on function atlas.finish_partial_weed_card_day_v1(uuid, integer, text, date, text, text) from public;
grant execute on function atlas.finish_partial_weed_card_day_v1(uuid, integer, text, date, text, text) to authenticated, service_role;