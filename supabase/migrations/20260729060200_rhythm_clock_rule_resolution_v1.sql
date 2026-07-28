-- The nearest active explicit Rulebook binding wins on every Clock evaluation.
create or replace function atlas.resolve_effective_rhythm_rule_for_clock_v1(
  p_state_id uuid,
  p_as_of timestamptz default now()
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_state atlas.rhythm_state%rowtype;
  v_zone_id uuid;
  v_object_id uuid;
  v_object_type text;
  v_object_mode text;
  v_life_status text;
  v_care_state text;
  v_crop_profile_id uuid;
  v_stage_key text;
  v_project_id uuid;
  v_project_stage text;
  v_winner jsonb;
  v_as_of timestamptz := coalesce(p_as_of, now());
begin
  select * into v_state
  from atlas.rhythm_state
  where id = p_state_id;

  if v_state.id is null then
    raise exception 'Rhythm state not found.' using errcode = 'P0002';
  end if;

  if v_state.subject_kind = 'zone' then
    v_zone_id := v_state.subject_id;
  elsif v_state.subject_kind = 'growing_object' then
    v_object_id := v_state.subject_id;
    select o.zone_id, o.object_type, o.object_mode, os.life_status, os.care_state
    into v_zone_id, v_object_type, v_object_mode, v_life_status, v_care_state
    from atlas.growing_objects o
    left join atlas.object_state os on os.object_id = o.id
    where o.id = v_state.subject_id;

    select cc.crop_profile_id, cc.cycle_state
    into v_crop_profile_id, v_stage_key
    from atlas.crop_cycles cc
    where cc.object_id = v_state.subject_id
      and cc.lifecycle_status in ('planned', 'active')
    order by
      case cc.lifecycle_status when 'active' then 0 else 1 end,
      coalesce(cc.planted_date, cc.sown_date, cc.created_at::date) desc,
      cc.created_at desc
    limit 1;
  elsif v_state.subject_kind = 'crop_cycle' then
    select cc.object_id, cc.crop_profile_id, cc.cycle_state,
           o.zone_id, o.object_type, o.object_mode,
           os.life_status, os.care_state
    into v_object_id, v_crop_profile_id, v_stage_key,
         v_zone_id, v_object_type, v_object_mode,
         v_life_status, v_care_state
    from atlas.crop_cycles cc
    left join atlas.growing_objects o on o.id = cc.object_id
    left join atlas.object_state os on os.object_id = cc.object_id
    where cc.id = v_state.subject_id;
  elsif v_state.subject_kind = 'project' then
    v_project_id := v_state.subject_id;
    select p.zone_id, p.current_milestone
    into v_zone_id, v_project_stage
    from atlas.projects p
    where p.id = v_state.subject_id;
  end if;

  with candidates as (
    select
      b.id as binding_id,
      b.binding_key,
      b.inheritance_layer,
      b.subject_kind as binding_subject_kind,
      b.subject_id as binding_subject_id,
      b.subject_key as binding_subject_key,
      b.priority,
      r.id as rule_id,
      r.rule_key,
      r.rhythm_key,
      r.version,
      r.label,
      r.applicability,
      r.validity_interval_seconds,
      r.warning_window_seconds,
      r.grace_window_seconds,
      r.qualifying_touches,
      r.failure_consequence,
      r.player_routing,
      r.metadata as rule_metadata,
      case b.inheritance_layer
        when 'temporary_exception' then 600
        when 'subject_override' then 500
        when 'contents_stage' then 400
        when 'zone_modifier' then 300
        when 'object_class' then 200
        when 'farm_default' then 100
        else 0
      end as layer_rank,
      case
        when b.inheritance_layer = 'farm_default' then 'farm:' || v_state.farm_id::text
        when b.inheritance_layer = 'object_class' then 'object_class:' || b.subject_key
        when b.inheritance_layer = 'zone_modifier' then 'zone:' || b.subject_id::text
        when b.subject_kind = 'crop_profile' then 'crop_profile:' || b.subject_id::text
        when b.subject_kind = 'crop_stage' then 'crop_stage:' || b.subject_key
        when b.subject_kind = 'room_state' then 'room_state:' || b.subject_key
        when b.subject_kind = 'project_stage' then 'project_stage:' || b.subject_key
        else b.subject_kind || ':' || b.subject_id::text
      end as matched_on
    from atlas.rhythm_bindings b
    join atlas.rhythm_rules r on r.id = b.rhythm_rule_id
    where b.farm_id = v_state.farm_id
      and r.farm_id = v_state.farm_id
      and r.rhythm_key = v_state.rhythm_key
      and r.status = 'active'
      and b.active = true
      and (b.active_from is null or b.active_from <= v_as_of)
      and (b.active_until is null or b.active_until > v_as_of)
      and (
        (b.inheritance_layer = 'farm_default'
          and b.subject_kind = 'farm'
          and b.subject_id = v_state.farm_id)
        or
        (b.inheritance_layer = 'object_class'
          and b.subject_kind = 'object_class'
          and v_object_id is not null
          and b.subject_key = any(array_remove(array[
            v_object_type,
            case when v_object_type is not null then 'type:' || v_object_type end,
            v_object_mode,
            case when v_object_mode is not null then 'mode:' || v_object_mode end
          ], null)))
        or
        (b.inheritance_layer = 'zone_modifier'
          and b.subject_kind = 'zone'
          and v_zone_id is not null
          and b.subject_id = v_zone_id)
        or
        (b.inheritance_layer = 'contents_stage'
          and (
            (b.subject_kind = 'crop_profile'
              and v_crop_profile_id is not null
              and b.subject_id = v_crop_profile_id)
            or
            (b.subject_kind = 'crop_stage'
              and v_stage_key is not null
              and b.subject_key = any(array[v_stage_key, 'stage:' || v_stage_key]))
            or
            (b.subject_kind = 'room_state'
              and v_object_type = 'room'
              and (b.subject_id is null or b.subject_id = v_object_id)
              and b.subject_key = any(array_remove(array[
                v_life_status,
                case when v_life_status is not null then 'life:' || v_life_status end,
                v_care_state,
                case when v_care_state is not null then 'care:' || v_care_state end
              ], null)))
            or
            (b.subject_kind = 'project_stage'
              and v_project_id is not null
              and b.subject_id = v_project_id
              and v_project_stage is not null
              and b.subject_key = any(array[v_project_stage, 'stage:' || v_project_stage]))
          ))
        or
        (b.inheritance_layer in ('subject_override', 'temporary_exception')
          and (
            (b.subject_kind = v_state.subject_kind and b.subject_id = v_state.subject_id)
            or
            (v_state.subject_kind = 'crop_cycle'
              and b.subject_kind = 'growing_object'
              and v_object_id is not null
              and b.subject_id = v_object_id)
          ))
      )
  )
  select jsonb_build_object(
    'bindingId', c.binding_id,
    'bindingKey', c.binding_key,
    'inheritanceLayer', c.inheritance_layer,
    'bindingSubjectKind', c.binding_subject_kind,
    'bindingSubjectId', c.binding_subject_id,
    'bindingSubjectKey', c.binding_subject_key,
    'priority', c.priority,
    'layerRank', c.layer_rank,
    'matchedOn', c.matched_on,
    'ruleId', c.rule_id,
    'ruleKey', c.rule_key,
    'rhythmKey', c.rhythm_key,
    'version', c.version,
    'label', c.label,
    'applicability', c.applicability,
    'validityIntervalSeconds', c.validity_interval_seconds,
    'warningWindowSeconds', c.warning_window_seconds,
    'graceWindowSeconds', c.grace_window_seconds,
    'qualifyingTouches', c.qualifying_touches,
    'failureConsequence', c.failure_consequence,
    'playerRouting', c.player_routing,
    'metadata', c.rule_metadata
  )
  into v_winner
  from candidates c
  order by c.layer_rank desc, c.priority desc, c.version desc, c.binding_id
  limit 1;

  return v_winner;
end;
$$;

revoke all on function atlas.resolve_effective_rhythm_rule_for_clock_v1(uuid, timestamptz)
  from public, anon, authenticated;
