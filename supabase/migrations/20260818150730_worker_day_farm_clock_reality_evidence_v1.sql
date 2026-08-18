do $$
declare
  v_def text;
  v_original text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='atlas' and p.proname='worker_day_selection_overlay_v1'
    and pg_get_function_identity_arguments(p.oid)='p_farm_id uuid, p_membership_id uuid, p_day date, p_plan jsonb';
  if v_def is null then raise exception 'worker_day_selection_overlay_v1 was not found'; end if;
  v_original:=v_def;

  if position('v_reality jsonb' in v_def)>0 then
    raise exception 'worker_day_selection_overlay_v1 already contains farm clock reality state';
  end if;
  v_def:=replace(v_def,
    '  v_next jsonb:=''[]''::jsonb;',
    '  v_next jsonb:=''[]''::jsonb;'||E'\n'||'  v_reality jsonb:=''{}''::jsonb;');
  if v_def=v_original then raise exception 'Could not add v_reality declaration'; end if;

  if position(E'  select\n    coalesce(jsonb_agg(jsonb_build_object(' in v_def)=0 then
    raise exception 'Could not find real-work aggregation insertion point';
  end if;
  v_def:=replace(v_def,
    E'  select\n    coalesce(jsonb_agg(jsonb_build_object(',
    E'  select coalesce(jsonb_object_agg(c.task_id::text,jsonb_build_object(\n      ''warrantClass'',c.reality_warrant_class,\n      ''warrantOrder'',c.reality_warrant_order,\n      ''subjectState'',c.subject_state,\n      ''fittingOperation'',c.fitting_operation,\n      ''operationWindow'',c.operation_window,\n      ''jurisdiction'',c.jurisdiction,\n      ''truthBoundary'',c.truth_boundary\n    )),''{}''::jsonb) into v_reality\n  from atlas.farm_clock_reality_candidates_v1(p_farm_id,p_membership_id,p_day) c;\n\n  select\n    coalesce(jsonb_agg(jsonb_build_object(');

  if position('''automatic'',false,''requiresOwnerApproval'',false,''presentationReason'',s.presentation_reason,' in v_def)=0 then
    raise exception 'Could not find real-work reality field insertion point';
  end if;
  v_def:=replace(v_def,
    '''automatic'',false,''requiresOwnerApproval'',false,''presentationReason'',s.presentation_reason,',
    '''automatic'',false,''requiresOwnerApproval'',false,''presentationReason'',s.presentation_reason,'||E'\n      '||'''farmClockReality'',coalesce(v_reality->t.id::text,''{}''::jsonb)||jsonb_build_object(''clockDecision'',jsonb_build_object(''state'',s.presentation_state,''reason'',s.presentation_reason)),');

  if position('''nextUpReason'',s.presentation_reason,' in v_def)=0 then
    raise exception 'Could not find next-up reality field insertion point';
  end if;
  v_def:=replace(v_def,
    '''nextUpReason'',s.presentation_reason,',
    '''nextUpReason'',s.presentation_reason,'||E'\n    '||'''farmClockReality'',coalesce(v_reality->t.id::text,''{}''::jsonb)||jsonb_build_object(''clockDecision'',jsonb_build_object(''state'',s.presentation_state,''reason'',s.presentation_reason)),');

  execute v_def;
end $$;

comment on function atlas.worker_day_selection_overlay_v1(uuid,uuid,date,jsonb) is
  'Worker Day selector overlay. Phase 12 uses canonical Reality-governed Farm Clock selection and attaches lightweight subject/state/operation/window/jurisdiction warrant evidence to realWork and nextUp cards.';