create or replace function atlas.classify_state_consequence_instance_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_policy atlas.state_consequence_policies%rowtype;
  v_role text;
  v_parent_policy_key text;
  v_parent_id uuid;
  v_candidate_onset date;
  v_candidate_known_active_by date;
  v_candidate_time_class text;
  v_candidate_basis jsonb:='{}'::jsonb;
begin
  select * into v_policy from atlas.state_consequence_policies where id=new.policy_id;
  if v_policy.id is null then return new; end if;

  v_role:=coalesce(nullif(v_policy.metadata->>'consequenceRole',''),'state_consequence');
  if v_role not in ('state_consequence','operation_requirement','truth_acquisition','repair_or_resolution','preparation') then
    raise exception 'Unsupported consequenceRole on policy %: %',v_policy.stable_key,v_role using errcode='22023';
  end if;
  new.consequence_role:=v_role;

  if v_role='operation_requirement' then
    begin v_candidate_onset:=nullif(new.state_snapshot->>'requirementOnsetDate','')::date;
    exception when others then v_candidate_onset:=null; end;
    begin v_candidate_known_active_by:=nullif(new.state_snapshot->>'requirementKnownActiveBy','')::date;
    exception when others then v_candidate_known_active_by:=null; end;
    v_candidate_time_class:=nullif(new.state_snapshot->>'requirementTimeClass','');
    v_candidate_basis:=case when jsonb_typeof(new.state_snapshot->'requirementEpistemicBasis')='object'
      then new.state_snapshot->'requirementEpistemicBasis' else '{}'::jsonb end;

    if tg_op='UPDATE' then
      -- Requirement time is historical truth. Later warrant/state changes may improve
      -- or remove the current snapshot but may never silently move the requirement clock forward.
      new.requirement_onset_date:=case
        when old.requirement_onset_date is null then v_candidate_onset
        when v_candidate_onset is null then old.requirement_onset_date
        else least(old.requirement_onset_date,v_candidate_onset)
      end;
      new.requirement_known_active_by:=case
        when old.requirement_known_active_by is null then v_candidate_known_active_by
        when v_candidate_known_active_by is null then old.requirement_known_active_by
        else least(old.requirement_known_active_by,v_candidate_known_active_by)
      end;
      new.requirement_time_class:=coalesce(v_candidate_time_class,old.requirement_time_class);
      new.epistemic_basis:=coalesce(old.epistemic_basis,'{}'::jsonb)||v_candidate_basis;
    else
      new.requirement_onset_date:=v_candidate_onset;
      new.requirement_known_active_by:=v_candidate_known_active_by;
      new.requirement_time_class:=v_candidate_time_class;
      new.epistemic_basis:=v_candidate_basis;
    end if;
    new.source_requirement_instance_id:=null;
  else
    new.requirement_onset_date:=null;
    new.requirement_known_active_by:=null;
    new.requirement_time_class:=null;
    new.epistemic_basis:=case when jsonb_typeof(v_policy.metadata->'epistemicBasis')='object'
      then v_policy.metadata->'epistemicBasis' else '{}'::jsonb end;

    v_parent_policy_key:=nullif(v_policy.metadata->>'sourceRequirementPolicyKey','');
    if v_parent_policy_key is not null then
      select i.id into v_parent_id
      from atlas.state_consequence_instances i
      join atlas.state_consequence_policies p on p.id=i.policy_id
      where i.subject_kind=new.subject_kind
        and i.subject_id=new.subject_id
        and i.status='open'
        and p.stable_key=v_parent_policy_key
      order by i.released_at desc,i.id
      limit 1;
      new.source_requirement_instance_id:=v_parent_id;
    else
      new.source_requirement_instance_id:=null;
    end if;
  end if;

  return new;
end;
$function$;

comment on function atlas.classify_state_consequence_instance_v1() is
'P8 constitutional hardening: operation-requirement time and epistemic basis persist across warrant/state reclassification and resolution. New evidence may move the known clock earlier, never silently later or to null.';
