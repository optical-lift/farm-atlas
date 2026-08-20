begin;

do $$
declare
  v_card_def text := pg_get_functiondef('atlas.worker_state_transition_card_v2(uuid,uuid,uuid,date)'::regprocedure);
  v_cards_def text := pg_get_functiondef('atlas.worker_day_operational_task_cards_v3(uuid,uuid,date,uuid[])'::regprocedure);
  v_policy_def text := pg_get_functiondef('atlas.worker_task_requires_structured_result_v1(uuid)'::regprocedure);
begin
  if position('quick_complete_v1_available' in v_card_def)=0 then
    raise exception 'Worker transition card does not expose canonical quick completion.';
  end if;
  if position('worker_task_requires_structured_result_v1' in v_card_def)=0 then
    raise exception 'Worker transition card does not delegate structured-result policy.';
  end if;
  if position('quick_complete_allowed' in v_cards_def)=0
     or position('worker_result_authority' in v_cards_def)=0 then
    raise exception 'Worker Day cards do not carry canonical completion authority.';
  end if;
  if position('Chicken Chore' in v_policy_def)>0
     or position('Weed MG11' in v_policy_def)>0
     or position('Mow Corral' in v_policy_def)>0 then
    raise exception 'Result authority must not be task-instance/title hardcoded.';
  end if;
  if position('structured_result_required' in v_policy_def)=0
     or position('quick_complete_allowed' in v_policy_def)=0 then
    raise exception 'Explicit result contract overrides are missing.';
  end if;
end $$;

rollback;
