-- Weed Cards use the universal assigned-task shell with their own method/result
-- instrument. Give the shared execution brief the same literal move/target so the
-- specialty instrument never depends on a title-only fallback while loading.

do $block$
declare
  v_task atlas.tasks%rowtype;
  v_card atlas.weed_cards%rowtype;
begin
  select t.* into v_task
  from atlas.tasks t
  where t.title='Weed MG11'
    and t.status='open'
    and t.due_date=date '2026-08-12'
    and t.visibility_scope='assigned_worker'
    and lower(coalesce(t.metadata->>'weed_card_session_task','false')) in ('true','yes','1')
  order by t.created_at desc
  limit 1;

  if v_task.id is null then
    raise exception 'Current MG11 Weed Card session is missing; refusing worker normalization.';
  end if;

  select wc.* into v_card
  from atlas.weed_cards wc
  where wc.id::text=v_task.metadata->>'weed_card_id';

  if v_card.id is null
     or v_card.card_key<>'weed:mg11'
     or v_card.current_condition<>'heavy'
     or v_card.target_condition<>'clear'
     or coalesce(v_task.metadata->>'display_action','')<>'Weed'
     or coalesce(v_task.metadata->>'display_subject','')<>'MG11'
     or coalesce(v_task.metadata->>'display_location','')<>'MG11' then
    raise exception 'MG11 Weed Card identity/state drifted; refusing worker normalization.';
  end if;

  update atlas.tasks t
  set metadata=coalesce(t.metadata,'{}'::jsonb)||jsonb_build_object(
        'execution_do','Weed MG11.',
        'execution_place','MG11',
        'execution_how',jsonb_build_array(
          'Work MG11 toward the Weed Card target: clear.',
          'If you stop before the bed is clear, record its new condition as Partly finished.'
        ),
        'execution_done_when','MG11 is clear, or today’s partial state has been recorded.',
        'worker_execution_normalized_at',now(),
        'worker_execution_normalized_source','current_weed_card_worker_packet_v1'
      ),
      updated_at=now()
  where t.id=v_task.id;
end;
$block$;
