do $do$
declare
  v_oid oid;
  v_def text;
  v_start integer;
  v_end integer;
  v_replacement text := $replacement$with active_placements as materialized (
    select cp.id as placement_id,cp.object_id,cp.crop_cycle_id,cp.placement_key,
           cp.planting_claim_id,
           cp.long_start_ft,cp.long_end_ft,cp.cross_start_ft,cp.cross_end_ft,
           cc.crop_label,cc.variety,cc.cycle_state,go.label as object_label,
           (
             cp.planting_claim_id is not null
             and pc.status='planted'
             and exists (
               select 1 from atlas.planting_claim_objects pco
               where pco.planting_claim_id=cp.planting_claim_id
                 and pco.object_id=cp.object_id
                 and pco.coverage_kind in ('whole_object','full_bed')
             )
           ) as exclusive_claim
    from atlas.crop_placements cp
    join atlas.crop_cycles cc on cc.id=cp.crop_cycle_id
    left join atlas.growing_objects go on go.id=cp.object_id
    left join atlas.planting_claims pc on pc.id=cp.planting_claim_id
    where cp.farm_id=p_farm_id
      and coalesce(cc.lifecycle_status,'active')='active'
  ), cell_pairs as (
    select least(a.crop_cycle_id,b.crop_cycle_id) as cycle_a,
           greatest(a.crop_cycle_id,b.crop_cycle_id) as cycle_b,
           a.object_id,
           case when a.exclusive_claim or b.exclusive_claim
                then 'explicit_cell_overlap_against_exclusive_claim'
                else 'explicit_cell_capacity_exceeded' end::text as evidence_type,
           min(ca.cell_key) as evidence_key
    from active_placements a
    join atlas.crop_placement_cells ca on ca.placement_id=a.placement_id
    join active_placements b on b.object_id=a.object_id and b.crop_cycle_id<>a.crop_cycle_id
    join atlas.crop_placement_cells cb on cb.placement_id=b.placement_id and cb.cell_key=ca.cell_key
    where a.crop_cycle_id<b.crop_cycle_id
      and (
        a.exclusive_claim or b.exclusive_claim
        or coalesce(ca.coverage_fraction,1)+coalesce(cb.coverage_fraction,1)>1
      )
    group by least(a.crop_cycle_id,b.crop_cycle_id),greatest(a.crop_cycle_id,b.crop_cycle_id),a.object_id,
             case when a.exclusive_claim or b.exclusive_claim
                  then 'explicit_cell_overlap_against_exclusive_claim'
                  else 'explicit_cell_capacity_exceeded' end
  ), rectangle_pairs as (
    select least(a.crop_cycle_id,b.crop_cycle_id) as cycle_a,
           greatest(a.crop_cycle_id,b.crop_cycle_id) as cycle_b,
           a.object_id,
           'explicit_rectangle_overlap_against_exclusive_claim'::text as evidence_type,
           null::text as evidence_key
    from active_placements a
    join active_placements b on b.object_id=a.object_id and a.crop_cycle_id<b.crop_cycle_id
    where (a.exclusive_claim or b.exclusive_claim)
      and a.long_start_ft is not null and a.long_end_ft is not null
      and a.cross_start_ft is not null and a.cross_end_ft is not null
      and b.long_start_ft is not null and b.long_end_ft is not null
      and b.cross_start_ft is not null and b.cross_end_ft is not null
      and least(a.long_end_ft,b.long_end_ft)>greatest(a.long_start_ft,b.long_start_ft)
      and least(a.cross_end_ft,b.cross_end_ft)>greatest(a.cross_start_ft,b.cross_start_ft)
  ), raw_pairs as (
    select * from cell_pairs
    union all
    select * from rectangle_pairs
  ), collisions as (
    select r.cycle_a,r.cycle_b,r.object_id,
           jsonb_agg(distinct to_jsonb(r.evidence_type)) as evidence_types,
           jsonb_agg(distinct to_jsonb(r.evidence_key)) filter(where r.evidence_key is not null) as evidence_keys,
           max(a.crop_label) filter(where a.crop_cycle_id=r.cycle_a) as crop_a_label,
           max(a.variety) filter(where a.crop_cycle_id=r.cycle_a) as crop_a_variety,
           max(b.crop_label) filter(where b.crop_cycle_id=r.cycle_b) as crop_b_label,
           max(b.variety) filter(where b.crop_cycle_id=r.cycle_b) as crop_b_variety,
           max(coalesce(a.object_label,b.object_label)) as object_label
    from raw_pairs r
    left join active_placements a on a.crop_cycle_id=r.cycle_a and a.object_id=r.object_id
    left join active_placements b on b.crop_cycle_id=r.cycle_b and b.object_id=r.object_id
    group by r.cycle_a,r.cycle_b,r.object_id
  )
  select count(*)::integer,
         coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'cropCycleA',cycle_a,'cropALabel',crop_a_label,'cropAVariety',crop_a_variety,
           'cropCycleB',cycle_b,'cropBLabel',crop_b_label,'cropBVariety',crop_b_variety,
           'objectId',object_id,'objectLabel',object_label,
           'evidenceTypes',evidence_types,'evidenceKeys',evidence_keys,
           'repairOwner','farm_operations_management',
           'reason','Two active crop bodies have explicit overlapping destination evidence and canonical exclusivity or capacity evidence establishes incompatibility.'
         )) order by object_label,crop_a_label,crop_b_label),'[]'::jsonb)
  into v_destination_collision_count,v_destination_collision_items
  from collisions;

  $replacement$;
begin
  select p.oid into v_oid
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='atlas' and p.proname='farm_continuity_audit_v3'
    and pg_get_function_identity_arguments(p.oid)='p_farm_id uuid, p_as_of_date date';
  if v_oid is null then raise exception 'farm_continuity_audit_v3 not found'; end if;
  v_def:=pg_get_functiondef(v_oid);
  v_start:=position('with active_placements as materialized (' in v_def);
  v_end:=position('  -- 5. Labor-capacity collision requires an actual Worker Day claim and a proven day-capacity contradiction.' in v_def);
  if v_start=0 or v_end=0 or v_end<=v_start then raise exception 'Expected destination-collision block not found'; end if;
  v_def:=substr(v_def,1,v_start-1)||v_replacement||substr(v_def,v_end);
  execute v_def;
end
$do$;