-- Atlas Farm Care — Phase 2 prepared-projection efficiency
-- Reuse one materialized zone-card set inside the farm summary instead of
-- rebuilding each zone card once for display and again for trend totals.
-- Also count zone interventions as distinct released/planned records rather
-- than object links, so future multi-object interventions do not inflate totals.

do $patch$
declare
  v_definition text;
  v_old text := $old$  zones as (
    select
      coalesce(jsonb_agg(atlas.farm_care_zone_card_v1(z.id)
        order by z.sort_order,z.label),'[]'::jsonb) as cards,
      count(*)::integer as zone_count
    from atlas.zones z
    where z.farm_id=p_farm_id
      and exists(select 1 from objects o where o.zone_id=z.id)
  ),
  zone_trends as (
    select
      count(*) filter (where card->>'careTrend'='improving')::integer as improving,
      count(*) filter (where card->>'careTrend'='stable')::integer as holding,
      count(*) filter (where card->>'careTrend'='rising')::integer as rising,
      count(*) filter (where card->>'careTrend'='unknown')::integer as unknown,
      count(*) filter (where card->>'careState' in ('recovery_needed','losing_shape'))::integer as recovery_zones
    from (
      select atlas.farm_care_zone_card_v1(z.id) as card
      from atlas.zones z
      where z.farm_id=p_farm_id
        and exists(select 1 from objects o where o.zone_id=z.id)
    ) x
  ),$old$;
  v_new text := $new$  zone_cards as materialized (
    select
      z.sort_order,
      z.label,
      atlas.farm_care_zone_card_v1(z.id) as card
    from atlas.zones z
    where z.farm_id=p_farm_id
      and exists(select 1 from objects o where o.zone_id=z.id)
  ),
  zones as (
    select
      coalesce(jsonb_agg(card order by sort_order,label),'[]'::jsonb) as cards,
      count(*)::integer as zone_count
    from zone_cards
  ),
  zone_trends as (
    select
      count(*) filter (where card->>'careTrend'='improving')::integer as improving,
      count(*) filter (where card->>'careTrend'='stable')::integer as holding,
      count(*) filter (where card->>'careTrend'='rising')::integer as rising,
      count(*) filter (where card->>'careTrend'='unknown')::integer as unknown,
      count(*) filter (where card->>'careState' in ('recovery_needed','losing_shape'))::integer as recovery_zones
    from zone_cards
  ),$new$;
begin
  select pg_get_functiondef(
    'atlas.farm_care_summary_v1(uuid,integer)'::regprocedure
  ) into v_definition;

  if position(v_old in v_definition)=0 then
    raise exception 'Expected Farm Care summary zone projection was not found.';
  end if;

  execute replace(v_definition,v_old,v_new);
end
$patch$;

do $patch$
declare
  v_definition text;
  v_old text := $old$  'releasedInterventionCount',c.released_intervention_count,
  'plannedRecommendationCount',c.planned_recommendation_count,$old$;
  v_new text := $new$  'releasedInterventionCount',(
    select count(*)::integer
    from atlas.farm_care_released_intervention_v1 r
    where r.zone_id=p_zone_id
  ),
  'plannedRecommendationCount',(
    select count(*)::integer
    from atlas.farm_care_planned_intervention_v1 p
    where p.zone_id=p_zone_id
  ),$new$;
begin
  select pg_get_functiondef(
    'atlas.farm_care_zone_card_v1(uuid)'::regprocedure
  ) into v_definition;

  if position(v_old in v_definition)=0 then
    raise exception 'Expected Farm Care zone intervention counts were not found.';
  end if;

  execute replace(v_definition,v_old,v_new);
end
$patch$;

revoke all on function atlas.farm_care_summary_v1(uuid,integer) from public;
revoke all on function atlas.farm_care_zone_card_v1(uuid) from public;
grant execute on function atlas.farm_care_summary_v1(uuid,integer) to authenticated;
