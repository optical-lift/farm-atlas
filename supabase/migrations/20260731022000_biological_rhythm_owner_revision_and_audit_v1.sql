create or replace function atlas.sync_operator_biological_handoff_transition_v1()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,atlas
as $$
begin
  if coalesce((new.metadata->>'operatorMode')::boolean,false) then
    perform atlas.record_task_transition_v1(
      new.task_id,
      'blocked',
      'operator-biological-handoff:'||new.open_idempotency_key,
      null,
      null,
      new.issue_text,
      coalesce((select action_key from atlas.tasks where id=new.task_id),'germination_check'),
      'owner_handoff',
      jsonb_build_object(
        'source','owner_operator_biological_handoff',
        'handoff_id',new.id,
        'opened_by_membership_id',new.opened_by_membership_id,
        'actor_user_id',new.opened_by_user_id,
        'effective_membership_id',new.opened_by_membership_id
      ),
      null
    );
  end if;
  return new;
end;
$$;

drop trigger if exists task_problem_handoffs_operator_biological_transition_v1 on atlas.task_problem_handoffs;
create trigger task_problem_handoffs_operator_biological_transition_v1
after insert on atlas.task_problem_handoffs
for each row execute function atlas.sync_operator_biological_handoff_transition_v1();

create or replace function atlas.owner_revise_biological_rhythm_rule_v1(
  p_state_id uuid,
  p_validity_seconds integer,
  p_warning_seconds integer,
  p_grace_seconds integer,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,atlas
as $$
declare
  v_state atlas.rhythm_state%rowtype;
  v_rule atlas.rhythm_rules%rowtype;
  v_created jsonb;
  v_new_rule_id uuid;
  v_affected_state record;
  v_binding_count integer:=0;
  v_state_count integer:=0;
begin
  select * into v_state from atlas.rhythm_state where id=p_state_id;
  if v_state.id is null then raise exception 'Biological rhythm state not found.' using errcode='P0002'; end if;
  if auth.uid() is null or not atlas.is_farm_owner(v_state.farm_id) then
    raise exception 'Only a farm Owner may revise biological rhythm rules.' using errcode='42501';
  end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'Owner reason is required.' using errcode='22023'; end if;
  if p_validity_seconds is null or p_validity_seconds<3600
     or coalesce(p_warning_seconds,0)<0
     or coalesce(p_grace_seconds,0)<0
     or coalesce(p_warning_seconds,0)>p_validity_seconds then
    raise exception 'Cadence values are invalid.' using errcode='22023';
  end if;

  select * into v_rule from atlas.rhythm_rules where id=v_state.rhythm_rule_id;
  if v_rule.id is null or v_rule.rhythm_key not in ('grow_room_care','germination_watch') then
    raise exception 'This state is not governed by a biological rhythm rule.' using errcode='22023';
  end if;

  v_created:=atlas.create_rhythm_rule_version_v1(
    p_farm_id=>v_rule.farm_id,
    p_rule_key=>v_rule.rule_key,
    p_rhythm_key=>v_rule.rhythm_key,
    p_label=>v_rule.label,
    p_validity_interval_seconds=>p_validity_seconds,
    p_warning_window_seconds=>coalesce(p_warning_seconds,0),
    p_grace_window_seconds=>coalesce(p_grace_seconds,0),
    p_applicability=>v_rule.applicability,
    p_qualifying_touches=>v_rule.qualifying_touches,
    p_failure_consequence=>v_rule.failure_consequence,
    p_player_routing=>v_rule.player_routing,
    p_owner_reason=>p_reason,
    p_metadata=>v_rule.metadata||jsonb_build_object('revisedFromRuleId',v_rule.id,'biologicalClock',true),
    p_activate=>true
  );
  v_new_rule_id:=(v_created->>'ruleId')::uuid;

  update atlas.rhythm_bindings
  set rhythm_rule_id=v_new_rule_id,
      owner_reason=p_reason,
      metadata=metadata||jsonb_build_object('revisedAt',now(),'previousRuleId',v_rule.id),
      updated_at=now()
  where farm_id=v_rule.farm_id and rhythm_rule_id=v_rule.id;
  get diagnostics v_binding_count=row_count;

  for v_affected_state in
    select rs.id
    from atlas.rhythm_state rs
    join atlas.rhythm_bindings rb on rb.id=rs.rhythm_binding_id
    where rb.rhythm_rule_id=v_new_rule_id
  loop
    perform atlas.evaluate_rhythm_binding_v1(v_affected_state.id,now(),'owner_rule_revision');
    v_state_count:=v_state_count+1;
  end loop;

  return jsonb_build_object(
    'contractVersion','owner_revise_biological_rhythm_rule_v1',
    'stateId',v_state.id,
    'previousRuleId',v_rule.id,
    'ruleId',v_new_rule_id,
    'version',v_created->'version',
    'bindingsRebound',v_binding_count,
    'statesReevaluated',v_state_count,
    'validitySeconds',p_validity_seconds,
    'warningSeconds',coalesce(p_warning_seconds,0),
    'graceSeconds',coalesce(p_grace_seconds,0)
  );
end;
$$;

grant execute on function atlas.owner_revise_biological_rhythm_rule_v1(uuid,integer,integer,integer,text) to authenticated;
revoke all on function atlas.owner_revise_biological_rhythm_rule_v1(uuid,integer,integer,integer,text) from anon;
