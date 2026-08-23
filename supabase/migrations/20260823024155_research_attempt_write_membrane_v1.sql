alter table local_intel.research_attempts add column if not exists attempt_key text;
create unique index if not exists research_attempts_attempt_key_uidx on local_intel.research_attempts(attempt_key) where attempt_key is not null;

create or replace function local_intel.block_research_attempt_mutation_v1()
returns trigger language plpgsql security definer set search_path='pg_catalog','local_intel' as $$
begin
  raise exception 'research attempts are append-only';
end;$$;

drop trigger if exists research_attempts_append_only_v1 on local_intel.research_attempts;
create trigger research_attempts_append_only_v1 before update or delete on local_intel.research_attempts for each row execute function local_intel.block_research_attempt_mutation_v1();

create or replace function local_intel.record_research_attempt_v1(p_payload jsonb)
returns uuid language plpgsql security definer set search_path='pg_catalog','local_intel' as $$
declare
  v_key text := nullif(btrim(p_payload->>'attempt_key'),'');
  v_entity uuid;
  v_question uuid;
  v_use_case uuid;
  v_outcome text := nullif(btrim(p_payload->>'outcome'),'');
  v_effect text := nullif(btrim(p_payload->>'evidence_effect'),'');
  v_summary text := nullif(btrim(p_payload->>'finding_summary'),'');
  v_scope text := nullif(btrim(p_payload->>'source_scope'),'');
  v_attempted timestamptz := coalesce(nullif(p_payload->>'attempted_at','')::timestamptz, now());
  v_revisit timestamptz;
  v_kind text;
  v_question_text text;
  v_existing local_intel.research_attempts%rowtype;
  v_id uuid;
begin
  if v_key is null then raise exception 'attempt_key is required'; end if;
  begin v_entity := (p_payload->>'entity_id')::uuid; exception when others then raise exception 'entity_id must be UUID'; end;
  if nullif(p_payload->>'research_question_id','') is not null then
    begin v_question := (p_payload->>'research_question_id')::uuid; exception when others then raise exception 'research_question_id must be UUID'; end;
  elsif nullif(p_payload->>'research_question_key','') is not null then
    select id into v_question from local_intel.research_questions where stable_key=(p_payload->>'research_question_key') and status='active' order by version desc limit 1;
  end if;
  if v_question is null then raise exception 'active research question is required'; end if;
  if nullif(p_payload->>'use_case_id','') is not null then
    begin v_use_case := (p_payload->>'use_case_id')::uuid; exception when others then raise exception 'use_case_id must be UUID'; end;
  end if;
  if v_outcome not in ('evidence_found','no_qualifying_public_evidence','ambiguous','source_unavailable','blocked','not_applicable') then raise exception 'invalid outcome'; end if;
  if v_effect not in ('advance','defer','deprioritize','no_change') then raise exception 'invalid evidence_effect'; end if;
  if v_summary is null or v_scope is null then raise exception 'finding_summary and source_scope are required'; end if;
  if not exists(select 1 from local_intel.entities where id=v_entity) then raise exception 'unknown entity %',v_entity; end if;
  select research_kind, question_text into v_kind,v_question_text from local_intel.research_questions where id=v_question and status='active';
  if not found then raise exception 'research question is not active'; end if;
  if v_use_case is not null and not exists(select 1 from local_intel.offering_use_cases where id=v_use_case) then raise exception 'unknown use_case %',v_use_case; end if;
  if nullif(p_payload->>'revisit_after','') is not null then v_revisit := (p_payload->>'revisit_after')::timestamptz; end if;

  select * into v_existing from local_intel.research_attempts where attempt_key=v_key;
  if found then
    if v_existing.entity_id is distinct from v_entity or v_existing.research_question_id is distinct from v_question or v_existing.use_case_id is distinct from v_use_case or v_existing.outcome is distinct from v_outcome or v_existing.evidence_effect is distinct from v_effect or v_existing.finding_summary is distinct from v_summary then
      raise exception 'attempt_key % already belongs to different immutable research attempt',v_key;
    end if;
    return v_existing.id;
  end if;

  insert into local_intel.research_attempts(attempt_key,entity_id,use_case_id,research_kind,research_question,research_question_id,attempted_at,outcome,evidence_effect,finding_summary,source_scope,sources_checked,queries_checked,revisit_after,metadata)
  values(v_key,v_entity,v_use_case,v_kind,v_question_text,v_question,v_attempted,v_outcome,v_effect,v_summary,v_scope,coalesce(p_payload->'sources_checked','[]'::jsonb),coalesce(p_payload->'queries_checked','[]'::jsonb),v_revisit,coalesce(p_payload->'metadata','{}'::jsonb)) returning id into v_id;
  return v_id;
end;$$;

revoke all on function local_intel.record_research_attempt_v1(jsonb) from public,anon,authenticated;
grant execute on function local_intel.record_research_attempt_v1(jsonb) to service_role;
revoke all on function local_intel.block_research_attempt_mutation_v1() from public,anon,authenticated,service_role;
revoke all on local_intel.research_attempts from public,anon,authenticated,service_role;
grant select on local_intel.research_attempts to service_role;