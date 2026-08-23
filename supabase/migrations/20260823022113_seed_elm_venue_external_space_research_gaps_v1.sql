do $migration$
declare v_campaign_id uuid;
begin
  select id into v_campaign_id
  from local_intel.campaigns
  where name='Elm Venue Pilot 01 — Market Learning'
  order by created_at
  limit 1;

  if v_campaign_id is not null then
    perform local_intel.sync_campaign_external_space_research_gaps_v1(v_campaign_id);
  end if;
end
$migration$;