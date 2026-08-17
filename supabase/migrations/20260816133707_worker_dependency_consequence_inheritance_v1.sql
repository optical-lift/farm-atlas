create or replace function atlas.task_effective_delay_consequence_v1(
  p_task_id uuid,
  p_as_of_date date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas, auth
as $$
declare
  v_as_of date:=coalesce(p_as_of_date,(now() at time zone 'America/Chicago')::date);
  v_direct jsonb;
  v_direct_tier integer;
  v_direct_class text;
  v_effective_tier integer;
  v_effective_class text;
  v_effective_source text;
  v_inherited_from_task_id uuid;
  v_inherited_from_title text;
  v_inherited_downstream_tier integer;
  v_inherited_depth integer;
  v_inherited_path uuid[];
  v_outgoing_count integer:=0;
  v_dependency_link_missing boolean:=false;
begin
  v_direct:=atlas.task_delay_consequence_v1(p_task_id,v_as_of);
  if coalesce(v_direct->>'directTier','') ~ '^[1-6]$' then
    v_direct_tier:=(v_direct->>'directTier')::integer;
  end if;
  v_direct_class:=v_direct->>'directClass';

  select count(*)::integer
  into v_outgoing_count
  from atlas.task_prerequisites prerequisite
  join atlas.tasks downstream on downstream.id=prerequisite.downstream_task_id
  where prerequisite.active=true
    and prerequisite.satisfied_at is null
    and prerequisite.prerequisite_task_id=p_task_id
    and downstream.status in ('open','blocked');

  with recursive dependency_chain as (
    select
      prerequisite.downstream_task_id as task_id,
      1 as depth,
      array[p_task_id,prerequisite.downstream_task_id]::uuid[] as path
    from atlas.task_prerequisites prerequisite
    join atlas.tasks downstream on downstream.id=prerequisite.downstream_task_id
    where prerequisite.active=true
      and prerequisite.satisfied_at is null
      and prerequisite.prerequisite_task_id=p_task_id
      and downstream.status in ('open','blocked')

    union all

    select
      prerequisite.downstream_task_id,
      chain.depth+1,
      chain.path||prerequisite.downstream_task_id
    from dependency_chain chain
    join atlas.task_prerequisites prerequisite
      on prerequisite.prerequisite_task_id=chain.task_id
     and prerequisite.active=true
     and prerequisite.satisfied_at is null
    join atlas.tasks downstream on downstream.id=prerequisite.downstream_task_id
    where chain.depth<12
      and downstream.status in ('open','blocked')
      and not prerequisite.downstream_task_id=any(chain.path)
  ), downstream_consequences as (
    select
      chain.task_id,
      task.title,
      chain.depth,
      chain.path,
      consequence.packet,
      case
        when coalesce(consequence.packet->>'directTier','') ~ '^[1-6]$'
          then (consequence.packet->>'directTier')::integer
        else null
      end as downstream_tier
    from dependency_chain chain
    join atlas.tasks task on task.id=chain.task_id
    cross join lateral (
      select atlas.task_delay_consequence_v1(chain.task_id,v_as_of) as packet
    ) consequence
  ), ranked as (
    select
      d.*,
      case
        when d.downstream_tier in (1,2,3) then 3
        when d.downstream_tier between 4 and 6 then d.downstream_tier
        else null
      end as inherited_tier
    from downstream_consequences d
    where d.downstream_tier is not null
  )
  select
    ranked.task_id,ranked.title,ranked.downstream_tier,ranked.depth,ranked.path
  into
    v_inherited_from_task_id,v_inherited_from_title,v_inherited_downstream_tier,v_inherited_depth,v_inherited_path
  from ranked
  order by inherited_tier asc,depth asc,task_id
  limit 1;

  if v_inherited_from_task_id is not null then
    v_effective_tier:=case
      when v_inherited_downstream_tier in (1,2,3) then 3
      else v_inherited_downstream_tier
    end;
    v_effective_class:=case
      when v_inherited_downstream_tier in (1,2,3) then 'prerequisite_unlock'
      when v_inherited_downstream_tier=4 then 'prerequisite_to_revenue_commitment'
      when v_inherited_downstream_tier=5 then 'prerequisite_to_recurring_maintenance'
      when v_inherited_downstream_tier=6 then 'prerequisite_to_improvement_side_project'
      else 'dependency_inheritance'
    end;
    v_effective_source:='dependency_inheritance';
  end if;

  if v_direct_tier is not null and (v_effective_tier is null or v_direct_tier<=v_effective_tier) then
    v_effective_tier:=v_direct_tier;
    v_effective_class:=v_direct_class;
    v_effective_source:='direct_consequence';
    v_inherited_from_task_id:=null;
    v_inherited_from_title:=null;
    v_inherited_downstream_tier:=null;
    v_inherited_depth:=null;
    v_inherited_path:=null;
  end if;

  v_dependency_link_missing:=
    v_effective_tier is null
    and v_outgoing_count=0
    and v_direct_class in ('dependency_consequence_unresolved','hard_date_consequence_unresolved');

  return jsonb_build_object(
    'contractVersion','task_effective_delay_consequence_v1',
    'taskId',p_task_id,
    'asOfDate',v_as_of,
    'direct',v_direct,
    'effectiveTier',v_effective_tier,
    'effectiveClass',coalesce(v_effective_class,v_direct_class),
    'effectiveSource',coalesce(v_effective_source,'unresolved'),
    'dependencyLinkCount',v_outgoing_count,
    'dependencyLinkMissing',v_dependency_link_missing,
    'inheritedFromTaskId',v_inherited_from_task_id,
    'inheritedFromTitle',v_inherited_from_title,
    'inheritedDownstreamTier',v_inherited_downstream_tier,
    'inheritanceDepth',v_inherited_depth,
    'inheritancePath',to_jsonb(v_inherited_path),
    'needsConsequenceResolution',v_effective_tier is null
  );
end;
$$;

revoke all on function atlas.task_effective_delay_consequence_v1(uuid,date) from public, anon, authenticated;
grant execute on function atlas.task_effective_delay_consequence_v1(uuid,date) to service_role;