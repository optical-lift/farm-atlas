-- Principal escalation human title v1
-- Keep escalation_kind machine-readable in metadata while the Principal-facing
-- candidate title uses ordinary language.

do $$
declare
  v_definition text;
  v_marker text := 'e.escalation_kind AS title';
  v_replacement text := 'initcap(replace(e.escalation_kind, ''_''::text, '' ''::text)) AS title';
begin
  select pg_get_viewdef('atlas.principal_clock_candidates_v1'::regclass,true)
    into v_definition;

  if position(v_marker in v_definition)=0 then
    raise exception 'principal_clock_candidates_v1 operational escalation title contract changed; refusing blind rewrite.';
  end if;
  if position(v_replacement in v_definition)>0 then
    return;
  end if;

  execute 'create or replace view atlas.principal_clock_candidates_v1 as '
    || replace(v_definition,v_marker,v_replacement);
end
$$;

comment on view atlas.principal_clock_candidates_v1 is
  'Canonical Principal Clock candidate inventory. Operational escalation titles are human-readable while structured kind/source/threshold data remain in metadata.';
