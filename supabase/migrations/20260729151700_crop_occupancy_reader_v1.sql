create or replace function atlas.occupancy_number_v1(p_value numeric)
returns text
language sql
immutable
set search_path = pg_catalog, atlas
as $$
  select case when p_value is null then null else trim(trailing '.' from trim(trailing '0' from to_char(p_value,'FM999999990.##'))) end;
$$;

create or replace function atlas.crop_placement_summary_v1(
  p_mode text,
  p_row_count numeric,
  p_row_length_ft numeric,
  p_area_sqft numeric,
  p_explicit_plant_count numeric,
  p_clump_count numeric,
  p_label text
)
returns text
language sql
immutable
set search_path = pg_catalog, atlas
as $$
  select case coalesce(p_mode,'unknown')
    when 'full_rows' then concat(atlas.occupancy_number_v1(p_row_count),' full ',case when p_row_count=1 then 'row' else 'rows' end)
    when 'partial_rows' then concat(atlas.occupancy_number_v1(p_row_count),' ',case when p_row_count=1 then 'row' else 'rows' end,
      case when p_row_length_ft is not null then ' × '||atlas.occupancy_number_v1(p_row_length_ft)||' ft' else '' end)
    when 'square_foot_block' then concat(atlas.occupancy_number_v1(p_area_sqft),' sq ft')
    when 'individual_plants' then concat(atlas.occupancy_number_v1(p_explicit_plant_count),' ',case when p_explicit_plant_count=1 then 'plant' else 'plants' end)
    when 'clumps' then case when p_clump_count is not null then concat(atlas.occupancy_number_v1(p_clump_count),' ',case when p_clump_count=1 then 'clump' else 'clumps' end) else coalesce(p_label,'Perennial') end
    when 'edge_strip' then coalesce(p_label,'Edge strip')
    when 'scattered' then coalesce(p_label,'Scattered')
    when 'broadcast_area' then case when p_area_sqft is not null then concat(atlas.occupancy_number_v1(p_area_sqft),' sq ft broadcast') else coalesce(p_label,'Broadcast') end
    else p_label
  end;
$$;

create or replace function atlas.object_crop_occupancy_v1(p_object_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_object atlas.growing_objects%rowtype;
  v_role text;
  v_result jsonb;
begin
  select go.* into v_object from atlas.growing_objects go where go.id=p_object_id;
  if v_object.id is null then
    raise exception 'Growing object not found.' using errcode='P0002';
  end if;

  v_role := atlas.current_farm_role(v_object.farm_id);
  if not atlas.is_farm_owner(v_object.farm_id) and coalesce(v_role,'') not in ('farm_hand','manager') then
    raise exception 'Crop occupancy is not available to the signed-in farm member.' using errcode='42501';
  end if;

  with cycle_enriched as (
    select
      cc.id as crop_cycle_id,
      cc.crop_label,
      cc.variety,
      cc.cycle_state,
      cc.sown_date,
      cc.planted_date,
      pc.planted_date as claim_planted_date,
      cp.life_cycle,
      coalesce(cc.planted_date,cc.sown_date,pc.planted_date) as establishment_date,
      case
        when cc.planted_date is not null then 'planted'
        when cc.sown_date is not null then 'sown'
        when pc.planted_date is not null then 'planting_claim'
        else 'unknown'
      end as date_source,
      (
        lower(coalesce(cp.life_cycle,''))='perennial'
        or exists(
          select 1
          from atlas.crop_occupancy_evidence e
          join atlas.object_contents oc on oc.id=e.object_content_id
          where e.crop_cycle_id=cc.id and lower(coalesce(oc.content_type,'')) like '%perennial%'
        )
      ) as is_perennial,
      case
        when lower(cc.crop_label)='sunflower' and nullif(btrim(coalesce(cc.variety,'')),'') is not null
          then btrim(cc.variety)||' sunflower'
        when lower(cc.crop_label) in ('bearded iris','iris') then 'Iris'
        else cc.crop_label
      end as display_label,
      p.id as placement_id,
      p.placement_mode,
      p.placement_label,
      p.row_count,
      p.row_length_ft,
      p.area_sqft,
      p.explicit_plant_count,
      p.clump_count,
      p.spacing_in,
      p.plants_per_sqft,
      p.expected_quantity,
      p.expected_quantity_kind,
      p.expected_quantity_unit,
      p.expected_quantity_basis,
      p.confidence as placement_confidence,
      coalesce(cell_counts.cell_count,0) as cell_count,
      latest_observation.id as latest_observation_id,
      latest_observation.observed_date as latest_observed_date,
      latest_observation.stage as observed_stage,
      latest_observation.observed_quantity,
      latest_observation.quantity_unit as observed_quantity_unit,
      latest_observation.quantity_kind as observed_quantity_kind,
      latest_observation.stand_percent,
      latest_observation.condition,
      latest_observation.confidence as observation_confidence,
      first_observation.first_observed_date
    from atlas.crop_cycles cc
    left join atlas.planting_claims pc on pc.id=cc.planting_claim_id
    left join atlas.crop_profiles cp on cp.id=cc.crop_profile_id
    left join lateral (
      select p0.*
      from atlas.crop_placements p0
      where p0.crop_cycle_id=cc.id
      order by
        (p0.expected_quantity_kind='recorded') desc,
        (p0.expected_quantity is not null) desc,
        p0.created_at
      limit 1
    ) p on true
    left join lateral (
      select count(*)::integer as cell_count
      from atlas.crop_placement_cells c where c.placement_id=p.id
    ) cell_counts on true
    left join lateral (
      select o.*
      from atlas.crop_observations o
      where o.crop_cycle_id=cc.id
      order by o.observed_date desc nulls last,o.created_at desc
      limit 1
    ) latest_observation on true
    left join lateral (
      select min(o.observed_date) as first_observed_date
      from atlas.crop_observations o
      where o.crop_cycle_id=cc.id and o.observed_date is not null
    ) first_observation on true
    where cc.object_id=p_object_id and cc.lifecycle_status='active'
  ), active_cycles as (
    select
      ce.*,
      coalesce(ce.observed_stage,atlas.crop_stage_from_state_v1(ce.cycle_state,ce.life_cycle)) as stage,
      atlas.crop_stage_label_v1(coalesce(ce.observed_stage,atlas.crop_stage_from_state_v1(ce.cycle_state,ce.life_cycle))) as stage_label,
      atlas.crop_placement_summary_v1(
        ce.placement_mode,ce.row_count,ce.row_length_ft,ce.area_sqft,
        ce.explicit_plant_count,ce.clump_count,ce.placement_label
      ) as placement_summary,
      case
        when ce.is_perennial then 'perennial'
        when ce.establishment_date is not null then 'dated'
        when ce.first_observed_date is not null then 'observed'
        else 'unknown'
      end as group_kind,
      case
        when ce.is_perennial then null
        when ce.establishment_date is not null then ce.establishment_date
        else ce.first_observed_date
      end as group_date
    from cycle_enriched ce
  ), visible_cycles as (
    select * from active_cycles
    where coalesce(stage,'unknown') not in ('cleared','failed','dead','absent','abandoned','archived','removed','inactive')
  ), cohort_rows as (
    select
      vc.*,
      case vc.group_kind
        when 'dated' then to_char(vc.group_date,'Mon FMDD')
        when 'observed' then 'Observed '||to_char(vc.group_date,'Mon FMDD')
        when 'perennial' then 'Perennial'
        else 'Date unknown'
      end as group_label,
      case vc.group_kind when 'dated' then 1 when 'observed' then 2 when 'perennial' then 3 else 4 end as group_rank
    from visible_cycles vc
  ), distinct_groups as (
    select distinct group_kind,group_date,group_label,group_rank
    from cohort_rows
  )
  select jsonb_build_object(
    'objectId',v_object.id,
    'objectKey',v_object.stable_key,
    'objectLabel',v_object.label,
    'lengthFt',v_object.length_ft,
    'widthFt',v_object.width_ft,
    'areaSqft',v_object.area_sqft,
    'groups',coalesce(jsonb_agg(
      jsonb_build_object(
        'groupKind',g.group_kind,
        'groupDate',g.group_date,
        'groupLabel',g.group_label,
        'cohorts',(
          select coalesce(jsonb_agg(
            jsonb_strip_nulls(jsonb_build_object(
              'cropCycleId',c.crop_cycle_id,
              'cropLabel',c.crop_label,
              'displayLabel',c.display_label,
              'variety',c.variety,
              'lifeCycle',case when c.is_perennial then 'perennial' else coalesce(c.life_cycle,'annual') end,
              'establishmentDate',c.establishment_date,
              'dateSource',c.date_source,
              'stage',c.stage,
              'stageLabel',c.stage_label,
              'placementId',c.placement_id,
              'placementMode',c.placement_mode,
              'placementLabel',c.placement_label,
              'placementSummary',c.placement_summary,
              'rowCount',c.row_count,
              'rowLengthFt',c.row_length_ft,
              'areaSqft',c.area_sqft,
              'cellCount',c.cell_count,
              'spacingIn',c.spacing_in,
              'plantsPerSqft',c.plants_per_sqft,
              'expectedQuantity',c.expected_quantity,
              'expectedQuantityKind',c.expected_quantity_kind,
              'expectedQuantityUnit',c.expected_quantity_unit,
              'expectedQuantityBasis',c.expected_quantity_basis,
              'observedQuantity',c.observed_quantity,
              'observedQuantityUnit',c.observed_quantity_unit,
              'observedQuantityKind',c.observed_quantity_kind,
              'observedQuantityDate',c.latest_observed_date,
              'standPercent',c.stand_percent,
              'condition',c.condition,
              'confidence',coalesce(c.observation_confidence,c.placement_confidence,'medium')
            )) order by c.display_label,c.crop_cycle_id
          ),'[]'::jsonb)
          from cohort_rows c
          where c.group_kind=g.group_kind and c.group_date is not distinct from g.group_date
        )
      ) order by g.group_rank,g.group_date nulls last
    ),'[]'::jsonb)
  ) into v_result
  from distinct_groups g;

  return coalesce(v_result,jsonb_build_object(
    'objectId',v_object.id,'objectKey',v_object.stable_key,'objectLabel',v_object.label,
    'lengthFt',v_object.length_ft,'widthFt',v_object.width_ft,'areaSqft',v_object.area_sqft,'groups','[]'::jsonb
  ));
end;
$$;

create or replace function atlas.weed_card_task_focus_v1(p_task_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_task atlas.tasks%rowtype;
  v_card atlas.weed_cards%rowtype;
  v_pass atlas.weed_passes%rowtype;
  v_object atlas.growing_objects%rowtype;
  v_zone_label text;
  v_role text;
  v_membership_id uuid;
  v_sessions jsonb;
  v_occupancy jsonb;
  v_condition text;
begin
  select t.* into v_task from atlas.tasks t where t.id=p_task_id;
  if v_task.id is null then raise exception 'Task not found.' using errcode='P0002'; end if;

  v_role := atlas.current_farm_role(v_task.farm_id);
  v_membership_id := atlas.current_membership_id(v_task.farm_id);
  if not atlas.is_farm_owner(v_task.farm_id)
     and not (v_role in ('farm_hand','manager') and v_membership_id is not null and v_task.assigned_membership_id=v_membership_id)
  then
    raise exception 'This Weed Card is not available to the signed-in farm member.' using errcode='42501';
  end if;

  select c.* into v_card
  from atlas.weed_cards c join atlas.task_objects x on x.object_id=c.object_id
  where x.task_id=p_task_id limit 1;
  if v_card.id is null then return null; end if;

  select p.* into v_pass from atlas.weed_passes p
  where p.weed_card_id=v_card.id and p.status='active' limit 1;

  v_condition := coalesce(v_pass.current_condition,atlas.weed_card_condition_from_text_v1(v_task.metadata->>'condition'),v_card.current_condition);
  select go.* into v_object from atlas.growing_objects go where go.id=v_card.object_id;
  select z.label into v_zone_label from atlas.zones z where z.id=v_object.zone_id;
  v_occupancy := atlas.object_crop_occupancy_v1(v_object.id);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',s.id,'workDate',s.work_date,'minutes',s.minutes,'minutesKnown',s.minutes_known,
    'conditionBefore',s.condition_before,'conditionAfter',s.condition_after,'note',s.note,'recordedAt',s.recorded_at
  ) order by s.recorded_at desc),'[]'::jsonb)
  into v_sessions
  from (
    select ws.* from atlas.weed_sessions ws
    where ws.weed_card_id=v_card.id and (v_pass.id is null or ws.weed_pass_id=v_pass.id)
    order by ws.recorded_at desc limit 12
  ) s;

  return jsonb_build_object(
    'taskId',v_task.id,'taskStatus',v_task.status,'taskDueDate',v_task.due_date,
    'cardId',v_card.id,'passId',v_pass.id,'passStatus',coalesce(v_pass.status,'closed'),
    'objectId',v_object.id,'objectKey',v_object.stable_key,'objectLabel',v_object.label,
    'zoneLabel',coalesce(v_zone_label,'Elm Farm'),'occupancyGroups',coalesce(v_occupancy->'groups','[]'::jsonb),
    'condition',v_condition,'targetCondition',coalesce(v_pass.target_condition,v_card.target_condition),
    'totalMinutes',coalesce(v_pass.total_minutes,0),
    'sessionCount',case when v_pass.id is null then 0 else jsonb_array_length(v_sessions) end,
    'nextReviewOn',v_card.next_review_on,
    'sessions',case when v_pass.id is null then '[]'::jsonb else v_sessions end
  );
end;
$$;

revoke all on function atlas.occupancy_number_v1(numeric) from public;
revoke all on function atlas.crop_placement_summary_v1(text,numeric,numeric,numeric,numeric,numeric,text) from public;
revoke all on function atlas.object_crop_occupancy_v1(uuid) from public;
revoke all on function atlas.weed_card_task_focus_v1(uuid) from public;
grant execute on function atlas.occupancy_number_v1(numeric) to authenticated,service_role;
grant execute on function atlas.crop_placement_summary_v1(text,numeric,numeric,numeric,numeric,numeric,text) to authenticated,service_role;
grant execute on function atlas.object_crop_occupancy_v1(uuid) to authenticated,service_role;
grant execute on function atlas.weed_card_task_focus_v1(uuid) to authenticated,service_role;